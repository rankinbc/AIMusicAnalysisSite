import soundfile as sf


def test_synth_stems_exist(synth_stem_files):
    for path in synth_stem_files.values():
        assert path.exists()
        info = sf.info(path)
        assert info.samplerate == 44100
        assert info.channels == 2
