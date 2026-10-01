"""Specialist output limits (first production run, 2026-10-01).

Against the real Anthropic API, three of four specialists stopped at exactly
the gateway's default 4096 output tokens — the JSON was cut off mid-array and
the verdict fell back to a "Specialist failed" marker. The fourth lost four of
five findings because ``why_it_matters`` ran past its 200-char cap and
validation rejected the whole verdict. These tests pin both fixes.
"""
import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import verdict_actor as va  # noqa: E402


def _raw(**over):
    raw = {
        "severity": "moderate",
        "category": "stereo_phase",
        "confidence": 0.8,
        "headline": "Mix too narrow",
        "summary": "Correlation 0.74 indicates a center-heavy mix.",
        "evidence": [{"metric": "phase1.stereo_correlation", "value": 0.74, "label": "correlation"}],
        "why_it_matters": "Short reason.",
    }
    raw.update(over)
    return raw


def _hydrate(raw):
    return va._hydrate(raw, track_id="t", slug="stereo_phase", prompt_version="v1", model="m")


def test_overlong_why_it_matters_is_clipped_not_dropped():
    long = ("Club systems often sum bass to mono, so anything that lives only in "
            "the sides will vanish on mono speakers and phones. ") * 3
    v = _hydrate(_raw(why_it_matters=long))
    assert len(v.why_it_matters) <= 200
    assert v.why_it_matters.endswith("…")
    # clipped at a word boundary, not mid-word
    assert v.why_it_matters[:-1] == v.why_it_matters[:-1].rstrip()
    assert long.startswith(v.why_it_matters[:-1])


def test_overlong_headline_and_summary_are_clipped():
    v = _hydrate(_raw(headline="word " * 40, summary="longer text " * 60))
    assert len(v.headline) <= 80
    assert len(v.summary) <= 300


def test_fields_within_limits_are_untouched():
    v = _hydrate(_raw())
    assert v.why_it_matters == "Short reason."
    assert v.headline == "Mix too narrow"


def test_specialist_call_asks_for_a_large_output_budget(monkeypatch):
    class _Analysis:
        id = uuid.uuid4()
        final_json = {"phases": []}
        job_id = None

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get(self, *_a):
            return _Analysis()

        def execute(self, _stmt):
            class _R:
                def first(self_inner):
                    return None
            return _R()

    seen = {}

    def fake_llm(**kw):
        seen.update(kw)
        raise va.LlmError("stop here")

    monkeypatch.setattr(va.SessionFactory, "begin", lambda: _Session())
    monkeypatch.setattr(va, "load_prompt", lambda _s: ("v1", "system"))
    monkeypatch.setattr(va, "load_prompt_model", lambda _s: None)
    monkeypatch.setattr(va.gateway, "complete_sync", fake_llm)
    monkeypatch.setattr(va, "_persist_fail_marker", lambda *a, **k: None)

    va.run_specialist.fn(str(_Analysis.id), "low_end", str(uuid.uuid4()))
    assert seen.get("max_tokens", 4096) >= 16000
    assert seen.get("timeout_s", 0) >= 240
