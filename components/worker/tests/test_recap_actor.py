"""Listen V3 (PRP-4) — unit tests for the synthesize_recap projection.

compute_recap is pure (no I/O), so the recap maths is tested in isolation:
reaction-density hottest moments, emoji histogram, peak concurrency, attendance.
The CAS-flush / Redis-DEL idempotency is exercised in the BFF integration layer.
"""
from __future__ import annotations

from app.recap_actor import compute_recap


def _reaction(seq: int, emoji: str, t: float, actor=None):
    return {"type": "reaction", "seq": seq, "emoji": emoji, "t": t,
            "actor": actor or {"type": "user", "userId": "u1"}}


def _presence(seq: int, state: str, key: str):
    return {"type": "presence", "seq": seq, "state": state,
            "actor": {"type": "user", "userId": key}}


def test_hottest_moments_bucket_by_playhead_and_pick_top_emoji():
    # Two reactions in the 60-65s bucket (🔥 wins), one lone reaction at 132s.
    events = [
        _reaction(2, "🔥", 61),
        _reaction(3, "🔥", 64),
        _reaction(4, "👀", 62),
        _reaction(5, "👀", 132),
    ]
    recap = compute_recap(events)
    hottest = recap["hottestMoments"]
    assert hottest[0] == {"t": 60, "reactionCount": 3, "topEmoji": "🔥"}
    assert {"t": 130, "reactionCount": 1, "topEmoji": "👀"} in hottest


def test_histogram_counts_every_reaction_emoji():
    events = [_reaction(2, "🔥", 10), _reaction(3, "🔥", 11), _reaction(4, "👍", 12)]
    recap = compute_recap(events)
    assert recap["reactionHistogram"] == {"🔥": 2, "👍": 1}


def test_peak_concurrency_tracks_running_max():
    events = [
        _presence(1, "join", "a"),
        _presence(2, "join", "b"),
        _presence(3, "join", "c"),   # peak = 3 here
        _presence(4, "leave", "a"),
        _presence(5, "leave", "b"),
    ]
    recap = compute_recap(events)
    assert recap["peakConcurrency"] == 3


def test_attendance_dedups_by_actor():
    events = [
        _presence(1, "join", "a"),
        _presence(2, "leave", "a"),
        _presence(3, "join", "a"),   # same actor rejoined — counted once
        _presence(4, "join", "b"),
    ]
    recap = compute_recap(events)
    keys = {a["userId"] for a in recap["attendance"]}
    assert keys == {"a", "b"}


def test_empty_log_yields_empty_recap():
    recap = compute_recap([])
    assert recap == {
        "hottestMoments": [],
        "reactionHistogram": {},
        "peakConcurrency": 0,
        "attendance": [],
    }
