"""Checks the final answer against what really happened in the run.

The failed run said "Verified: 8 slides found" and "the file is ready" while its own check only counted pictures.
A final answer is a set of claims. Two kinds can be checked exactly, with no model involved:
- a file the answer says was made or saved must exist;
- a slide count the answer states must equal the count in the deck on disk.
Anything that fails goes back to the agent at the finish gate, like a failing build."""

import re

PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
URL = re.compile(r"\b(?:https?|file|computer)://\S+", re.I)
PATH = re.compile(r"(?<![\w/.-])((?:[\w.\-]+/)*[\w\-]+\.(?:pptx|pdf|docx|xlsx|csv|html|py|js|jsx|ts|tsx|json|md|png|jpe?g|mp4|zip|svg))(?![\w/])", re.I)
MADE = re.compile(r"creat|made|built|saved|wrote|generat|ready|export|deliver|ساخت|ساختم|ذخیره|نوشتم|آماده|تولید|ایجاد", re.I)
SLIDES = re.compile(r"(\d{1,3})\s*(?:-|‌|\s)?(?:slides?\b|اسلاید)", re.I)


def made_paths(text):
    """Paths named on a line that also says the file was made."""
    found = []
    for line in URL.sub(" ", text).splitlines():
        if not MADE.search(line):
            continue
        for match in PATH.finditer(line):
            if match.group(1) not in found:
                found.append(match.group(1))
    return found


def stated_slides(text):
    return sorted(set(int(match.group(1)) for match in SLIDES.finditer(text.translate(PERSIAN_DIGITS)) if int(match.group(1)) > 0))


def check(text, exists, deck_counts):
    """exists(path) -> bool. deck_counts: {path: number of slides} for decks made in this run."""
    problems = []
    for path in made_paths(text or ""):
        try:
            present = exists(path)
        except ValueError:
            continue
        if not present:
            problems.append("Your answer says " + path + " was made, but no such file exists. Make it, or correct the answer.")
    counts = sorted(set(deck_counts.values()))
    stated = stated_slides(text or "")
    if counts and stated and len(deck_counts) == 1:
        wrong = [number for number in stated if number not in counts]
        if wrong:
            problems.append("Your answer says the deck has " + ", ".join(str(n) for n in wrong) + " slides, but the file has " + str(counts[0]) + ". Fix the deck or the answer.")
    return problems
