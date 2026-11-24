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
