"""Unit tests for the sentinel-aware streaming splitter (story 1.6 / Task 6.1).

The :class:`StreamSplitter` is load-bearing: it decides what the user
sees streamed live vs what the server buffers for end-of-stream
evidence parsing. Boundary cases (sentinel straddling deltas, false
alarms on near-matches, never-saw-sentinel cancel paths) are tested
exhaustively here so the actor + publisher logic above it can trust
the splitter.
"""
from __future__ import annotations

from app.coach_lib.stream_parser import SENTINEL, StreamSplitter


def test_happy_path_emits_prose_then_routes_evidence():
    s = StreamSplitter()
    a = s.feed("hello ")
    b = s.feed("world\n")
    c = s.feed("<<<EVIDENCE>>>\n")
    d = s.feed('{"kind":"answer","evidence":[]}')
    parsed = s.finish()

    # ``feed`` returns the just-publishable slice each call. Concatenating
    # them gives the prose the actor will have streamed.
    streamed = a + b + c + d
    assert streamed == "hello world\n"
    assert parsed.saw_sentinel is True
    # The exact ``parsed.prose`` may include a buffered tail that ``feed``
    # didn't flush, but it MUST contain everything streamed.
    assert "hello world\n" in parsed.prose
    # ``evidence_json`` keeps whatever whitespace followed the sentinel —
    # downstream ``extract_json_object`` strips before parsing, so this is
    # benign. We assert the JSON-content equivalence, not byte-equality.
    assert parsed.evidence_json.strip() == '{"kind":"answer","evidence":[]}'


def test_sentinel_straddles_delta_boundary():
    """A model can split the sentinel across deltas — splitter must
    still match it. Pre-fix, the bug surfaces as the sentinel leaking
    into the published prose AND the evidence section being lost.
    """
    s = StreamSplitter()
    a = s.feed("foo<<<")          # buffered, nothing publishable yet
    b = s.feed("EVIDENCE>>>bar")  # sentinel completes here
    parsed = s.finish()

    streamed = a + b
    assert streamed == "foo"
    assert parsed.saw_sentinel is True
    assert parsed.prose == "foo"
    assert parsed.evidence_json == "bar"


def test_sentinel_split_into_three_deltas():
    """Worst-case: model emits sentinel character-by-character across
    multiple deltas. Splitter buffer must hold ``len(SENTINEL)-1``
    characters between feeds.
    """
    s = StreamSplitter()
    publishable = ""
    for ch in "hi <<<" "EVID" "ENCE>>>" "json":
        # Feed one character at a time.
        for c in ch:
            publishable += s.feed(c)
    parsed = s.finish()

    assert publishable == "hi "
    assert parsed.saw_sentinel is True
    assert parsed.evidence_json == "json"


def test_never_saw_sentinel_preserves_all_prose():
    """Cancel-mid-stream + a model that crashed before emitting the
    sentinel both terminate without a sentinel match. The actor uses
    ``parsed.saw_sentinel`` to branch into ``_mark_complete_partial``.
    """
    s = StreamSplitter()
    s.feed("only prose, no sentinel here")
    parsed = s.finish()

    assert parsed.saw_sentinel is False
    # Everything streamed PLUS any held-back buffer must end up in prose.
    assert parsed.prose == "only prose, no sentinel here"
    assert parsed.evidence_json == ""


def test_sentinel_prefix_false_alarm_eventually_publishes():
    """``<<<EVIDENCE>>`` (two ``>`` not three) is NOT the sentinel. The
    splitter must NOT swallow the characters — they belong in the prose
    stream once the buffer drains.
    """
    s = StreamSplitter()
    s.feed("hi <<<EVIDENCE>>")        # near-match buffered as suspicion
    s.feed(" more prose tail end ")    # buffer flushes; near-match is prose
    parsed = s.finish()

    assert parsed.saw_sentinel is False
    # Order preserved; the near-match characters are NOT lost.
    assert "<<<EVIDENCE>>" in parsed.prose
    assert "hi" in parsed.prose
    assert "tail" in parsed.prose


def test_post_sentinel_feed_accumulates_evidence_only():
    """Once past the sentinel, every subsequent ``feed`` is evidence —
    publishable return MUST be ``""`` (no leaking JSON tokens into the
    user-visible stream)."""
    s = StreamSplitter()
    s.feed("prose ")
    s.feed(SENTINEL)
    a = s.feed('{"kind":')
    b = s.feed('"answer"}')
    parsed = s.finish()

    assert a == ""
    assert b == ""
    assert parsed.evidence_json == '{"kind":"answer"}'
    assert parsed.saw_sentinel is True


def test_empty_stream():
    s = StreamSplitter()
    parsed = s.finish()
    assert parsed.prose == ""
    assert parsed.evidence_json == ""
    assert parsed.saw_sentinel is False


def test_cancel_mid_sentinel_drops_partial_sentinel_from_prose():
    """Story 1.6 code review P10: when the stream ended without matching
    the sentinel AND the held-back buffer ends with a sentinel prefix
    (cancel-mid-stream right as the model started emitting ``<<<EVID…``),
    ``finish()`` must NOT flush those partial-sentinel chars into prose.
    Otherwise the persisted row shows ``…end<<<EVIDEN`` to the user on
    refresh while the SSE consumer only saw ``…end``.
    """
    s = StreamSplitter()
    s.feed("Start with the low end<<<EVIDEN")
    parsed = s.finish()

    assert parsed.saw_sentinel is False
    # The partial sentinel must NOT appear in persisted prose.
    assert "<<<" not in parsed.prose
    assert "EVID" not in parsed.prose
    # The legitimate prose is preserved.
    assert "Start with the low" in parsed.prose
