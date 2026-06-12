"""Extract a JSON object from an LLM response. Verbatim copy of the legacy
v1 api implementation.
"""
from __future__ import annotations

import json
import re

_FENCE_RE = re.compile(
    r"```(?:json)?\s*\n(?P<body>.*?)\n```", re.DOTALL | re.IGNORECASE
)


def extract_json_object(text: str) -> dict:
    """Find and parse the first JSON object in the text.

    Tries: (1) entire text as JSON, (2) first ``` fenced block,
    (3) brace-balanced scan.
    """
    text = text.strip()

    # 1. Whole-string parse
    if text.startswith("{"):
        try:
            obj = json.loads(text)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass

    # 2. ``` fenced block
    m = _FENCE_RE.search(text)
    if m:
        try:
            obj = json.loads(m.group("body"))
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            pass

    # 3. Brace-balanced scan for first { ... }
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escape = False
        for i in range(start, len(text)):
            ch = text[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"' and not escape:
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    chunk = text[start:i + 1]
                    try:
                        obj = json.loads(chunk)
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        break  # try next start
        start = text.find("{", start + 1)

    raise ValueError("No JSON object found in LLM response")
