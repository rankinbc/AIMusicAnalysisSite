def test_public_api_re_exports():
    import audio_analysis.stems as s
    for name in ("detect_role", "propose_mapping", "validate_confirmed_mapping",
                 "analyze", "compare", "StemRole", "FreqBand", "StemMetrics",
                 "StemAnalysisResult", "StemReferenceDelta"):
        assert hasattr(s, name), f"missing public export: {name}"
