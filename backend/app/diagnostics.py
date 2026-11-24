"""Admin self-check: are the payment addresses valid, can the server see each blockchain, and is OpenRouter
recognised? Read-only, except one optional tiny model call.

Address validity is checked by each format's own checksum, not by its shape:
- EVM (0x...): EIP-55. When the address mixes upper and lower case, the case of each letter is fixed by the
  Keccak-256 hash of the lower-case address, so one wrong character fails the check (probability of a typo passing
  is about 2^-15 per address for the 15 letters on average).
- Tron (T...): Base58Check, the last 4 bytes are the double SHA-256 of the rest; a typo passes with p = 2^-32.
- Bitcoin: bech32/bech32m (BIP-173/350) for bc1..., Base58Check for 1... and 3....
"""

import hashlib
import os
import time

import httpx

from app import config, crypto_pay, db

# ---- Keccak-256 (the pre-standard SHA-3 used by Ethereum; hashlib.sha3_256 pads differently) -------------------

_RC = [0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000, 0x000000000000808B,
       0x0000000080000001, 0x8000000080008081, 0x8000000000008009, 0x000000000000008A, 0x0000000000000088,
       0x0000000080008009, 0x000000008000000A, 0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
       0x8000000000008003, 0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
       0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008]
_ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]]
_MASK = (1 << 64) - 1


def _rol(value, shift):
    return ((value << shift) | (value >> (64 - shift))) & _MASK if shift else value


def _keccak_f(state):
    for rc in _RC:
        c = [state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4] for x in range(5)]
        d = [c[(x - 1) % 5] ^ _rol(c[(x + 1) % 5], 1) for x in range(5)]
        state = [[state[x][y] ^ d[x] for y in range(5)] for x in range(5)]
        b = [[0] * 5 for _ in range(5)]
        for x in range(5):
            for y in range(5):
                b[y][(2 * x + 3 * y) % 5] = _rol(state[x][y], _ROT[x][y])
        state = [[b[x][y] ^ ((~b[(x + 1) % 5][y]) & b[(x + 2) % 5][y]) for y in range(5)] for x in range(5)]
        state[0][0] ^= rc
    return state


def keccak256(data):
    rate = 136
    padded = bytearray(data) + b"\x01"
    while len(padded) % rate:
        padded.append(0)
    padded[-1] |= 0x80
    state = [[0] * 5 for _ in range(5)]
    for start in range(0, len(padded), rate):
        block = padded[start:start + rate]
        for i in range(rate // 8):
            x, y = i % 5, i // 5
            state[x][y] ^= int.from_bytes(block[8 * i:8 * i + 8], "little")
        state = _keccak_f(state)
    out = b"".join(state[i % 5][i // 5].to_bytes(8, "little") for i in range(4))
    return out


def evm_check(address):
    """(valid, note). Mixed case is verified with EIP-55; all-lower or all-upper has no checksum to verify."""
    if len(address) != 42 or not address.startswith("0x"):
        return False, "must be 0x plus 40 hex characters"
    body = address[2:]
    try:
        int(body, 16)
    except ValueError:
        return False, "contains characters that are not hex"
    if body == body.lower() or body == body.upper():
        return True, "format is right; it has no upper/lower-case checksum, so compare it with your wallet by eye"
    digest = keccak256(body.lower().encode()).hex()
    expected = "".join(ch.upper() if ch.isalpha() and int(digest[i], 16) >= 8 else ch.lower() for i, ch in enumerate(body.lower()))
    if expected == body:
        return True, "EIP-55 checksum matches, so no character was mistyped"
    return False, "EIP-55 checksum fails: a character was mistyped. Copy it again from the wallet"


# ---- Base58Check (Tron, legacy Bitcoin) ------------------------------------------------------------------------

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58decode(text):
    number = 0
    for ch in text:
        if ch not in _B58:
            raise ValueError("bad character " + ch)
        number = number * 58 + _B58.index(ch)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
    pad = len(text) - len(text.lstrip("1"))
    return b"\x00" * pad + raw


def base58check(text):
    raw = b58decode(text)
    if len(raw) < 5:
        return None
    body, check = raw[:-4], raw[-4:]
    if hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4] != check:
        return None
    return body


def tron_check(address):
    try:
        body = base58check(address)
    except ValueError as problem:
        return False, str(problem)
    if body is None:
        return False, "checksum fails: a character was mistyped. Copy it again from the wallet"
    if len(body) != 21 or body[0] != 0x41:
        return False, "this is not a Tron address"
    return True, "Base58Check checksum matches"


# ---- bech32 / bech32m (BIP-173, BIP-350) -------------------------------------------------------------------------

_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _polymod(values):
    generator = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for value in values:
        top = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ value
        for i in range(5):
            chk ^= generator[i] if ((top >> i) & 1) else 0
    return chk


def btc_check(address):
    lowered = address.lower()
    if lowered.startswith("bc1"):
        if address != lowered and address != address.upper():
            return False, "mixes upper and lower case"
        hrp, data = lowered[:2], lowered[3:]
        if any(ch not in _CHARSET for ch in data) or len(data) < 8:
            return False, "contains characters a bc1 address cannot have"
        values = [ord(ch) >> 5 for ch in hrp] + [0] + [ord(ch) & 31 for ch in hrp] + [_CHARSET.index(ch) for ch in data]
        const = _polymod(values)
        version = _CHARSET.index(data[0])
        if (version == 0 and const == 1) or (version > 0 and const == 0x2BC830A3):
            return True, "bech32 checksum matches"
        return False, "checksum fails: a character was mistyped. Copy it again from the wallet"
    if address[:1] in ("1", "3"):
        try:
            body = base58check(address)
        except ValueError as problem:
            return False, str(problem)
        if body is None or len(body) != 21 or body[0] not in (0x00, 0x05):
            return False, "checksum fails or it is not a Bitcoin address"
        return True, "Base58Check checksum matches"
    return False, "a Bitcoin address starts with bc1, 1 or 3"


# ---- live checks -----------------------------------------------------------------------------------------------

def item(group, name, ok, detail):
    return {"group": group, "name": name, "ok": bool(ok), "detail": detail}


async def run(client, test_model=False):
    found = []
    addresses = {"evm": crypto_pay.address_for("evm"), "tron": crypto_pay.address_for("tron"), "btc": crypto_pay.address_for("btc")}
    checkers = {"evm": evm_check, "tron": tron_check, "btc": btc_check}
    names = {"evm": "0x address (BNB Chain, Base, Polygon, Arbitrum, Ethereum)", "tron": "Tron address", "btc": "Bitcoin address"}
    for kind, address in addresses.items():
        if not address:
            found.append({"group": "Payment addresses", "name": names[kind], "ok": None, "detail": "Not set, so these coins are not offered."})
            continue
        ok, note = checkers[kind](address)
        found.append(item("Payment addresses", names[kind], ok, address + " · " + note))
    offered = crypto_pay.options()
    found.append(item("Payment addresses", "Coins offered at checkout", bool(offered), ", ".join(o["label"] for o in offered) or "None: add at least one address with crypto-wallet.sh"))

    chains = sorted({o["network"] for o in offered})
    for chain in chains:
        try:
            if chain in crypto_pay.CHAINS:
                head = await crypto_pay.evm_head(client, chain)
                found.append(item("Blockchain access", crypto_pay.NETWORK_LABELS[chain], head > 0, "Reached " + crypto_pay.rpc_for(chain) + ", latest block " + format(head, ",")))
            elif chain == "tron":
                reply = await client.get("https://api.trongrid.io/v1/accounts/" + addresses["tron"], timeout=20)
                found.append(item("Blockchain access", "Tron", reply.status_code == 200, "TronGrid answered HTTP " + str(reply.status_code)))
            elif chain == "bitcoin":
                reply = await client.get("https://mempool.space/api/address/" + addresses["btc"], timeout=20)
                found.append(item("Blockchain access", "Bitcoin", reply.status_code == 200, "mempool.space answered HTTP " + str(reply.status_code)))
        except Exception as problem:
            found.append(item("Blockchain access", crypto_pay.NETWORK_LABELS.get(chain, chain), False, "Not reachable from the server: " + type(problem).__name__))
    pending = db.one_row("SELECT COUNT(*) AS n FROM crypto_invoices WHERE status = 'created'")
    found.append({"group": "Blockchain access", "name": "Payment watcher", "ok": True, "detail": "Runs every " + str(crypto_pay.POLL_SECONDS) + " s; " + str((pending or {}).get("n", 0)) + " invoice(s) waiting for payment."})

    routed = [m for m in config.MODELS if "openrouter.ai" in str(m.get("url") or "")]
    key = routed[0]["api_key"] if routed else ""
    if not routed:
        found.append(item("OpenRouter", "Connected", False, "No model goes through OpenRouter. Add it with add-provider.sh, option 3."))
    else:
        found.append(item("OpenRouter", "Models that go through OpenRouter", True, ", ".join(m["label"] + " (" + m["id"] + ")" for m in routed)))
        try:
            reply = await client.get("https://openrouter.ai/api/v1/key", headers={"Authorization": "Bearer " + key}, timeout=20)
            if reply.status_code == 200:
                data = reply.json().get("data") or {}
                detail = "Key recognised: " + str(data.get("label") or "") + (", free tier" if data.get("is_free_tier") else ", paid account") + ", spent this week $" + format(float(data.get("usage_weekly") or 0), ".4f")
                found.append(item("OpenRouter", "API key", True, detail))
            else:
                found.append(item("OpenRouter", "API key", False, "OpenRouter refused the key (HTTP " + str(reply.status_code) + "). Add it again with add-provider.sh."))
        except Exception as problem:
            found.append(item("OpenRouter", "API key", False, "OpenRouter not reachable: " + type(problem).__name__))
        management = os.environ.get("OPENROUTER_MANAGEMENT_KEY", "").strip()
        if management:
            try:
                reply = await client.get("https://openrouter.ai/api/v1/credits", headers={"Authorization": "Bearer " + management}, timeout=20)
                data = (reply.json().get("data") or {}) if reply.status_code == 200 else {}
                found.append(item("OpenRouter", "Balance (management key)", reply.status_code == 200, ("Balance $" + format(float(data.get("total_credits") or 0) - float(data.get("total_usage") or 0), ".2f")) if reply.status_code == 200 else "Refused (HTTP " + str(reply.status_code) + ")"))
            except Exception as problem:
                found.append(item("OpenRouter", "Balance (management key)", False, type(problem).__name__))
        else:
            found.append({"group": "OpenRouter", "name": "Balance (management key)", "ok": None, "detail": "Not set. Optional: treasury.sh adds it so the admin card shows the balance."})
        if test_model:
            model = routed[0]
            started = time.time()
            try:
                reply = await client.post(model["url"].rstrip("/") + "/chat/completions", headers={"Authorization": "Bearer " + model["api_key"]},
                                          json={"model": model["id"], "messages": [{"role": "user", "content": "Reply with the single word: ready"}], "max_tokens": 20}, timeout=60)
                data = reply.json()
                if reply.status_code == 200 and data.get("choices"):
                    text = (data["choices"][0].get("message") or {}).get("content") or ""
                    found.append(item("OpenRouter", "Test call to " + model["label"], True, "Answered in " + format(time.time() - started, ".1f") + " s: \"" + text.strip()[:40] + "\" (served by " + str(data.get("provider") or "OpenRouter") + ")"))
                else:
                    found.append(item("OpenRouter", "Test call to " + model["label"], False, "HTTP " + str(reply.status_code) + ": " + str(data.get("error") or data)[:200]))
            except Exception as problem:
                found.append(item("OpenRouter", "Test call to " + model["label"], False, type(problem).__name__ + ": " + str(problem)[:120]))
    return found
