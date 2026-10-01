"""Auto-written Analysis Notes: text, label coverage, and the Triage hooks."""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from types import SimpleNamespace  # noqa: E402

from app import auto_notes  # noqa: E402
from app import triage_actor as ta  # noqa: E402
from app.llm.gateway import LlmError  # noqa: E402
from app.verdict_lib.prompt_loader import SPECIALIST_SLUGS  # noqa: E402

from tests.test_triage_actor_terminal import _Analysis, _setup  # noqa: E402


# ── text ─────────────────────────────────────────────────────────────────


def test_every_specialist_slug_has_a_label():
    assert set(SPECIALIST_SLUGS) <= set(auto_notes.SPECIALIST_LABELS)


def test_specialist_label_adds_the_group_only_when_it_says_something():
    assert auto_notes.specialist_label("spatial") == "Spatial (Stereo)"
    assert auto_notes.specialist_label("stereo_field") == "Stereo Field"  # group already in label
    assert auto_notes.specialist_label("dynamics") == "Dynamics"
    assert auto_notes.specialist_label("overall") == "Overall Score"  # Misc adds nothing
    assert auto_notes.specialist_label("brand_new_slug") == "Brand New Slug"


def test_specialist_note_text():
    assert auto_notes.specialist_note_text("spatial", 3) == (
        "Spatial (Stereo) specialist completed: 3 additional findings."
    )
    assert auto_notes.specialist_note_text("low_end", 1) == (
        "Low End (Spectrum) specialist completed: 1 additional finding."
    )


def test_analysis_note_text_variants():
    assert auto_notes.analysis_note_text(7, ["low_end", "spatial"]) == (
        "Analysis complete: 7 initial findings. "
        "Recommended specialists: Low End (Spectrum), Spatial (Stereo)."
    )
    assert auto_notes.analysis_note_text(1, []) == (
        "Analysis complete: 1 initial finding. No additional specialists recommended."
    )
    # Degraded Triage: no plan, so no recommendation sentence at all.
    assert auto_notes.analysis_note_text(0, None) == "Analysis complete: 0 initial findings."


def test_recommended_slugs_follow_priority_and_tolerate_junk():
    plan = [
        {"name": "dynamics", "priority": 2, "focus": ""},
        {"name": "low_end", "priority": 1, "focus": ""},
        {"name": "spatial", "priority": "high", "focus": ""},
    ]
    assert auto_notes.recommended_slugs(plan) == ["low_end", "dynamics", "spatial"]


# ── add_note ─────────────────────────────────────────────────────────────


class _Recorder:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)


def test_add_note_attaches_to_the_version_owner():
    s = _Recorder()
    a = SimpleNamespace(version_id=uuid.uuid4(), user_id=uuid.uuid4())
    assert auto_notes.add_note(s, a, "hello") is True
    (note,) = s.added
    assert (note.version_id, note.user_id, note.text, note.t_seconds, note.pinned) == (
        a.version_id, a.user_id, "hello", 0.0, False,
    )


def test_add_note_skips_song_less_analyses():
    s = _Recorder()
    assert auto_notes.add_note(s, SimpleNamespace(version_id=None, user_id=uuid.uuid4()), "x") is False
    assert auto_notes.add_note(s, SimpleNamespace(version_id=uuid.uuid4(), user_id=None), "x") is False
    assert s.added == []


# ── Triage hooks ─────────────────────────────────────────────────────────


def _rows(n):
    return [SimpleNamespace(category="low_end", severity="moderate", headline="h") for _ in range(n)]


def _capture_notes(monkeypatch):
    notes: list[str] = []
    monkeypatch.setattr(ta.auto_notes, "write_note", lambda _aid, text: notes.append(text))
    return notes


def test_successful_triage_writes_the_analysis_note(monkeypatch):
    analysis = _Analysis()
    _setup(monkeypatch, analysis, rule_rows=_rows(3))
    notes = _capture_notes(monkeypatch)
    plan = (
        '{"specialists_to_run": ['
        '{"name": "spatial", "priority": 2, "focus": "x"},'
        '{"name": "low_end", "priority": 1, "focus": "y"}],'
        ' "skip": [], "rationale": "r", "estimated_total_tokens": 10}'
    )
    monkeypatch.setattr(ta.gateway, "complete_sync", lambda **_k: SimpleNamespace(text=plan))

    ta.run_triage(str(uuid.uuid4()))

    assert analysis.routing_plan is not None
    assert notes == [
        "Analysis complete: 3 initial findings. "
        "Recommended specialists: Low End (Spectrum), Spatial (Stereo)."
    ]


def test_already_planned_triage_writes_no_second_note(monkeypatch):
    analysis = _Analysis()
    analysis.routing_plan = {"specialists_to_run": []}
    _setup(monkeypatch, analysis)
    notes = _capture_notes(monkeypatch)

    ta.run_triage(str(uuid.uuid4()))

    assert notes == []


def test_degraded_triage_writes_a_count_only_note(monkeypatch):
    analysis = _Analysis()
    _setup(monkeypatch, analysis, rule_rows=_rows(2))
    notes = _capture_notes(monkeypatch)

    def boom(**_k):
        raise LlmError("model exploded")

    monkeypatch.setattr(ta.gateway, "complete_sync", boom)

    ta.run_triage(str(uuid.uuid4()))

    assert notes == ["Analysis complete: 2 initial findings."]


def test_write_note_never_raises(monkeypatch):
    def broken():
        raise RuntimeError("db down")

    monkeypatch.setattr("app.db_sync.SessionFactory.begin", broken)
    auto_notes.write_note(uuid.uuid4(), "x")  # logged, swallowed
