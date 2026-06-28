from aimusic_shared.verdicts.models import DspOp
from app.coach_mix import interactions as I


def test_blend_eq_same_direction_averages_freq_and_caps_sum_gain():
    a = DspOp(type="peaking_eq", params={"frequency_hz": 280.0, "gain_db": -2.0, "q": 1.0})
    b = DspOp(type="peaking_eq", params={"frequency_hz": 320.0, "gain_db": -3.0, "q": 1.0})
    out = I.blend_eq(a, b)
    assert out.type == "peaking_eq"
    assert out.params["frequency_hz"] == 300.0          # averaged
    assert out.params["gain_db"] == -5.0                # summed (within cut budget)


def test_blend_eq_caps_summed_boost_to_budget():
    a = DspOp(type="peaking_eq", params={"frequency_hz": 1000.0, "gain_db": 4.0, "q": 1.0})
    b = DspOp(type="peaking_eq", params={"frequency_hz": 1000.0, "gain_db": 4.0, "q": 1.0})
    out = I.blend_eq(a, b)
    assert out.params["gain_db"] == I.EQ_MAX_TOTAL_BOOST_DB  # 6.0 cap, not 8.0


def test_clamp_gain_total_caps_cumulative_trim():
    ops = [DspOp(type="gain", params={"gain_db": -20.0}),
           DspOp(type="gain", params={"gain_db": -20.0})]
    clamped, total = I.clamp_gain_total(ops)
    assert total == -I.MAX_CUMULATIVE_GAIN_DB   # e.g. -24.0, not -40.0
    assert len(clamped) == 1
    assert clamped[0].params["gain_db"] == -I.MAX_CUMULATIVE_GAIN_DB
