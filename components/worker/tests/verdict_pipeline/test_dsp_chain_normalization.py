"""`_hydrate` must coerce flat DSP ops into the schema's nested
``{type, params}`` shape — real models emit params at the top level
(see app/llm CLI path), which previously failed `DspOp` validation."""
from aimusic_shared.verdicts.models import DspOp

from app.verdict_lib.dsp_normalize import normalize_dsp_op as _normalize_dsp_op


def test_flat_peaking_eq_is_nested():
    op = _normalize_dsp_op(
        {"type": "peaking_eq", "frequency_hz": 320, "gain_db": -3, "q": 1.4}
    )
    assert op == {
        "type": "peaking_eq",
        "params": {"frequency_hz": 320, "gain_db": -3, "q": 1.4},
    }
    # And it now satisfies the authoritative schema.
    DspOp(**op)


def test_flat_high_pass_is_nested():
    op = _normalize_dsp_op(
        {"type": "high_pass", "frequency_hz": 180, "slope_db": 18, "q": 0.7}
    )
    DspOp(**op)
    assert op["params"]["slope_db"] == 18


def test_already_nested_passes_through_unchanged():
    src = {"type": "peaking_eq",
           "params": {"frequency_hz": 250, "gain_db": -4.0, "q": 1.2}}
    assert _normalize_dsp_op(src) is src


def test_nested_with_stray_top_level_param_is_merged():
    op = _normalize_dsp_op(
        {"type": "gain", "params": {"gain_db": -2.0}, "extra_ignored": 1}
    )
    # stray keys fold into params (then schema validation governs them)
    assert op["params"]["gain_db"] == -2.0
    assert "extra_ignored" in op["params"]


def test_non_dict_and_typeless_pass_through():
    assert _normalize_dsp_op("not-a-dict") == "not-a-dict"
    assert _normalize_dsp_op({"params": {"x": 1}}) == {"params": {"x": 1}}
