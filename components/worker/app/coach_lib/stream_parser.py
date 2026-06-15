"""Incremental sentinel-aware splitter for the v2 coach prompt
(story 1.6 / Task 3.1).

The v2 prompt emits TWO sections separated by the single sentinel line
``<<<EVIDENCE>>>``:

  Section 1 — the prose body (streamed to the user as ``token`` events)
  <<<EVIDENCE>>>
  Section 2 — a single-line JSON object with the evidence + verdict
              metadata (parsed at end-of-stream; never streamed)

Tokens arrive from the LLM in arbitrary chunks — the sentinel may
straddle a delta boundary (e.g. one delta ends with ``"foo<<<"``, the
next starts with ``"EVIDENCE>>>bar"``). :class:`StreamSplitter` buffers
the last ``len(SENTINEL) - 1`` characters of unpublished prose so the
sentinel is detectable across deltas. Once the sentinel is seen, the
splitter flips state — subsequent deltas accumulate into
``evidence_json`` and :meth:`feed` returns ``""``.

This module is pure (no I/O), making it cheap to unit-test exhaustively.
"""
from __future__ import annotations

from dataclasses import dataclass

SENTINEL = "<<<EVIDENCE>>>"


@dataclass
class ParsedStream:
    """Final state of a stream after :meth:`StreamSplitter.finish`."""

    prose: str
    """All characters published as prose tokens, concatenated."""

    evidence_json: str
    """Raw text below the sentinel — the unparsed Section 2 JSON. ``""``
    when the sentinel was never seen (e.g. the user cancelled mid-prose
    or the model crashed before emitting the JSON)."""

    saw_sentinel: bool
    """``True`` iff the sentinel was matched. The actor uses this to
    decide whether to treat a cancel-mid-stream result as a partial
    success (``status="complete"`` with empty evidence) or as an error
    (``status="error"``)."""


class StreamSplitter:
    """Streaming sentinel scanner.

    Usage::

        s = StreamSplitter()
        for delta in stream:
            chunk = s.feed(delta)
            if chunk:
                publisher.token(chunk)
        parsed = s.finish()

    Invariants:
    * Every prose character is published EXACTLY ONCE across
      :meth:`feed` returns + the final :meth:`finish` flush.
    * The sentinel itself is NEVER published.
    * After the sentinel is matched, all subsequent ``feed`` calls
      return ``""`` and append to ``evidence_json``.
    * Prefixes of the sentinel that don't extend to a full match (e.g.
      ``"<<<EVIDENCE>>"`` with two ``>``) are eventually published
      verbatim — false alarms don't strand characters in the buffer.
    """

    def __init__(self) -> None:
        self._buf = ""                # prose characters held back
        self._published: list[str] = []
        self._evidence: list[str] = []
        self._after_sentinel = False
        self._sentinel_len = len(SENTINEL)

    def feed(self, delta: str) -> str:
        """Accept the next delta from the LLM. Returns the prose chunk to
        publish (possibly ``""``). Once past the sentinel, always
        returns ``""``.
        """
        if self._after_sentinel:
            self._evidence.append(delta)
            return ""

        combined = self._buf + delta
        idx = combined.find(SENTINEL)
        if idx != -1:
            # Sentinel found. Publish everything BEFORE it; route
            # everything AFTER it to the evidence accumulator. The
            # sentinel itself is discarded.
            publishable = combined[:idx]
            remainder = combined[idx + self._sentinel_len:]
            self._buf = ""
            self._after_sentinel = True
            if remainder:
                self._evidence.append(remainder)
            self._published.append(publishable)
            return publishable

        # No sentinel yet. Keep back the last ``sentinel_len - 1`` chars
        # in case the sentinel straddles the next delta. The slack of
        # ``- 1`` is sufficient: a full sentinel cannot fit entirely in
        # the suffix without ``find`` having found it.
        keep = self._sentinel_len - 1
        if len(combined) > keep:
            publishable = combined[:-keep] if keep else combined
            self._buf = combined[-keep:] if keep else ""
        else:
            publishable = ""
            self._buf = combined

        if publishable:
            self._published.append(publishable)
        return publishable

    def finish(self) -> ParsedStream:
        """Flush remaining state and return the final parse. Idempotent
        for the publish bookkeeping — ``feed`` is not called again after
        ``finish``.

        Story 1.6 code review P10: when the stream ended without matching
        the sentinel (cancel-mid-prose OR model crashed before Section
        2), any held-back chars that look like a sentinel prefix
        (``<<<EVIDEN…``) are dropped from the flushed prose. Otherwise
        the persisted row would show a partial sentinel that the user
        never saw stream (they only saw what :meth:`feed` returned). The
        non-sentinel-prefix portion of the buffer is still flushed.
        """
        if not self._after_sentinel and self._buf:
            tail = _drop_sentinel_prefix_suffix(self._buf)
            if tail:
                self._published.append(tail)
            self._buf = ""

        return ParsedStream(
            prose="".join(self._published),
            evidence_json="".join(self._evidence),
            saw_sentinel=self._after_sentinel,
        )


def _drop_sentinel_prefix_suffix(buf: str) -> str:
    """Return ``buf`` with the longest suffix that is a prefix of
    :data:`SENTINEL` removed. Pure; cheap (linear in ``len(SENTINEL)``).
    """
    for i in range(len(SENTINEL), 0, -1):
        if buf.endswith(SENTINEL[:i]):
            return buf[:-i]
    return buf


__all__ = ["SENTINEL", "ParsedStream", "StreamSplitter"]
