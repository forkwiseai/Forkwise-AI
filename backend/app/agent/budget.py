"""How full is the context, and when to compress it.

Before: size = characters / 3, compress at 70% of the window. Two errors:
1. Characters per token depends on the model's tokenizer and the language; Persian text and JSON differ a lot from
   English prose, so a fixed 3 is wrong by a constant factor in either direction.
2. Compressing at 70% throws away 30% of the window on every cycle.

Now: the provider reports the exact prompt size on every answer. The next size is that number scaled by the change
in characters since, so the only estimated part is one step's new text, and the tokenizer ratio is learned from the
model itself. The threshold keeps a reserve of max(15% of the window, min(16k, 30%)), as opencode does."""

RESERVE_SHARE = 0.15
RESERVE_TOKENS = 16000
RESERVE_CAP_SHARE = 0.30


def ceiling(limit):
    reserve = max(RESERVE_SHARE * limit, min(RESERVE_TOKENS, RESERVE_CAP_SHARE * limit))
    return int(limit - reserve)


def calibrated(chars_now, last_chars, last_tokens, fallback):
    """Prompt tokens now, from the last measured (chars, tokens) pair. Falls back when nothing was measured."""
    if last_chars and last_tokens and last_chars > 0 and last_tokens > 0:
        return int(chars_now * last_tokens / last_chars)
    return fallback


def compactions(steps, growth, start, limit, threshold, kept_share=0.30, summary=1500):
    """How many times a run of `steps` steps, each adding `growth` tokens, is compressed.
    After a compression the context holds the kept tail plus the summary."""
    size = start
    count = 0
    after = int(kept_share * limit) + summary
    for _ in range(steps):
        size += growth
        if size > threshold:
            count += 1
            size = after
    return count
