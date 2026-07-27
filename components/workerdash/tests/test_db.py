from workerdash import db


class FakeCursor:
    def __init__(self, rows, update_matches=True):
        self.rows = rows
        self.executed = []
        self.rowcount = 0
        self.update_matches = update_matches

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))
        self.rowcount = (1 if self.update_matches else 0) if "UPDATE" in sql else len(self.rows)

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, rows=(), update_matches=True):  # rows returned by every query
        self.cur = FakeCursor(list(rows), update_matches)
        self.committed = False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


def test_job_context_maps_rows():
    conn = FakeConn(rows=[("j1", "22", "5_bb", "complete", "")])
    ctx = db.job_context(conn, ["j1"])
    assert ctx["j1"] == {"song": "22", "label": "5_bb",
                        "status": "complete", "current_phase": ""}


def test_job_context_empty_ids_no_query():
    conn = FakeConn()
    assert db.job_context(conn, []) == {}
    assert conn.cur.executed == []


def test_mark_cancelled_updates_and_commits():
    conn = FakeConn()
    assert db.mark_cancelled(conn, "j1") is True
    sql, params = conn.cur.executed[0]
    assert "UPDATE analysis_jobs" in sql
    assert "cancelled_by_operator" in sql
    assert params == ("j1",)
    assert conn.committed


def test_mark_retry_pending_guards_failed_only():
    conn = FakeConn()
    db.mark_retry_pending(conn, "j1")
    sql, _ = conn.cur.executed[0]
    assert "status = 'pending'" in sql
    assert "status = 'failed'" in sql  # WHERE guard


def test_mark_cancelled_returns_false_when_no_row_matches():
    conn = FakeConn(update_matches=False)
    assert db.mark_cancelled(conn, "j1") is False


def test_mark_retry_pending_returns_false_when_job_not_failed():
    conn = FakeConn(update_matches=False)
    assert db.mark_retry_pending(conn, "j1") is False
