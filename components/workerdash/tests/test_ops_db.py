from workerdash import ops_db


class FakeCursor:
    """Returns one canned result set per execute() call, matched by call order."""
    def __init__(self, result_sets):
        self.result_sets = list(result_sets)
        self.executed = []
        self._current = None

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))
        self._current = self.result_sets.pop(0) if self.result_sets else []

    def fetchall(self):
        return self._current

    def fetchone(self):
        return self._current[0] if self._current else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, result_sets):
        self.cur = FakeCursor(result_sets)

    def cursor(self):
        return self.cur


def test_list_jobs_maps_rows_and_total():
    rows = [("j1", "complete", "", "22", "5_bb", 3, "", "a1", "free", "2026-07-27T10:30:00+00:00", "2026-07-27T11:00:00+00:00")]
    conn = FakeConn([[(7,)], rows])  # first query: COUNT, second: page rows
    result = ops_db.list_jobs(conn, page=1, page_size=25)
    assert result["total"] == 7
    assert result["rows"] == [{
        "id": "j1", "status": "complete", "error_code": "",
        "song": "22", "label": "5_bb", "version_number": 3,
        "file_path": "", "analysis_id": "a1", "tier": "free",
        "dispatched_at": "2026-07-27T10:30:00+00:00", "completed_at": "2026-07-27T11:00:00+00:00",
        "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0,
    }]
    assert result["page"] == 1
    assert result["page_size"] == 25


def test_list_jobs_anonymous_job_uses_file_path():
    rows = [("j2", "processing", "", "", "", None, "audio/anon/dev1/j2/source.wav", None, "", "2026-07-27T10:00:00+00:00", "")]
    conn = FakeConn([[(1,)], rows])
    result = ops_db.list_jobs(conn)
    assert result["rows"][0]["song"] == ""
    assert result["rows"][0]["file_path"] == "audio/anon/dev1/j2/source.wav"


def test_list_jobs_search_filters_by_song_and_label():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, search="eterna")
    count_sql, count_params = conn.cur.executed[0]
    assert "ILIKE" in count_sql
    assert any("%eterna%" in str(p) for p in count_params)


def test_list_jobs_search_matches_job_id_prefix():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, search="bc0e6f98")
    count_sql, count_params = conn.cur.executed[0]
    assert "j.id::text ILIKE" in count_sql
    assert "bc0e6f98%" in count_params  # prefix match, not substring


def test_list_jobs_status_filter():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, status="failed")
    count_sql, count_params = conn.cur.executed[0]
    assert "j.status = %s" in count_sql
    assert "failed" in count_params


def test_list_jobs_date_range_filter():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, since="2026-07-01", until="2026-07-27")
    count_sql, count_params = conn.cur.executed[0]
    assert "j.dispatched_at >= %s" in count_sql
    assert "j.dispatched_at < (%s::date + interval '1 day')" in count_sql
    assert "2026-07-01" in count_params
    assert "2026-07-27" in count_params


def test_list_jobs_until_filter_includes_whole_day():
    # A bare date like "2026-07-27" must not be treated as midnight-only —
    # the until clause should widen to the day's exclusive end so same-day
    # since=until filters return rows dispatched any time that day.
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn, until="2026-07-27")
    count_sql, count_params = conn.cur.executed[0]
    assert "j.dispatched_at <= %s" not in count_sql
    assert "interval '1 day'" in count_sql
    assert "2026-07-27" in count_params


def test_list_jobs_order_by_has_id_tiebreaker():
    conn = FakeConn([[(0,)], []])
    ops_db.list_jobs(conn)
    page_sql, _ = conn.cur.executed[1]
    assert "ORDER BY j.dispatched_at DESC, j.id DESC" in page_sql


def test_list_jobs_pagination_uses_offset():
    conn = FakeConn([[(100,)], []])
    ops_db.list_jobs(conn, page=3, page_size=10)
    page_sql, page_params = conn.cur.executed[1]
    assert "LIMIT %s OFFSET %s" in page_sql
    assert page_params[-2:] == (10, 20)


def test_llm_totals_merges_direct_and_coach_calls():
    # first query: direct correlation_id = analysis_id rows
    direct_rows = [("a1", 1000, 200, 0.05, 3)]
    # second query: via conversations (coach)
    coach_rows = [("a1", 500, 100, 0.02, 1)]
    conn = FakeConn([direct_rows, coach_rows])
    totals = ops_db.llm_totals_by_analysis(conn, ["a1"])
    assert totals["a1"] == {
        "input_tokens": 1500, "output_tokens": 300,
        "cost_usd": 0.07, "call_count": 4,
    }


def test_llm_totals_empty_ids_no_query():
    conn = FakeConn([])
    assert ops_db.llm_totals_by_analysis(conn, []) == {}
    assert conn.cur.executed == []


def test_llm_totals_analysis_with_no_calls_absent_from_result():
    conn = FakeConn([[], []])
    totals = ops_db.llm_totals_by_analysis(conn, ["a1"])
    assert totals == {}


def test_list_jobs_includes_token_totals(monkeypatch):
    rows = [("j1", "complete", "", "22", "5_bb", 3, "", "a1", "", "2026-07-27T10:30:00+00:00", "")]
    conn = FakeConn([[(1,)], rows])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis",
                         lambda c, ids: {"a1": {"input_tokens": 500, "output_tokens": 100,
                                                 "cost_usd": 0.02, "call_count": 2}})
    result = ops_db.list_jobs(conn)
    assert result["rows"][0]["input_tokens"] == 500
    assert result["rows"][0]["output_tokens"] == 100
    assert result["rows"][0]["cost_usd"] == 0.02


def test_list_jobs_row_with_no_analysis_gets_zero_totals(monkeypatch):
    rows = [("j2", "processing", "", "", "", None, "audio/anon/x.wav", None, "", "2026-07-27T10:00:00+00:00", "")]
    conn = FakeConn([[(1,)], rows])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis", lambda c, ids: {})
    result = ops_db.list_jobs(conn)
    assert result["rows"][0]["input_tokens"] == 0
    assert result["rows"][0]["cost_usd"] == 0.0


def test_job_detail_zero_totals_not_shared_reference(monkeypatch):
    # job_detail's "totals" must be an independent copy of ZERO_TOTALS, not
    # the module-level dict itself, or a caller mutating it corrupts the
    # shared constant for every subsequent request.
    job_row = [("j1", "processing", "", "", "phase2", "free",
                "2026-07-27T00:00:00Z", "2026-07-27T00:01:00Z", None, None,
                "22", "5_bb", 3, "", False, "grouped", None,
                None, None, None, {}, None, None, None, "")]
    conn = MultiFakeConn([job_row])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis", lambda c, ids: {})
    monkeypatch.setattr(ops_db, "file_slots", lambda c, jid: {})

    detail = ops_db.job_detail(conn, "j1")
    assert detail["totals"] is not ops_db.ZERO_TOTALS
    detail["totals"]["input_tokens"] = 999999
    assert ops_db.ZERO_TOTALS["input_tokens"] == 0


def test_file_slots_full_version_row():
    row = ("v1.wav", "ref.wav", "proj.als",
           {"drums": "stems/drums.wav", "bass": ["stems/bass_l.wav", "stems/bass_r.wav"]},
           None,  # raw_audio_purged_at
           "wf.webp", "spec.webp", "peaks.json", None)  # job_file (None when version exists)
    conn = FakeConn([[row]])
    slots = ops_db.file_slots(conn, "j1")
    assert slots["source"] == {"key": "v1.wav", "label": "Source audio",
                                "purged": False, "download": False}
    assert slots["reference"]["key"] == "ref.wav"
    assert slots["als"] == {"key": "proj.als", "label": "Ableton project",
                             "purged": False, "download": True}
    assert slots["stem:drums"]["key"] == "stems/drums.wav"
    assert slots["stem:bass:0"]["key"] == "stems/bass_l.wav"
    assert slots["stem:bass:1"]["key"] == "stems/bass_r.wav"
    assert slots["waveform_image"]["key"] == "wf.webp"
    assert slots["spectrogram_image"]["key"] == "spec.webp"
    assert slots["waveform_peaks"] == {"key": "peaks.json", "label": "Waveform peaks (JSON)",
                                        "purged": False, "download": True}


def test_file_slots_purged_source_marked_not_fetched():
    row = ("v1.wav", None, None, None, "2026-07-01T00:00:00Z", None, None, None, None)
    conn = FakeConn([[row]])
    slots = ops_db.file_slots(conn, "j1")
    assert slots["source"]["purged"] is True


def test_file_slots_purged_applies_to_all_version_files():
    # When raw_audio_purged_at is set, all version-level files (source, reference, als, stems)
    # are marked purged=True, key=None. Analysis-level artifacts are unaffected.
    row = ("v1.wav", "ref.wav", "proj.als",
           {"drums": "stems/drums.wav", "bass": ["stems/bass_l.wav", "stems/bass_r.wav"]},
           "2026-07-01T00:00:00Z",  # raw_audio_purged_at
           "wf.webp", "spec.webp", "peaks.json", None)
    conn = FakeConn([[row]])
    slots = ops_db.file_slots(conn, "j1")

    # All version-level files should be purged
    assert slots["source"]["purged"] is True
    assert slots["source"]["key"] is None
    assert slots["reference"]["purged"] is True
    assert slots["reference"]["key"] is None
    assert slots["als"]["purged"] is True
    assert slots["als"]["key"] is None
    assert slots["stem:drums"]["purged"] is True
    assert slots["stem:drums"]["key"] is None
    assert slots["stem:bass:0"]["purged"] is True
    assert slots["stem:bass:0"]["key"] is None
    assert slots["stem:bass:1"]["purged"] is True
    assert slots["stem:bass:1"]["key"] is None

    # Analysis-level artifacts keep their keys unaffected by purge
    assert slots["waveform_image"]["key"] == "wf.webp"
    assert slots["waveform_image"]["purged"] is False
    assert slots["spectrogram_image"]["key"] == "spec.webp"
    assert slots["spectrogram_image"]["purged"] is False
    assert slots["waveform_peaks"]["key"] == "peaks.json"
    assert slots["waveform_peaks"]["purged"] is False


def test_file_slots_non_dict_stem_paths_does_not_raise():
    # stem_paths is a JSONB column — a non-dict value (e.g. a stray list or
    # string) must be tolerated, not raise AttributeError from .items().
    row = ("v1.wav", "ref.wav", "proj.als", ["not", "a", "dict"], None,
           "wf.webp", "spec.webp", "peaks.json", None)
    conn = FakeConn([[row]])
    slots = ops_db.file_slots(conn, "j1")
    assert slots["source"]["key"] == "v1.wav"
    assert not any(k.startswith("stem:") for k in slots)


def test_file_slots_anonymous_job_no_version():
    # job.file_path used when version_id is null (story 6.3 anon jobs)
    conn = FakeConn([[(None, None, None, None, None, None, None, None, "anon/j1/source.wav")]])
    slots = ops_db.file_slots(conn, "j1")
    assert slots["source"]["key"] == "anon/j1/source.wav"


def test_file_slots_missing_job_returns_none():
    conn = FakeConn([[]])
    assert ops_db.file_slots(conn, "nope") is None


def test_job_analysis_id_returns_id_or_none():
    conn = FakeConn([[("a1",)]])
    assert ops_db.job_analysis_id(conn, "j1") == "a1"
    conn2 = FakeConn([[]])
    assert ops_db.job_analysis_id(conn2, "j1") is None


class MultiFakeConn:
    """Like FakeConn but exposes distinct cursors per call — job_detail
    issues several independent queries and needs each to return its own
    canned rows regardless of call order within a single cursor context."""
    def __init__(self, result_sets):
        self.result_sets = list(result_sets)

    def cursor(self):
        rows = self.result_sets.pop(0) if self.result_sets else []
        return FakeCursor([rows])


def test_job_detail_missing_job_returns_none():
    conn = MultiFakeConn([[]])  # job row query returns nothing
    assert ops_db.job_detail(conn, "nope") is None


def test_job_detail_assembles_full_payload(monkeypatch):
    job_row = [("j1", "complete", "", "", "phase6", "pro",
                "2026-07-27T00:00:00Z", "2026-07-27T00:01:00Z",
                "2026-07-27T00:05:00Z", None,
                "22", "5_bb", 3, "notes", True, "grouped", "a1",
                "v3", "r1", "val1", {"phase1": 1.2}, None, None,
                {"report": "full"}, "")]
    verdict_rows = [("vrd_1", "low_end", "opus", "warn", "eq", "Headline", "Summary",
                      "2026-07-27T00:02:00Z")]
    coach_rows = [("assistant", "complete", "hi", "2026-07-27T00:03:00Z",
                   100, 20, 0.001)]
    direct_call_rows = [("call1", "specialist", "low_end", "opus", 900, 180, 0.05,
                          "success", "2026-07-27T00:02:00Z")]
    coach_call_rows = [("call2", "coach", "coach_grounded", "opus", 100, 20, 0.001,
                         "success", "2026-07-27T00:03:00Z")]

    conn = MultiFakeConn([job_row, verdict_rows, coach_rows,
                           direct_call_rows, coach_call_rows])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis",
                         lambda c, ids: {"a1": {"input_tokens": 1500, "output_tokens": 300,
                                                 "cost_usd": 0.07, "call_count": 4}})
    monkeypatch.setattr(ops_db, "file_slots", lambda c, jid: {"source": {"key": "v1.wav"}})

    detail = ops_db.job_detail(conn, "j1")
    assert detail["job"]["id"] == "j1"
    assert detail["song"]["name"] == "22"
    assert detail["analysis"]["pipeline_version"] == "v3"
    assert detail["analysis"]["final_json"] == {"report": "full"}
    assert detail["job"]["file_path"] == ""
    assert detail["totals"]["input_tokens"] == 1500
    assert detail["verdicts"][0]["specialist"] == "low_end"
    assert detail["coach_transcript"][0]["content"] == "hi"
    assert detail["files"] == {"source": {"key": "v1.wav"}}
    assert [c["id"] for c in detail["llm_calls"]] == ["call1", "call2"]
    assert detail["llm_calls"][0]["prompt_slug"] == "low_end"


def test_job_detail_no_analysis_yet_zero_totals(monkeypatch):
    job_row = [("j1", "processing", "", "", "phase2", "free",
                "2026-07-27T00:00:00Z", "2026-07-27T00:01:00Z", None, None,
                "22", "5_bb", 3, "", False, "grouped", None,
                None, None, None, {}, None, None, None, "")]
    conn = MultiFakeConn([job_row])
    monkeypatch.setattr(ops_db, "llm_totals_by_analysis", lambda c, ids: {})
    monkeypatch.setattr(ops_db, "file_slots", lambda c, jid: {})

    detail = ops_db.job_detail(conn, "j1")
    assert detail["analysis"] is None
    assert detail["totals"] == ops_db.ZERO_TOTALS
    assert detail["verdicts"] == []
    assert detail["coach_transcript"] == []
    assert detail["llm_calls"] == []
