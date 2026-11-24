"""Forkwise's own crypto checkout. Money goes straight to the owner's wallet; the server holds no keys.

How a payment is recognised:
- An invoice asks for a unique amount: the plan price plus k ten-thousandths of a dollar (k = 1..9999) for stablecoins,
  or the BTC quote plus k satoshi (k = 1..999). k is never given to two invoices for the same coin and network while
  either is open or within RESERVE seconds after expiry, so an incoming amount names at most one invoice. That is a
  guarantee by construction, not a probability.
- A transfer only counts if it is to the owner's address, of the right token contract, confirmed, made after the
  invoice was created (EVM: block >= start block; Tron and Bitcoin: timestamp), and never used before
  (crypto_seen.tx_key is the primary key, so one transaction cannot pay twice).
- Transfers that match no invoice are kept in crypto_seen for the admin to assign by hand.

Addresses come from the env file (deploy/crypto-wallet.sh): CRYPTO_EVM_ADDRESS (one 0x address for BNB Chain, Base,
Polygon, Arbitrum and Ethereum), CRYPTO_TRON_ADDRESS, CRYPTO_BTC_ADDRESS. Public RPC endpoints are the defaults;
CRYPTO_RPC_<CHAIN> overrides one, TRONGRID_API_KEY raises Tron rate limits."""

import asyncio
import math
import os
import random
import time
import traceback

import httpx

from app import db

INVOICE_SECONDS = 30 * 60
RESERVE = 24 * 3600
POLL_SECONDS = 20
EVM_CHUNK = 1000
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

CHAINS = {
    "bsc": {"label": "BNB Chain", "rpc": "https://bsc-rpc.publicnode.com", "confirmations": 15},
    "base": {"label": "Base", "rpc": "https://base-rpc.publicnode.com", "confirmations": 30},
    "polygon": {"label": "Polygon", "rpc": "https://polygon-bor-rpc.publicnode.com", "confirmations": 64},
    "arbitrum": {"label": "Arbitrum", "rpc": "https://arbitrum-one-rpc.publicnode.com", "confirmations": 40},
    "ethereum": {"label": "Ethereum", "rpc": "https://ethereum-rpc.publicnode.com", "confirmations": 12},
}

# key: (label, kind, chain, token contract, decimals). Contracts checked against Circle's and Tether's published lists.
OPTIONS = {
    "usdt_tron": ("USDT on Tron (TRC-20)", "tron", "tron", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", 6),
    "usdt_bsc": ("USDT on BNB Chain (BEP-20)", "evm", "bsc", "0x55d398326f99059fF775485246999027B3197955", 18),
    "usdc_bsc": ("USDC on BNB Chain (BEP-20)", "evm", "bsc", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18),
    "usdc_base": ("USDC on Base", "evm", "base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
    "usdc_polygon": ("USDC on Polygon", "evm", "polygon", "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6),
    "usdc_arbitrum": ("USDC on Arbitrum", "evm", "arbitrum", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6),
    "usdt_arbitrum": ("USDT on Arbitrum", "evm", "arbitrum", "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", 6),
    "usdc_ethereum": ("USDC on Ethereum (high network fee)", "evm", "ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    "usdt_ethereum": ("USDT on Ethereum (high network fee)", "evm", "ethereum", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    "btc": ("Bitcoin", "btc", "bitcoin", "", 8),
}


def address_for(kind):
    name = {"evm": "CRYPTO_EVM_ADDRESS", "tron": "CRYPTO_TRON_ADDRESS", "btc": "CRYPTO_BTC_ADDRESS"}[kind]
    return os.environ.get(name, "").strip()


def rpc_for(chain):
    return os.environ.get("CRYPTO_RPC_" + chain.upper(), "").strip() or CHAINS[chain]["rpc"]


NETWORK_LABELS = {"tron": "Tron", "bsc": "BNB Chain", "base": "Base", "polygon": "Polygon", "arbitrum": "Arbitrum", "ethereum": "Ethereum", "bitcoin": "Bitcoin"}
NETWORK_STANDARD = {"tron": "TRC-20", "bsc": "BEP-20", "base": "", "polygon": "", "arbitrum": "", "ethereum": "ERC-20", "bitcoin": ""}
FEE = {"tron": "low", "bsc": "lowest", "base": "lowest", "polygon": "lowest", "arbitrum": "lowest", "ethereum": "high", "bitcoin": "varies"}
RECOMMENDED = {"usdt_tron", "usdc_base"}


def options():
    """Payment choices the checkout can offer now: those whose wallet address is set."""
    found = []
    for key, (label, kind, chain, contract, decimals) in OPTIONS.items():
        if address_for(kind):
            found.append({"key": key, "label": label, "kind": kind, "network": chain, "coin": "BTC" if kind == "btc" else key.split("_")[0].upper(),
                          "network_label": NETWORK_LABELS[chain], "standard": NETWORK_STANDARD[chain], "fee": FEE[chain], "recommended": key in RECOMMENDED})
    return found


def enabled():
    return len(options()) > 0


# ---- amounts ----------------------------------------------------------------------------------------------------

def stable_units(dollars, step, decimals):
    """Token units for `dollars` plus `step` ten-thousandths of a dollar, exactly (integer arithmetic)."""
    ten_thousandths = int(round(dollars * 10000)) + step
    return ten_thousandths * 10 ** (decimals - 4)


def display(units, decimals):
    text = str(units).rjust(decimals + 1, "0")
    whole, frac = text[:-decimals], text[-decimals:].rstrip("0")
    return whole + ("." + frac if frac else "")


def taken_steps(option_key, base_units, now):
    rows = db.all_rows("SELECT bump FROM crypto_invoices WHERE option_key = ? AND base_units = ? AND (status = 'created' OR reserved_until > ?)", (option_key, str(base_units), now))
    return {int(row["bump"]) for row in rows}


def pick_step(taken, top):
    free = [value for value in range(1, top + 1) if value not in taken]
    if not free:
        raise RuntimeError("No free unique amount for this coin right now. Try another coin or network.")
    return random.choice(free)


# ---- reading chains ---------------------------------------------------------------------------------------------

async def evm_call(client, chain, method, params):
    reply = await client.post(rpc_for(chain), json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=30)
    data = reply.json()
    if data.get("error"):
        raise RuntimeError(chain + " " + method + ": " + str(data["error"])[:200])
    return data["result"]


async def evm_head(client, chain):
    return int(await evm_call(client, chain, "eth_blockNumber", []), 16)


async def evm_transfers(client, chain, contract, to_address, first, last):
    """Confirmed token transfers to `to_address` in blocks first..last."""
    topic_to = "0x" + "0" * 24 + to_address.lower()[2:]
    found = []
    block = first
    while block <= last:
        end = min(last, block + EVM_CHUNK - 1)
        logs = await evm_call(client, chain, "eth_getLogs", [{"fromBlock": hex(block), "toBlock": hex(end), "address": contract, "topics": [TRANSFER_TOPIC, None, topic_to]}])
        for item in logs:
            found.append({"tx_key": chain + ":" + item["transactionHash"] + ":" + str(int(item["logIndex"], 16)), "units": int(item["data"], 16), "block": int(item["blockNumber"], 16), "time": None})
        block = end + 1
    return found


async def tron_transfers(client, contract, to_address, since_ms):
    headers = {"TRON-PRO-API-KEY": os.environ["TRONGRID_API_KEY"]} if os.environ.get("TRONGRID_API_KEY") else {}
    url = "https://api.trongrid.io/v1/accounts/" + to_address + "/transactions/trc20"
    params = {"only_to": "true", "only_confirmed": "true", "contract_address": contract, "min_timestamp": str(int(since_ms)), "limit": "200"}
    reply = await client.get(url, params=params, headers=headers, timeout=30)
    found = []
    for item in reply.json().get("data") or []:
        if item.get("to") != to_address:
            continue
        found.append({"tx_key": "tron:" + item["transaction_id"], "units": int(item["value"]), "block": None, "time": item["block_timestamp"] / 1000})
    return found


async def btc_transfers(client, to_address):
    reply = await client.get("https://mempool.space/api/address/" + to_address + "/txs", timeout=30)
    found = []
    for tx in reply.json():
        status = tx.get("status") or {}
        if not status.get("confirmed"):
            continue
        for index, out in enumerate(tx.get("vout") or []):
            if out.get("scriptpubkey_address") == to_address:
                found.append({"tx_key": "btc:" + tx["txid"] + ":" + str(index), "units": int(out["value"]), "block": status.get("block_height"), "time": status.get("block_time")})
    return found


async def btc_price(client):
    reply = await client.get("https://api.coingecko.com/api/v3/simple/price", params={"ids": "bitcoin", "vs_currencies": "usd"}, timeout=20)
    return float(reply.json()["bitcoin"]["usd"])


# ---- invoices ---------------------------------------------------------------------------------------------------

async def create_invoice(payment, option_key, client=None):
    """Makes the unique-amount invoice for a payment row. Returns what the checkout page shows."""
    if option_key not in OPTIONS:
        raise ValueError("Unknown coin or network.")
    label, kind, chain, contract, decimals = OPTIONS[option_key]
    address = address_for(kind)
    if not address:
        raise ValueError("This coin is not set up.")
    now = time.time()
    own = client is None
    client = client or httpx.AsyncClient()
    try:
        start_block = 0
        if kind == "evm":
            start_block = await evm_head(client, chain)
        if kind == "btc":
            price = await btc_price(client)
            base_units = int(math.ceil(payment["amount"] / price * 1e8))
            step = pick_step(taken_steps(option_key, base_units, now), 999)
            units = base_units + step
        else:
            base_units = stable_units(payment["amount"], 0, decimals)
            step = pick_step(taken_steps(option_key, base_units, now), 9999)
            units = stable_units(payment["amount"], step, decimals)
    finally:
        if own:
            await client.aclose()
    row = {
        "id": db.new_id("ci_"), "payment_id": payment["id"], "user_id": payment["user_id"], "option_key": option_key,
        "address": address, "units": str(units), "base_units": str(base_units), "bump": step, "start_block": start_block,
        "created_at": now, "expires_at": now + INVOICE_SECONDS, "reserved_until": now + INVOICE_SECONDS + RESERVE,
        "status": "created", "tx": "", "paid_at": 0,
    }
    db.insert("crypto_invoices", row)
    return public(row)


def public(row):
    label, kind, chain, contract, decimals = OPTIONS[row["option_key"]]
    coin = "BTC" if kind == "btc" else label.split(" ")[0]
    return {"id": row["id"], "payment_id": row["payment_id"], "option": row["option_key"], "label": label, "coin": coin,
            "network": chain, "network_label": NETWORK_LABELS[chain], "standard": NETWORK_STANDARD[chain], "created_at": row["created_at"],
            "address": row["address"], "amount": display(int(row["units"]), decimals),
            "expires_at": row["expires_at"], "status": row["status"], "tx": row["tx"]}


def open_invoices(now):
    return db.all_rows("SELECT * FROM crypto_invoices WHERE status = 'created' AND reserved_until > ?", (now,))


def counts(invoice, transfer):
    """True when a seen transfer may pay this invoice: same amount, and made after the invoice existed."""
    if int(invoice["units"]) != int(transfer["units"]):
        return False
    if transfer.get("block") is not None and OPTIONS[invoice["option_key"]][1] == "evm":
        return transfer["block"] >= int(invoice["start_block"] or 0)
    if transfer.get("time") is not None:
        return transfer["time"] >= invoice["created_at"] - 120
    return False


def settle(option_key, transfers, invoices):
    """Pairs new transfers with invoices. Returns [(invoice, transfer)] and records every transfer as seen."""
    paired = []
    waiting = [item for item in invoices if item["option_key"] == option_key]
    for transfer in transfers:
        if db.one_row("SELECT tx_key FROM crypto_seen WHERE tx_key = ?", (transfer["tx_key"],)):
            continue
        match = None
        for invoice in waiting:
            if counts(invoice, transfer):
                match = invoice
                break
        db.insert("crypto_seen", {"tx_key": transfer["tx_key"], "option_key": option_key, "units": str(transfer["units"]), "invoice_id": match["id"] if match else "", "seen_at": time.time()})
        if match:
            waiting.remove(match)
            paired.append((match, transfer))
    return paired


def mark_paid(invoice, tx_key):
    from app.routes import billing
    db.execute("UPDATE crypto_invoices SET status = 'paid', tx = ?, paid_at = ? WHERE id = ? AND status = 'created'", (tx_key, time.time(), invoice["id"]))
    payment = db.one_row("SELECT * FROM payments WHERE id = ?", (invoice["payment_id"],))
    user = db.one_row("SELECT * FROM users WHERE id = ?", (invoice["user_id"],))
    if payment and user and payment["status"] != "paid":
        billing.activate(payment, user)


async def scan_once(client):
    now = time.time()
    waiting = open_invoices(now)
    if not waiting:
        return 0
    paid = 0
    for option_key in sorted({item["option_key"] for item in waiting}):
        label, kind, chain, contract, decimals = OPTIONS[option_key]
        address = address_for(kind)
        mine = [item for item in waiting if item["option_key"] == option_key]
        try:
            if kind == "evm":
                head = await evm_head(client, chain) - CHAINS[chain]["confirmations"]
                state = db.one_row("SELECT height FROM crypto_state WHERE chain = ?", (option_key,))
                first = min(int(item["start_block"]) for item in mine)
                if state:
                    first = max(first, int(state["height"]) + 1)
                if head < first:
                    continue
                transfers = await evm_transfers(client, chain, contract, address, first, head)
                if state:
                    db.execute("UPDATE crypto_state SET height = ? WHERE chain = ?", (head, option_key))
                else:
                    db.insert("crypto_state", {"chain": option_key, "height": head})
            elif kind == "tron":
                transfers = await tron_transfers(client, contract, address, (min(item["created_at"] for item in mine) - 120) * 1000)
            else:
                transfers = await btc_transfers(client, address)
        except Exception:
            traceback.print_exc()
            continue
        for invoice, transfer in settle(option_key, transfers, mine):
            mark_paid(invoice, transfer["tx_key"])
            paid += 1
    db.execute("UPDATE crypto_invoices SET status = 'expired' WHERE status = 'created' AND reserved_until <= ?", (now,))
    return paid


async def loop():
    while True:
        await asyncio.sleep(POLL_SECONDS)
        if not enabled():
            continue
        try:
            async with httpx.AsyncClient() as client:
                await scan_once(client)
        except Exception:
            traceback.print_exc()
