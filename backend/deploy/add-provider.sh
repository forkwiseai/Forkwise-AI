#!/usr/bin/env bash
set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/forkwise/backend.env}"
PY="/opt/forkwise/venv/bin/python"
[ -x "$PY" ] || PY="python3"

if [ "$(id -u)" != "0" ]; then
    echo "Run with sudo."
    exit 1
fi

echo
echo "Forkwise: add a model provider (tests the key first)"
echo "-------------------------------------------------------"
echo "  Free, no card needed:"
echo "   1) NVIDIA build.nvidia.com  (Nemotron, DeepSeek, Kimi, GLM, Mistral Large; about 40 requests a minute)"
echo "   2) Google AI Studio         (Gemini 3.8 Flash free tier, sees images)"
echo "   3) Groq                     (gpt-oss-120b, Qwen; about 1,000 requests a day)"
echo "   4) Mistral                  (free mode)"
echo "   5) SambaNova                (20 requests a day per model)"
echo "   6) Cohere                   (trial key, 1,000 calls a month, not for commercial use)"
echo "  Paid:"
echo "   7) OpenRouter"
echo "   8) Cerebras"
echo "   9) Anthropic Claude (direct key)"
echo "  10) xAI Grok (direct key)"
echo "  11) Other (OpenAI compatible)"
read -r -p "Choose 1-11: " CHOICE </dev/tty

VISION="false"
FREE="false"
LIST_HEADERS=()
case "$CHOICE" in
    1) BASE="https://integrate.api.nvidia.com/v1"; FREE="true"
       DEFAULT_MODELS="nvidia/nemotron-3-super-120b-a12b=Nemotron 3 Super,deepseek-ai/deepseek-v4-flash=DeepSeek V4 Flash"
       echo "Get a key at https://build.nvidia.com/settings/api-keys (starts with nvapi-)."
       echo "NVIDIA's terms allow this for development and testing; heavy production use needs their paid licence." ;;
    2) BASE="https://generativelanguage.googleapis.com/v1beta/openai"; DEFAULT_MODELS="gemini-3.8-flash=Gemini 3.8 Flash"; VISION="true"; FREE="ask"
       echo "Get a key at https://aistudio.google.com/apikey. On the free tier Google may use the prompts to improve its products." ;;
    3) BASE="https://api.groq.com/openai/v1"; DEFAULT_MODELS="openai/gpt-oss-120b=GPT-OSS 120B (Groq),qwen/qwen3.8-27b=Qwen 3.8 27B (Groq)"; FREE="ask"
       echo "Get a key at https://console.groq.com/keys" ;;
    4) BASE="https://api.mistral.ai/v1"; DEFAULT_MODELS="mistral-medium-latest=Mistral Medium,devstral-medium-latest=Devstral Medium"; FREE="ask"
       echo "Get a key at https://console.mistral.ai/api-keys" ;;
    5) BASE="https://api.sambanova.ai/v1"; DEFAULT_MODELS="gpt-oss-120b=GPT-OSS 120B (SambaNova)"; FREE="ask"
       echo "Get a key at https://cloud.sambanova.ai/apis" ;;
    6) BASE="https://api.cohere.ai/compatibility/v1"; DEFAULT_MODELS="command-a-plus-05-2026=Command A+"; FREE="ask"
       echo "Get a key at https://dashboard.cohere.com/api-keys. Trial keys are not allowed for commercial use." ;;
    7) BASE="https://openrouter.ai/api/v1"; DEFAULT_MODELS="" ;;
    8) BASE="https://api.cerebras.ai/v1"; DEFAULT_MODELS="gpt-oss-120b=GPT-OSS 120B (Cerebras)" ;;
    9) BASE="https://api.anthropic.com/v1"; DEFAULT_MODELS="claude-sonnet-5-5=Claude Sonnet 5.5,claude-haiku-5-5=Claude Haiku 5.5"; VISION="true"
       echo
       echo "Note: Anthropic's OpenAI-compatible endpoint does not support prompt caching. Claude through this key"
       echo "costs about 4.4x more per task than Claude through OpenRouter, which passes the cache markers on."
       echo "Use OpenRouter for Claude until Forkwise speaks Anthropic's native API."
       read -r -p "Continue with the direct key anyway? (y/n): " GO </dev/tty
       [ "$GO" = "y" ] || exit 0 ;;
    10) BASE="https://api.x.ai/v1"; DEFAULT_MODELS="grok-4.7=Grok 4.7,grok-4.3=Grok 4.3" ;;
    *) read -r -p "Base URL (ending in /v1): " BASE </dev/tty; DEFAULT_MODELS=""; FREE="ask" ;;
esac
if [ "$FREE" = "ask" ]; then
    read -r -p "Is this key on the provider's free tier, with no billing set up? (y/n): " ANS </dev/tty
    if [ "$ANS" = "y" ]; then FREE="true"; else FREE="false"; fi
fi
if [ "$FREE" = "true" ]; then
    echo "Marked free: calls to it will not count against people's plan limits, and the Free plan may use it."
fi
BASE="${BASE%/}"

read -r -s -p "API key (hidden): " KEY </dev/tty
echo
KEY="$(echo "$KEY" | tr -d '[:space:]')"
if [ -z "$KEY" ]; then
    echo "A key is needed."
    exit 1
fi

echo
echo "Asking the provider which models this key can use..."
if [ "$CHOICE" = "9" ]; then
    LIST_HEADERS=(-H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01")
else
    LIST_HEADERS=(-H "Authorization: Bearer $KEY")
fi
LIST="$(curl -s -m 30 "${LIST_HEADERS[@]}" "$BASE/models" | "$PY" -c "
import sys, json
try:
    data = json.load(sys.stdin)
    items = data.get('data') or data.get('models') or []
    names = []
    for item in items:
        name = item.get('id') or item.get('name') or ''
        if name.startswith('models/'):
            name = name[7:]
        names.append(name)
    if len(names) == 0:
        print('ERROR ' + json.dumps(data)[:300])
    else:
        print('\n'.join(sorted(names)[:250]))
except Exception:
    print('ERROR could not read the answer')
")"
if echo "$LIST" | grep -q '^ERROR'; then
    echo "$LIST"
    echo "The key or the address is not right. Nothing was changed."
    exit 1
fi
echo "$LIST"
echo

if [ -n "$DEFAULT_MODELS" ]; then
    echo "Suggested: $DEFAULT_MODELS"
    read -r -p "Press Enter to use it, or paste your own (id=Label,id=Label): " MODELS </dev/tty
    [ -z "$MODELS" ] && MODELS="$DEFAULT_MODELS"
else
    read -r -p "Models to use (id=Label,id=Label): " MODELS </dev/tty
fi
if [ -z "$MODELS" ]; then
    echo "At least one model is needed."
    exit 1
fi
FIRST="$(echo "$MODELS" | cut -d, -f1 | cut -d= -f1)"

echo
echo "Test 1 of 2: a normal answer from $FIRST ..."
REPLY="$(curl -s -m 90 -X POST "$BASE/chat/completions" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "{\"model\":\"$FIRST\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: ready\"}],\"max_tokens\":200}")"
echo "$REPLY" | "$PY" -c "
import sys, json
try:
    data = json.load(sys.stdin)
    message = data['choices'][0]['message']
    print('OK, the model said:', (message.get('content') or '(empty, but the call worked)')[:100])
except Exception:
    print('FAILED:', json.dumps(data)[:400] if 'data' in dir() else 'no valid answer')
    sys.exit(1)
"
if [ $? -ne 0 ]; then
    echo "The test failed, so nothing was changed. Check the model name in the list above."
    exit 1
fi

echo
echo "Test 2 of 2: can it use tools (needed for building files and running code)? ..."
TOOL="$(curl -s -m 90 -X POST "$BASE/chat/completions" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "{\"model\":\"$FIRST\",\"messages\":[{\"role\":\"user\",\"content\":\"Use the tool to read the file notes.txt.\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"description\":\"Read a file\",\"parameters\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}}}],\"max_tokens\":300}")"
echo "$TOOL" | "$PY" -c "
import sys, json
try:
    data = json.load(sys.stdin)
    calls = data['choices'][0]['message'].get('tool_calls') or []
    if len(calls) > 0:
        print('OK, it called the tool:', calls[0]['function']['name'], calls[0]['function']['arguments'][:60])
    else:
        print('WARNING: it answered without calling the tool. It may still work for chat, but is weak for building.')
except Exception:
    print('WARNING: the tool test gave no clear answer:', sys.stdin.read()[:200])
"

echo
read -r -p "Add this provider to Forkwise? (y/n): " SURE </dev/tty
if [ "$SURE" != "y" ]; then
    echo "Nothing was changed."
    exit 0
fi

cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"
"$PY" - "$ENV_FILE" "$BASE" "$KEY" "$MODELS" "$VISION" "$FREE" <<'PYEOF'
import sys
path, base, key, models, vision, free = sys.argv[1:7]
lines = open(path).read().split("\n")
slot = 0
for index in range(1, 10):
    prefix = "PROVIDER_" + str(index) + "_URL="
    found = ""
    for line in lines:
        if line.startswith(prefix):
            found = line[len(prefix):].strip()
    if found == base:
        slot = index
        break
    if found == "" and slot == 0:
        slot = index
if slot == 0:
    print("All 9 provider slots are used.")
    sys.exit(1)
names = ["URL", "KEY", "MODELS", "VISION", "FREE"]
values = [base, key, models, vision, free]
out = []
for line in lines:
    skip = False
    for name in names:
        if line.startswith("PROVIDER_" + str(slot) + "_" + name + "="):
            skip = True
    if not skip:
        out.append(line)
while len(out) > 0 and out[len(out) - 1] == "":
    out.pop()
for position in range(len(names)):
    out.append("PROVIDER_" + str(slot) + "_" + names[position] + "=" + values[position])
open(path, "w").write("\n".join(out) + "\n")
print("Saved as provider slot " + str(slot))
PYEOF
[ $? -ne 0 ] && exit 1

systemctl restart forkwise-api
sleep 3
echo
curl -s http://127.0.0.1:5000/api/status
echo
echo "Done. Open https://forkwiseai.com/app and pick the new model next to the send button."
