"""Flask app. All external clients injectable; defaults built from env."""
import os

from flask import Flask, jsonify, request, send_file, after_this_request

from . import db as dbmod
from . import files as files_mod
from . import ops_db as ops_dbmod
from . import runlogs
from . import wire
from . import worker_ctl as ctlmod
from .page import PAGE

WORKER_DIR_DEFAULT = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "worker"))


def _read_watchdog_status():
    """Watchdog heartbeat for the header: parsed status file, or None when no
    watchdog is running (or its file is stale > 2 probe intervals)."""
    import json as _json
    import time as _time
    from .watchdog import INTERVAL_S, LOG_DIR_DEFAULT
    path = os.environ.get(
        "WATCHDOG_STATUS_FILE", os.path.join(LOG_DIR_DEFAULT, "watchdog-status.json"))
    try:
        with open(path, encoding="utf-8") as f:
            s = _json.load(f)
        if _time.time() - float(s.get("ts", 0)) > INTERVAL_S * 2 + 5:
            return None  # watchdog stopped writing — treat as not running
        return {"halted": bool(s.get("halted")), "action": s.get("action"),
                "restarts_in_window": s.get("restarts_in_window", 0)}
    except Exception:
        return None


def _default_redis():
    import redis
    return redis.Redis.from_url(
        os.environ.get("REDIS_URL", "redis://localhost:6379/0"))


def create_app(redis_client=None, db_connect=None, ctl=None) -> Flask:
    app = Flask(__name__)
    r = redis_client or _default_redis()
    connect = db_connect or dbmod.connect
    ctl = ctl or ctlmod

    @app.before_request
    def _reject_cross_origin():
        # Localhost bind != CSRF-safe: a hostile page can still fire no-cors
        # POSTs at 127.0.0.1. Host+Origin allowlist closes that.
        host = (request.host or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            return jsonify({"ok": False, "error": "forbidden host"}), 403
        origin = request.headers.get("Origin")
        if origin:
            o = origin.split("//")[-1].split(":")[0]
            if o not in ("127.0.0.1", "localhost"):
                return jsonify({"ok": False, "error": "forbidden origin"}), 403

    def db_section():
        """Postgres context; degrades to {'error': ...} instead of failing."""
        conn = None
        try:
            conn = connect()
            return {
                "processing": dbmod.processing_jobs(conn),
                "recent": dbmod.recent_jobs(conn),
            }, conn
        except Exception as e:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
            return {"error": str(e)}, None

    @app.get("/api/ops")
    def ops_list():
        args = request.args
        page, page_size = 1, 25
        conn = None
        try:
            page = int(args.get("page", 1))
            page_size = int(args.get("page_size", 25))
            kwargs = {
                "search": args.get("search") or None,
                "status": args.get("status") or None,
                "since": args.get("since") or None,
                "until": args.get("until") or None,
                "page": page,
                "page_size": page_size,
            }
            conn = connect()
            result = ops_dbmod.list_jobs(conn, **kwargs)
            return jsonify({"ok": True, **result})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e), "rows": [],
                             "total": 0, "page": page, "page_size": page_size})
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    @app.get("/api/ops/<job_id>")
    def ops_detail(job_id):
        conn = None
        try:
            conn = connect()
            detail = ops_dbmod.job_detail(conn, job_id)
            if detail is None:
                return jsonify({"ok": False, "error": "not found"}), 404
            return jsonify({"ok": True, **detail})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    @app.get("/api/ops/<job_id>/file/<path:slot>")
    def ops_file(job_id, slot):
        conn = None
        try:
            conn = connect()
            slots = ops_dbmod.file_slots(conn, job_id) or {}
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 404
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

        entry = slots.get(slot)
        if entry is None:
            return jsonify({"ok": False, "error": "unknown file slot"}), 404
        if entry.get("purged"):
            return jsonify({"ok": False, "error": "source audio purged"}), 404
        if not entry.get("key"):
            return jsonify({"ok": False, "error": "file not available for this run"}), 404

        try:
            local_path, fetched = files_mod.resolve(entry["key"])
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 404
        if local_path is None:
            return jsonify({"ok": False, "error": "file not found"}), 404

        if fetched is not None:
            @after_this_request
            def _cleanup(response):
                files_mod.cleanup(fetched)
                return response

        return send_file(local_path, mimetype=files_mod.content_type_for(local_path),
                          as_attachment=bool(entry.get("download")),
                          download_name=local_path.name)

    @app.get("/api/ops/<job_id>/json")
    def ops_json(job_id):
        conn = None
        try:
            conn = connect()
            report = ops_dbmod.analysis_final_json(conn, job_id)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 404
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
        if report is None:
            return jsonify({"ok": False, "error": "no analysis for this job"}), 404
        resp = jsonify(report)
        resp.headers["Content-Disposition"] = f'attachment; filename="{job_id}-report.json"'
        return resp

    @app.get("/api/state")
    def state():
        try:
            hb = wire.heartbeat_age_seconds(r)
            p = ctl.probe()
            worker = {"heartbeat_age": hb, **p,
                      "status": ctl.derive_status(p["master"], p["fork"], hb)}
            try:
                worker["allin1_container"] = ctl.allin1_container()
            except AttributeError:
                worker["allin1_container"] = None  # test stubs may omit it
            worker["watchdog"] = _read_watchdog_status()
            queues = []
            for q in wire.QUEUES:
                try:
                    msgs = wire.list_queue(r, q)
                except Exception as e:
                    msgs, q_err = [], str(e)
                else:
                    q_err = None
                queues.append({"name": q, "depth": len(msgs),
                               "messages": msgs, "error": q_err})
        except Exception as e:
            return jsonify({"worker": {"status": "unknown", "error": str(e)},
                            "queues": [], "db": {"error": "skipped"}})
        dbs, conn = db_section()
        # resolve song/version context for queued analyze_audio_job args
        if conn is not None:
            job_ids = [m["args"][0] for q in queues for m in q["messages"]
                       if m.get("actor_name") == "analyze_audio_job" and m.get("args")]
            try:
                ctx = dbmod.job_context(conn, job_ids)
                for q in queues:
                    for m in q["messages"]:
                        if m.get("actor_name") == "analyze_audio_job" and m.get("args"):
                            m["context"] = ctx.get(m["args"][0])
            except Exception:
                pass
            finally:
                conn.close()
        return jsonify({"worker": worker, "queues": queues, "db": dbs})

    def _check_queue(queue):
        return queue in wire.QUEUES

    @app.post("/api/queue/<queue>/<rid>/cancel")
    def cancel(queue, rid):
        if not _check_queue(queue):
            return jsonify({"ok": False, "error": "unknown queue"}), 404
        try:
            # read actor before deleting so we can mark the DB row
            row = next((m for m in wire.list_queue(r, queue)
                        if m["redis_message_id"] == rid), None)
            ok = wire.cancel_message(r, queue, rid)
            if ok and row and row.get("actor_name") == "analyze_audio_job" and row.get("args"):
                try:
                    conn = connect()
                    try:
                        dbmod.mark_cancelled(conn, row["args"][0])
                    finally:
                        conn.close()
                except Exception:
                    pass  # queue removal succeeded; DB mark is best-effort
            return jsonify({"ok": ok})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    @app.post("/api/queue/<queue>/<rid>/front")
    def front(queue, rid):
        if not _check_queue(queue):
            return jsonify({"ok": False, "error": "unknown queue"}), 404
        try:
            return jsonify({"ok": wire.bring_to_front(r, queue, rid)})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    @app.post("/api/jobs/<job_id>/retry")
    def retry(job_id):
        conn = None
        try:
            conn = connect()
            if not dbmod.mark_retry_pending(conn, job_id):
                return jsonify({"ok": False, "error": "job is not in failed state"})
            try:
                rid = wire.enqueue(r, "analyze_audio_job", [job_id], "analysis-paid")
            except Exception as e:
                try:
                    dbmod.revert_retry(conn, job_id)
                except Exception:
                    pass
                return jsonify({"ok": False, "error": f"enqueue failed: {e}"})
            return jsonify({"ok": True, "redis_message_id": rid})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    @app.post("/api/worker/restart")
    def restart():
        try:
            return jsonify(ctl.restart(
                os.environ.get("WORKER_DIR", WORKER_DIR_DEFAULT)))
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    runlogs.register(app)

    @app.get("/")
    def index():
        return PAGE, 200, {"Content-Type": "text/html; charset=utf-8"}

    return app

