"""rack_schema mirrors the Listen rack manifest (features/listen-rack/data.ts).
Keep ORDER / EQ_BANDS / param maps in sync with the frontend.
"""
from __future__ import annotations

from app.solve_lib import rack_schema as R


def test_order_and_bands():
    assert R.ORDER[0] == "djfilter" and R.ORDER[-1] == "trim"
    assert "eq" in R.ORDER and "limiter" in R.ORDER and "ms" in R.ORDER
    assert R.EQ_BANDS == [60.0, 170.0, 350.0, 700.0, 1400.0, 3500.0, 7000.0, 14000.0]


def test_nearest_band_slot():
    assert R.nearest_band_slot(300) == 2     # 350
    assert R.nearest_band_slot(30) == 0      # clamps to the lowest slot (60)
    assert R.nearest_band_slot(9000) == 6    # 7000
    assert R.nearest_band_slot(30000) == 7   # clamps to the highest slot (14000)


def test_dsptype_to_module():
    assert R.DSPTYPE_TO_MODULE["limiter"] == "limiter"
    assert R.DSPTYPE_TO_MODULE["compressor"] == "comp"
    assert R.DSPTYPE_TO_MODULE["stereo_width"] == "ms"
    assert R.DSPTYPE_TO_MODULE["gain"] == "trim"
    assert R.DSPTYPE_TO_MODULE["peaking_eq"] == "eq"
    # not expressible on a master rack -> absent (compiler diverts to advice)
    assert "sidechain" not in R.DSPTYPE_TO_MODULE
    assert "multiband_compressor" not in R.DSPTYPE_TO_MODULE


def test_param_map_and_band_type():
    assert R.PARAM_MAP["limiter"]["ceiling_db"] == "ceilingDb"
    assert R.PARAM_MAP["comp"]["makeup_gain_db"] == "makeupDb"
    assert R.PARAM_MAP["trim"]["gain_db"] == "gainDb"
    assert R.EQ_BAND_TYPE["peaking_eq"] == "peaking"
    assert R.EQ_BAND_TYPE["high_pass"] == "highpass"
    assert R.EQ_BAND_TYPE["low_shelf"] == "lowshelf"
