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
    assert "j.dispatched_at <= %s" in count_sql
    assert "2026-07-01" in count_params
    assert "2026-07-27" in count_params


def test_list_jobs_pagination_uses_offset():
    conn = FakeConn([[(100,)], []])
    ops_db.list_jobs(conn, page=3, page_size=10)
    page_sql, page_params = conn.cur.executed[1]
    assert "LIMIT %s OFFSET %s" in page_sql
    assert page_params[-2:] == (10, 20)
