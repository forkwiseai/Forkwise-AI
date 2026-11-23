import json
import re

"""
Some open models, GPT-OSS above all, sometimes write a tool call as plain text
in their "harmony" format instead of a real tool call, for example:
analysisWe should list files.<|end|><|start|>assistant to=functions.bash code<|message|>{"command": "ls"}<|call|>
Without help the run then ends, because there is no tool call. This file finds
such calls, turns them into real ones and cleans the text.
"""

MARKERS = ["<|start|>", "<|channel|>", "<|message|>", "<|call|>", "<|end|>", "<|return|>", "<|constrain|>", "<|assistant", "to=functions"]
# Other open models write calls in their own chat formats (Gemma, Hermes/Qwen, Mistral, Llama, DeepSeek, XML style).
OTHER_MARKERS = ["<|tool_call>", "<tool_call|>", "<tool_call>", "</tool_call>", "[TOOL_CALLS]", "<|python_tag|>", "<function=", "<｜tool▁call", "<|tool▁call", "<tool_code>", "<start_function_call>"]
MARKERS = MARKERS + OTHER_MARKERS
HOLD = "to=functions"


def has_leak(text):
    if not text:
        return False
    for marker in MARKERS:
        if marker in text:
            return True
    return False


def analysis_start(text):
    found = re.match(r"\s*analysis(?=[A-Z<\"'(])", text)
    if found:
        return found.start()
    return -1


def first_marker(text):
    best = -1
    for marker in MARKERS:
        position = text.find(marker)
        if position >= 0 and (best < 0 or position < best):
            best = position
    start = analysis_start(text)
    if start >= 0 and (best < 0 or start < best):
        best = start
    return best


def safe_end(text):
    end = len(text)
    tail_start = max(0, end - 14)
    angle = text.rfind("<", tail_start)
    if angle >= 0 and "|>" not in text[angle:]:
        end = angle
    for size in range(len(HOLD) - 1, 1, -1):
        if text[:end].endswith(HOLD[:size]):
            end = end - size
            break
    if len(text) < 10 and "analysis".startswith(text.strip()):
        end = 0
    return end


def read_object(text, start):
    begin = text.find("{", start)
    if begin < 0:
        return None, -1
    depth = 0
    inside = False
    escaped = False
    for position in range(begin, len(text)):
        char = text[position]
        if inside:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == "\"":
                inside = False
            continue
        if char == "\"":
            inside = True
        elif char == "{":
            depth = depth + 1
        elif char == "}":
            depth = depth - 1
            if depth == 0:
                return text[begin:position + 1], position + 1
    return None, -1


def parse_object(raw):
    try:
        value = json.loads(raw)
    except ValueError:
        fixed = re.sub(r",\s*([}\]])", r"\1", raw)
        try:
            value = json.loads(fixed)
        except ValueError:
            return None
    if isinstance(value, dict):
        return value
    return None


def pick_name(word, names):
    for suffix in ["commentary", "analysis", "final", "code", "json"]:
        if word.endswith(suffix) and len(word) > len(suffix):
            word = word[:-len(suffix)]
    if word in names:
        return word
    simple = word.lower().replace("-", "_")
    for name in names:
        if name.lower() == simple:
            return name
    aliases = {"ls": "list_dir", "list_files": "list_dir", "listdir": "list_dir", "read": "read_file", "open_file": "read_file", "write": "write_file", "create_file": "write_file", "shell": "bash", "exec": "bash", "run": "bash", "terminal": "bash", "search": "grep"}
    if simple in aliases and aliases[simple] in names:
        return aliases[simple]
    return ""


GEMMA_QUOTE = '<|"|>'


def parse_gemma_value(text, position):
    """Value in Gemma's call syntax: <|"|>string<|"|>, {...}, [...], or a bare literal. Returns (value, next position)."""
    while position < len(text) and text[position] in " \n\t":
        position = position + 1
    if text.startswith(GEMMA_QUOTE, position):
        end = text.find(GEMMA_QUOTE, position + len(GEMMA_QUOTE))
        if end < 0:
            return text[position + len(GEMMA_QUOTE):], len(text)
        return text[position + len(GEMMA_QUOTE):end], end + len(GEMMA_QUOTE)
    if position < len(text) and text[position] == "{":
        return parse_gemma_object(text, position)
    if position < len(text) and text[position] == "[":
        items = []
        position = position + 1
        while position < len(text) and text[position] != "]":
            value, position = parse_gemma_value(text, position)
            items.append(value)
            while position < len(text) and text[position] in " ,\n\t":
                position = position + 1
        return items, position + 1
    end = position
    while end < len(text) and text[end] not in ",}]":
        end = end + 1
    raw = text[position:end].strip()
    if raw.startswith('"'):
        try:
            return json.loads(raw), end
        except ValueError:
            return raw.strip('"'), end
    lowered = raw.lower()
    if lowered in ("true", "false"):
        return lowered == "true", end
    if lowered in ("null", "none"):
        return None, end
    try:
        return (int(raw) if re.fullmatch(r"-?\d+", raw) else float(raw)), end
    except ValueError:
        return raw, end


def parse_gemma_object(text, position):
    """{key:value,key:value} with unquoted keys (Gemma tool calls)."""
    result = {}
    position = position + 1
    while position < len(text):
        while position < len(text) and text[position] in " ,\n\t":
            position = position + 1
        if position >= len(text) or text[position] == "}":
            return result, position + 1
        colon = text.find(":", position)
        if colon < 0:
            break
        key = text[position:colon].strip().strip('"').strip("'")
        value, position = parse_gemma_value(text, colon + 1)
        result[key] = value
    return result, position


def other_calls(text, names):
    """Calls written in Gemma, Hermes/Qwen, Mistral, Llama, DeepSeek or XML style."""
    found = []
    unknown = []

    def add(name, args):
        picked = pick_name(str(name or "").strip(), names)
        if not picked:
            unknown.append(str(name))
            return
        if isinstance(args, str):
            parsed = parse_object(args)
            args = parsed if parsed is not None else {}
        found.append({"name": picked, "arguments": json.dumps(args or {}, ensure_ascii=False)})

    # Gemma: <|tool_call>call:name{key:<|"|>value<|"|>}<tool_call|>
    for match in re.finditer(r"(?:<\|tool_call>|<start_function_call>)\s*call:\s*([A-Za-z0-9_\-.]+)\s*", text):
        if match.end() < len(text) and text[match.end()] == "{":
            args, _ = parse_gemma_object(text, match.end())
            add(match.group(1).split(".")[-1], args)
    # Hermes / Qwen: <tool_call>{"name": ..., "arguments": {...}}</tool_call>
    for match in re.finditer(r"<tool_call>\s*", text):
        raw, _ = read_object(text, match.end())
        data = parse_object(raw) if raw else None
        if data and data.get("name"):
            add(data["name"], data.get("arguments", data.get("parameters", {})))
    # Mistral: [TOOL_CALLS][{"name": ..., "arguments": {...}}]  and Llama: <|python_tag|>{"name": ..., "parameters": {...}}
    for marker in ("[TOOL_CALLS]", "<|python_tag|>"):
        position = text.find(marker)
        while position >= 0:
            rest = text[position + len(marker):].lstrip()
            if rest.startswith("["):
                try:
                    items = json.loads(rest[:rest.index("]", rest.rfind("}")) + 1])
                except (ValueError, IndexError):
                    items = []
                for item in items if isinstance(items, list) else []:
                    if isinstance(item, dict) and item.get("name"):
                        add(item["name"], item.get("arguments", item.get("parameters", {})))
            else:
                raw, _ = read_object(rest, 0)
                data = parse_object(raw) if raw else None
                if data and data.get("name"):
                    add(data["name"], data.get("arguments", data.get("parameters", {})))
            position = text.find(marker, position + len(marker))
    # XML style (Qwen coder, Llama 3.x): <function=name><parameter=key>value</parameter></function>  or  <function=name>{json}</function>
    for match in re.finditer(r"<function=([A-Za-z0-9_\-.]+)>(.*?)</function>", text, re.S):
        body = match.group(2)
        params = dict((key, value.strip("\n")) for key, value in re.findall(r"<parameter=([A-Za-z0-9_\-]+)>(.*?)</parameter>", body, re.S))
        if params:
            add(match.group(1), params)
        else:
            raw, _ = read_object(body, 0)
            add(match.group(1), parse_object(raw) if raw else {})
    # DeepSeek: <｜tool▁call▁begin｜>function<｜tool▁sep｜>name\n```json\n{...}\n```<｜tool▁call▁end｜>
    for match in re.finditer("(?:<\uff5c|<\\|)tool\u2581sep(?:\uff5c>|\\|>)\\s*([A-Za-z0-9_\\-.]+)", text):
        raw, _ = read_object(text, match.end())
        add(match.group(1), parse_object(raw) if raw else {})
    return found, unknown


def extract_calls(text, names):
    calls = []
    unknown = []
    if not text:
        return calls, unknown
    if any(marker in text for marker in OTHER_MARKERS):
        calls, unknown = other_calls(text, names)
        if calls:
            return calls, unknown
    for found in re.finditer(r"to=functions[.\s]*([A-Za-z0-9_\-]+)", text):
        raw, end = read_object(text, found.end())
        if raw is None:
            continue
        args = parse_object(raw)
        if args is None:
            continue
        name = pick_name(found.group(1), names)
        if not name:
            unknown.append(found.group(1))
            continue
        calls.append({"name": name, "arguments": json.dumps(args, ensure_ascii=False)})
    return calls, unknown


def clean(text):
    if not text:
        return "", ""
    reasoning = ""
    visible = text
    start = analysis_start(visible)
    if start >= 0:
        stop = visible.find("<|end|>", start)
        if stop >= 0:
            reasoning = visible[start + len("analysis"):stop].strip()
            visible = visible[:start] + visible[stop + len("<|end|>"):]
        else:
            reasoning = visible[start + len("analysis"):].strip()
            visible = visible[:start]
    # drop whole blocks of the other formats first
    visible = re.sub(r"(?:<\|tool_call>|<start_function_call>).*?(?:<tool_call\|>|<end_function_call>|$)", "", visible, flags=re.S)
    visible = re.sub(r"<tool_call>.*?(?:</tool_call>|$)", "", visible, flags=re.S)
    visible = re.sub(r"<function=[^>]*>.*?(?:</function>|$)", "", visible, flags=re.S)
    for marker in ("[TOOL_CALLS]", "<|python_tag|>"):
        if marker in visible:
            visible = visible[:visible.find(marker)]
    cut = first_marker(visible)
    if cut >= 0:
        rest = visible[cut:]
        final = re.search(r"<\|channel\|>\s*final\s*<\|message\|>(.*?)(<\|end\|>|<\|return\|>|$)", rest, re.S)
        visible = visible[:cut]
        if final:
            visible = visible + final.group(1)
    for marker in MARKERS:
        visible = visible.replace(marker, "")
    return visible.strip(), reasoning


def repair_note(names, unknown):
    text = "Your last message wrote a tool call as plain text (with markers like <|start|>, <|channel|>, to=functions, <tool_call> or <|tool_call>). Text like that does not run anything, so nothing happened. Call tools only through the function calling interface, one real tool call at a time, and do not write those markers in your answer."
    if unknown:
        text = text + " There is no tool named " + ", ".join(unknown[:3]) + "."
    shown = sorted(names)[:40]
    if shown:
        text = text + " Your tools are: " + ", ".join(shown) + "."
    return text
