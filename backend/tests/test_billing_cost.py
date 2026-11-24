from app import db, plans, pricing
from app.agent import llm


def test_prices_and_cost():
    assert pricing.price_of("anthropic/claude-sonnet-5-5") == (2.0, 0.10, 10.0)
    assert pricing.price_of("claude-opus-5-5") == (4.0, 0.20, 20.0)
    assert pricing.price_of("something-new") == pricing.UNKNOWN
    # 1M fresh input + 1M output on Sonnet 5.5 = 2 + 10 dollars; cached input at 0.10
    assert abs(pricing.cost("claude-sonnet-5-5", 1_000_000, 1_000_000) - 12.0) < 1e-9
    assert abs(pricing.cost("claude-sonnet-5-5", 1_000_000, 0, cached_tokens=1_000_000) - 0.10) < 1e-9
    assert pricing.cost("claude-opus-5-5", 10**6, 10**6, own_key=True) == 0.0


def test_env_override(monkeypatch):
    monkeypatch.setenv("MODEL_PRICES", '{"my-local-model": [0.5, 0.05, 1.5]}')
    assert pricing.price_of("p1:my-local-model") == (0.5, 0.05, 1.5)


def test_daily_and_weekly_limits():
    user = {"id": "u_limits_test", "plan": "pro", "plan_until": db.now() + 86400, "is_admin": 0}
    found = plans.caps(user)
    assert found["unit"] == "usd" and found["week"] > found["day"]
    assert abs(plans.money_left(user) - found["day"]) < 1e-6
    db.add_cost(user["id"], found["day"] + 0.01, 1000)
    state = plans.limit_state(user)
    assert state["blocked"] == "day" and state["day"]["used_pct"] > 100
    assert "resets at" in plans.blocked_message(state)
    assert plans.over_budget(user)
    assert not plans.over_budget(user, {"own": True})
    assert not plans.over_budget(dict(user, is_admin=1))
    db.add_cost(user["id"], found["week"], 0)
    assert plans.limit_state(user)["blocked"] == "week"
    assert "week" in plans.blocked_message(plans.limit_state(user))


def test_windows_reset_at_midnight_and_monday():
    wednesday_noon = (1764158400 // 86400) * 86400 + 12 * 3600  # 2025-11-26 is a Wednesday
    spans = plans.windows(wednesday_noon)
    assert spans["day"][1] - wednesday_noon == 12 * 3600
    assert (spans["week"][1] - spans["day"][0]) // 86400 == 5  # Thursday..Sunday plus the rest of Wednesday


def test_free_plan_models_and_prices():
    assert pricing.cost("baidu/ernie-5.5-flash-preview:free", 600000, 17500) == 0.0
    assert pricing.cost("@cf/google/gemma-4-26b-a4b-it", 600000, 17500) == 0.0
    assert pricing.model_tier("liquid/lfm-3-1.7b:free") == "free"
    assert pricing.model_tier("qwen/qwen3-coder") == "open"
    assert pricing.model_tier("anthropic/claude-sonnet-5-5") == "paid"
    free = {"id": "u_free", "plan": "free", "plan_until": 0, "is_admin": 0}
    assert plans.allows(free, {"id": "meta-llama/llama-4"})
    assert not plans.allows(free, {"id": "x-ai/grok-4.7"})
    assert plans.allows(free, {"id": "x-ai/grok-4.7", "own": True})
    assert plans.caps(free)["unit"] == "tokens"


def test_history_gets_a_cache_breakpoint_for_claude():
    messages = [
        {"role": "system", "content": "rules"},
        {"role": "user", "content": "build a site"},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]},
        {"role": "tool", "content": "ok", "tool_call_id": "1"},
    ]
    out = llm.with_cache(messages, {"id": "anthropic/claude-sonnet-5-5"})
    assert out[0]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert out[1]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert out[3] == messages[3] and out[2] == messages[2]
    assert llm.with_cache(messages, {"id": "google/gemini-3.8-flash"}) == messages


def test_no_cache_markers_on_anthropic_openai_endpoint():
    messages = [{"role": "system", "content": "rules"}, {"role": "user", "content": "hi"}]
    assert llm.with_cache(messages, {"id": "claude-sonnet-5-5", "url": "https://api.anthropic.com/v1"}) == messages
