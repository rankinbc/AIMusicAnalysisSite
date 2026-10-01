"""Prompt caching (2026-10-01): request shape, cache-token metering + pricing,
and the shared analysis context being byte-identical across call sites."""
from __future__ import annotations

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.llm import gateway
from app.llm.gateway import flat_system, system_param, usage_counts
from app.llm.pricing import compute_cost_usd
from app.verdict_lib.input_grounding import (
    build_analysis_context,
    build_specialist_task,
    build_triage_task,
)

from .conftest import FakeMessage, install_fake_client

_EPH = {"type": "ephemeral"}
_ANALYSIS = {
    "phase1": {"lufs_integrated": -9.1, "true_peak_db": -0.4},
    "phase4": {"stems": {"status": "skipped"}},
    "track_id": "a1",
}


def _cached_message(text: str, *, inp: int, out: int, cw: int, cr: int) -> FakeMessage:
    m = FakeMessage(text, inp, out)
    m.usage.cache_creation_input_tokens = cw
    m.usage.cache_read_input_tokens = cr
    return m


# ── request shape ───────────────────────────────────────────────────────────

def test_no_options_keeps_the_plain_string():
    assert system_param("instructions") == "instructions"


def test_context_is_first_block_with_breakpoint_then_instructions():
    blocks = system_param("instructions", cached_context="ctx")
    assert blocks == [
        {"type": "text", "text": "ctx", "cache_control": _EPH},
        {"type": "text", "text": "instructions"},
    ]


def test_cache_system_marks_the_instructions_block():
    assert system_param("instructions", cache_system=True) == [
        {"type": "text", "text": "instructions", "cache_control": _EPH},
    ]


def test_cli_transport_gets_context_then_instructions_as_one_string():
    assert flat_system("instructions", "ctx") == "ctx\n\ninstructions"
    assert flat_system("instructions", None) == "instructions"


# ── usage + pricing ─────────────────────────────────────────────────────────

def test_usage_counts_reads_cache_fields_and_tolerates_odd_shapes():
    u = SimpleNamespace(input_tokens=10, output_tokens=20,
                        cache_creation_input_tokens=30, cache_read_input_tokens=40)
    assert usage_counts(u) == (10, 20, 30, 40)
    # Older usage objects lack the cache fields; mocks return non-ints.
    assert usage_counts(SimpleNamespace(input_tokens=5, output_tokens=6)) == (5, 6, 0, 0)
    assert usage_counts(MagicMock()) == (0, 0, 0, 0)
    assert usage_counts(None) == (0, 0, 0, 0)


def test_cache_writes_bill_125pct_and_reads_10pct_of_input_rate():
    # Sonnet 4.x input = $3/MTok.
    assert compute_cost_usd("claude-sonnet-4-5", 0, 0, 1_000_000, 0) == Decimal("3.750000")
    assert compute_cost_usd("claude-sonnet-4-5", 0, 0, 0, 1_000_000) == Decimal("0.300000")
    # Legacy two-arg calls are unchanged.
    assert compute_cost_usd("claude-sonnet-4-5", 1_000_000, 0) == Decimal("3.000000")


def test_complete_sends_blocks_and_meters_cache_tokens(configure, metered, monkeypatch):
    configure()
    msgs = install_fake_client(
        monkeypatch,
        lambda n, kw: _cached_message("ok", inp=100, out=50, cw=0, cr=20_000),
    )
    result = asyncio.run(gateway.complete(
        system="specialist prompt", user="task", purpose="specialist",
        cached_context="analysis ctx",
    ))
    sent = msgs.calls[0]["system"]
    assert sent[0] == {"type": "text", "text": "analysis ctx", "cache_control": _EPH}
    assert sent[1] == {"type": "text", "text": "specialist prompt"}
    assert msgs.calls[0]["messages"] == [{"role": "user", "content": "task"}]

    assert result.cache_read_input_tokens == 20_000
    assert metered[0]["cache_read_input_tokens"] == 20_000
    assert metered[0]["cache_creation_input_tokens"] == 0
    # 100 in @3 + 20k read @0.3 + 50 out @15 (per MTok)
    assert result.cost_usd == Decimal("0.000300") + Decimal("0.006000") + Decimal("0.000750")


def test_complete_without_caching_sends_a_plain_string(configure, metered, monkeypatch):
    configure()
    msgs = install_fake_client(monkeypatch, lambda n, kw: FakeMessage("ok"))
    asyncio.run(gateway.complete(system="s", user="u", purpose="triage"))
    assert msgs.calls[0]["system"] == "s"
    assert metered[0]["cache_read_input_tokens"] == 0


# ── the shared context is shareable ─────────────────────────────────────────

def test_analysis_context_depends_only_on_the_analysis():
    ctx = build_analysis_context(dict(_ANALYSIS))
    assert ctx == build_analysis_context(dict(_ANALYSIS))
    assert '"lufs_integrated": -9.1' in ctx
    assert "INPUTS ACTUALLY PROVIDED" in ctx  # grounding stays with the data


def test_per_call_tasks_carry_no_analysis_data():
    rule = SimpleNamespace(category="loudness", severity="high", headline="Too loud")
    triage = build_triage_task([rule])
    spec = build_specialist_task("low end")
    for task in (triage, spec):
        assert "lufs_integrated" not in task
    assert '"rule_engine_findings"' in triage and "Too loud" in triage
    assert "Triage focus: low end" in spec
