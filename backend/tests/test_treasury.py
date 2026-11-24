import asyncio

import httpx

from app import config, treasury


def test_plan_math():
    calm = treasury.plan(100.0, 35.0)  # $5 a day, 20 days left
    assert calm["days_left"] == 20.0 and not calm["low"] and calm["top_up"] == 0
    low = treasury.plan(30.0, 35.0)  # target 52.5, so low; need 2*35 + 10 - 30 = 50
    assert low["low"] and not low["critical"]
    assert low["top_up"] == 50 and low["send_usdc"] == 52.5
    critical = treasury.plan(8.0, 35.0)  # 1.6 days
    assert critical["critical"] and critical["top_up"] == 72  # 2*35 + 10 - 8 = 72
    quiet = treasury.plan(0.0, 0.0)  # a new account: the $10 that unlocks free models
    assert quiet["low"] and quiet["top_up"] == 10 and quiet["send_usdc"] == 10.5
    unknown = treasury.plan(None, 10.0)
    assert unknown["balance"] is None and not unknown["low"]


def test_reads_openrouter_and_alerts_once(monkeypatch):
    monkeypatch.setattr(config, "MODELS", [{"key": "main:x", "id": "anthropic/claude-sonnet-5-5", "url": "https://openrouter.ai/api/v1", "api_key": "sk-or-test"}])
    monkeypatch.setenv("OPENROUTER_MANAGEMENT_KEY", "mgmt")

    def handler(request):
        if request.url.path.endswith("/credits"):
            assert request.headers["authorization"] == "Bearer mgmt"
            return httpx.Response(200, json={"data": {"total_credits": 50, "total_usage": 42}})
        return httpx.Response(200, json={"data": {"usage_weekly": 35}})

    sent = []

    async def fake_alert(client, result):
        sent.append(result["send_usdc"])
        return True

    monkeypatch.setattr(treasury, "alert", fake_alert)
    treasury.STATE.update({"alerted_at": 0, "alerted_kind": ""})

    async def go():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        result = await treasury.check(client)
        assert result["balance"] == 8 and result["burn7"] == 35 and result["critical"]
        now = 1_000_000
        for _ in range(3):  # the hourly loop runs three times; only one alert goes out
            if treasury.should_alert(result, now) and await treasury.alert(client, result):
                treasury.STATE["alerted_at"] = now
                treasury.STATE["alerted_kind"] = "critical"
            now += 3600
        assert sent == [result["send_usdc"]]
    asyncio.run(go())


def test_without_management_key_reports_why(monkeypatch):
    monkeypatch.setattr(config, "MODELS", [{"key": "main:x", "id": "x", "url": "https://openrouter.ai/api/v1", "api_key": "sk-or-test"}])
    monkeypatch.delenv("OPENROUTER_MANAGEMENT_KEY", raising=False)

    def handler(request):
        if request.url.path.endswith("/credits"):
            return httpx.Response(403, json={"error": {"message": "Only management keys can perform this operation."}})
        return httpx.Response(200, json={"data": {"usage_weekly": 7}})

    async def go():
        result = await treasury.check(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        assert result["balance"] is None and "management key" in result["error"] and result["burn7"] == 7
    asyncio.run(go())


def test_tiny_spend_does_not_jump_to_next_five():
    # a new account with a few cents of spending: $10 minimum plus cents, rounded up to $11, not $15
    found = treasury.plan(0.0, 0.03)
    assert found["top_up"] == 11 and found["send_usdc"] == 11.55
