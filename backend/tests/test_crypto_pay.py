import asyncio
import json

import httpx

from app import crypto_pay, db

EVM = "0x1111111111111111111111111111111111111111"
TRON = "TXyzOwnerAddress000000000000000000"


class Chain:
    """A fake chain: a head block, token transfer logs, Tron transfers and Bitcoin txs."""
    def __init__(self):
        self.head = 1000
        self.logs = []
        self.tron = []
        self.btc = []
        self.btc_usd = 100000.0

    def handler(self, request):
        if request.url.host == "api.coingecko.com":
            return httpx.Response(200, json={"bitcoin": {"usd": self.btc_usd}})
        if request.url.host == "api.trongrid.io":
            return httpx.Response(200, json={"data": self.tron})
        if request.url.host == "mempool.space":
            return httpx.Response(200, json=self.btc)
        body = json.loads(request.content)
        if body["method"] == "eth_blockNumber":
            return httpx.Response(200, json={"result": hex(self.head)})
        query = body["params"][0]
        first, last = int(query["fromBlock"], 16), int(query["toBlock"], 16)
        found = [item for item in self.logs if first <= int(item["blockNumber"], 16) <= last and item["address"].lower() == query["address"].lower() and item["to"] == query["topics"][2]]
        return httpx.Response(200, json={"result": found})

    def send_evm(self, contract, units, block, tx):
        self.logs.append({"address": contract, "to": "0x" + "0" * 24 + EVM.lower()[2:], "data": hex(units), "blockNumber": hex(block), "transactionHash": tx, "logIndex": "0x0"})


def setup(monkeypatch):
    monkeypatch.setenv("CRYPTO_EVM_ADDRESS", EVM)
    monkeypatch.setenv("CRYPTO_TRON_ADDRESS", TRON)
    monkeypatch.setenv("CRYPTO_BTC_ADDRESS", "bc1qowner")
    chain = Chain()
    client = httpx.AsyncClient(transport=httpx.MockTransport(chain.handler))
    activated = []
    from app.routes import billing
    monkeypatch.setattr(billing, "activate", lambda payment, user: activated.append(payment["id"]))
    return chain, client, activated


def new_payment(user_id, amount=20):
    payment = {"id": db.new_id("pay_"), "user_id": user_id, "plan": "pro", "period": "month", "amount": amount, "status": "created", "invoice_id": "own", "invoice_url": "", "created_at": db.now(), "paid_at": 0}
    db.insert("payments", payment)
    if db.one_row("SELECT id FROM users WHERE id = ?", (user_id,)) is None:
        db.insert("users", {"id": user_id, "email": user_id + "@x.test", "name": "T", "password_hash": "", "created_at": db.now()})
    return payment


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def test_amount_math_is_exact():
    assert crypto_pay.stable_units(20, 47, 6) == 20_004_700
    assert crypto_pay.stable_units(20, 47, 18) == 20_004_700_000_000_000_000
    assert crypto_pay.display(20_004_700, 6) == "20.0047"
    assert crypto_pay.display(20_000_000_000_000_000_000, 18) == "20"
    assert crypto_pay.pick_step(set(range(1, 9999)), 9999) == 9999


def test_full_path_evm_and_attacks(monkeypatch):
    chain, client, activated = setup(monkeypatch)
    contract = crypto_pay.OPTIONS["usdc_base"][3]

    async def go():
        payment = new_payment("u_evm")
        invoice = await crypto_pay.create_invoice(payment, "usdc_base", client)
        units = int(db.one_row("SELECT units FROM crypto_invoices WHERE id = ?", (invoice["id"],))["units"])
        # attack 1: the same amount sent BEFORE the invoice existed must not count
        chain.send_evm(contract, units, 990, "0xold")
        # attack 2: right amount, wrong (fake) token contract
        chain.send_evm("0x000000000000000000000000000000000000dEaD", units, 1005, "0xfake")
        # attack 3: wrong amount
        chain.send_evm(contract, units + 1, 1006, "0xshort")
        chain.head = 1100
        await crypto_pay.scan_once(client)
        assert activated == []
        # the real payment, in a block after the ones already scanned (confirmed blocks never change)
        chain.send_evm(contract, units, 1150, "0xreal")
        chain.head = 1200
        await crypto_pay.scan_once(client)
        assert activated == [payment["id"]]
        # replay: the same tx seen again pays nothing more
        await crypto_pay.scan_once(client)
        assert activated == [payment["id"]]
        row = db.one_row("SELECT * FROM crypto_invoices WHERE id = ?", (invoice["id"],))
        assert row["status"] == "paid" and row["tx"].startswith("base:0xreal")
        assert db.one_row("SELECT invoice_id FROM crypto_seen WHERE tx_key = ?", ("base:0xshort:0",))["invoice_id"] == ""
    run(go())


def test_unconfirmed_evm_payment_waits(monkeypatch):
    chain, client, activated = setup(monkeypatch)
    contract = crypto_pay.OPTIONS["usdt_bsc"][3]

    async def go():
        payment = new_payment("u_conf")
        invoice = await crypto_pay.create_invoice(payment, "usdt_bsc", client)
        units = int(db.one_row("SELECT units FROM crypto_invoices WHERE id = ?", (invoice["id"],))["units"])
        chain.send_evm(contract, units, 1010, "0xfresh")
        chain.head = 1010 + crypto_pay.CHAINS["bsc"]["confirmations"] - 1
        await crypto_pay.scan_once(client)
        assert activated == []
        chain.head = chain.head + 1
        await crypto_pay.scan_once(client)
        assert activated == [payment["id"]]
    run(go())


def test_unique_amounts_never_collide(monkeypatch):
    chain, client, activated = setup(monkeypatch)

    async def go():
        seen = set()
        for index in range(60):
            invoice = await crypto_pay.create_invoice(new_payment("u_many" + str(index)), "usdt_tron", client)
            assert invoice["amount"] not in seen
            seen.add(invoice["amount"])
    run(go())


def test_tron_and_bitcoin(monkeypatch):
    chain, client, activated = setup(monkeypatch)

    async def go():
        tron_payment = new_payment("u_tron")
        tron_invoice = await crypto_pay.create_invoice(tron_payment, "usdt_tron", client)
        units = int(db.one_row("SELECT units FROM crypto_invoices WHERE id = ?", (tron_invoice["id"],))["units"])
        chain.tron.append({"to": TRON, "transaction_id": "t1", "value": str(units), "block_timestamp": int(tron_invoice["expires_at"] - 1700) * 1000})
        btc_payment = new_payment("u_btc", 49)
        btc_invoice = await crypto_pay.create_invoice(btc_payment, "btc", client)
        sats = int(db.one_row("SELECT units FROM crypto_invoices WHERE id = ?", (btc_invoice["id"],))["units"])
        assert 49000 <= sats <= 49000 + 999  # 49 USD at 100k USD/BTC is 49,000 sat, plus the unique part
        chain.btc.append({"txid": "b1", "status": {"confirmed": True, "block_height": 900000, "block_time": btc_invoice["expires_at"] - 1000}, "vout": [{"scriptpubkey_address": "bc1qowner", "value": sats}]})
        await crypto_pay.scan_once(client)
        assert sorted(activated) == sorted([tron_payment["id"], btc_payment["id"]])
    run(go())
