import asyncio

import httpx

from app import config, diagnostics


def test_checksums_match_published_vectors():
    assert diagnostics.keccak256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    assert diagnostics.evm_check("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")[0]
    assert not diagnostics.evm_check("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD")[0]
    assert diagnostics.tron_check("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")[0]
    assert not diagnostics.tron_check("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6T")[0]
    assert diagnostics.btc_check("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")[0]
    assert not diagnostics.btc_check("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5")[0]
    assert diagnostics.btc_check("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")[0]


def test_full_run_with_openrouter(monkeypatch):
    monkeypatch.setenv("CRYPTO_EVM_ADDRESS", "0x01fAfAE3963562A8180A6AD989D89d3075D2367e")
    monkeypatch.delenv("CRYPTO_TRON_ADDRESS", raising=False)
    monkeypatch.delenv("CRYPTO_BTC_ADDRESS", raising=False)
    monkeypatch.setattr(config, "MODELS", [{"key": "p3:meta-llama/llama-4:free", "id": "meta-llama/llama-4:free", "label": "Llama 4", "url": "https://openrouter.ai/api/v1", "api_key": "sk-or-x"}])

    def handler(request):
        if request.url.host == "openrouter.ai" and request.url.path.endswith("/key"):
            return httpx.Response(200, json={"data": {"label": "sk-or-v1-abc", "is_free_tier": True, "usage_weekly": 0}})
        if request.url.path.endswith("/chat/completions"):
            return httpx.Response(200, json={"choices": [{"message": {"content": "ready"}}], "provider": "Chutes"})
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "0x2a"})

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        checks = await diagnostics.run(client, test_model=True)
        by_name = {c["name"]: c for c in checks}
        assert by_name["0x address (BNB Chain, Base, Polygon, Arbitrum, Ethereum)"]["ok"]
        assert by_name["Tron address"]["ok"] is None
        assert by_name["API key"]["ok"] and "recognised" in by_name["API key"]["detail"]
        assert by_name["Test call to Llama 4"]["ok"] and "ready" in by_name["Test call to Llama 4"]["detail"]
        assert all(c["ok"] for c in checks if c["group"] == "Blockchain access")
    asyncio.run(go())
