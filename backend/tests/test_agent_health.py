import ast
import pathlib
import subprocess
import sys

from app.agent import llm


def test_no_undefined_names():
    # The "shlex is not defined" failure: a module used a name it never imported.
    root = pathlib.Path(__file__).resolve().parent.parent / "app"
    result = subprocess.run([sys.executable, "-m", "pyflakes", str(root)], capture_output=True, text=True)
    bad = [line for line in result.stdout.splitlines() if "undefined name" in line]
    assert bad == []


def test_health_demotes_failing_model():
    llm.HEALTH.clear()
    for _ in range(4):
        llm.record_turn("x:bad", False)
    assert llm.health_of("x:bad") > llm.DEMOTE_ABOVE
    for _ in range(8):
        llm.record_turn("x:bad", True)
    assert llm.health_of("x:bad") < llm.DEMOTE_ABOVE


def test_prompt_layers():
    from app.agent import prompt

    # Build layer
    assert "Testing and debugging" not in prompt.BASE
    assert "Testing and debugging" in prompt.BUILD
    assert not prompt.wants_build({"kind": "chat"}, "hello")
    assert prompt.wants_build({"kind": "chat"}, "build me a site")

    # Always-on layers exist and are non-empty
    assert len(prompt.BEHAVIOR) > 50
    assert len(prompt.OUTPUT_FORMAT) > 50
    assert len(prompt.WELLBEING) > 20

    # Task protocol layer
    assert prompt.wants_task_protocol({"kind": "chat"}, "research the competitors")
    assert prompt.wants_task_protocol({"kind": "chat"}, "بررسی کن")
    assert not prompt.wants_task_protocol({"kind": "chat"}, "hello there")

    # Tool detail layer only fires for present tools
    chat = {"kind": "chat", "mode": "chat", "workspace_id": "test", "local_path": None}
    user = {"id": "u1", "name": "Test", "settings": None}
    no_tool_prompt = prompt.build(chat, user, None, request="hi", tool_names=())
    with_search_prompt = prompt.build(chat, user, None, request="hi", tool_names=("web_search",))
    # Extended tool detail note present only when tool is active
    assert "Never state current numbers from memory" not in no_tool_prompt
    assert "Never state current numbers from memory" in with_search_prompt

    # Behavior and output format always present regardless of tools
    assert "sycophancy" in no_tool_prompt
    assert "prose" in no_tool_prompt.lower()
