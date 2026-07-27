"""Flask app. All external clients injectable; defaults built from env."""
import os

from flask import Flask, jsonify, request

from . import db as dbmod
from . import ops_db as ops_dbmod
from . import wire
from . import worker_ctl as ctlmod

WORKER_DIR_DEFAULT = os.path.normpath(os.path.join(
    os.path.dirname(__file__), "..", "..", "worker"))


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

    @app.get("/")
    def index():
        return PAGE, 200, {"Content-Type": "text/html; charset=utf-8"}

    return app


PAGE = """<!doctype html>
<title>workerdash</title>
<meta charset="utf-8">
<style>
 body{font:14px/1.4 system-ui;margin:1.5rem;background:#0f1115;color:#e6e6e6}
 h1{font-size:1.2rem} h2{font-size:1rem;margin:1.2rem 0 .4rem}
 table{border-collapse:collapse;width:100%} td,th{padding:.3rem .6rem;
 border-bottom:1px solid #2a2e38;text-align:left;font-size:.85rem}
 .healthy{color:#5dd08c}.half-dead{color:#e8b34c}.dead,.unknown{color:#ef6a6a}
 button{background:#232733;color:#e6e6e6;border:1px solid #3a4050;
 border-radius:4px;padding:.15rem .55rem;cursor:pointer;margin-right:.3rem}
 button:hover{background:#2e3342} #toast{position:fixed;bottom:1rem;right:1rem;
 background:#232733;padding:.5rem .9rem;border-radius:6px;display:none}
 .mono{font-family:ui-monospace,monospace;font-size:.78rem;color:#9aa3b2}
 #restart{border-color:#a04747}
</style>
<h1>workerdash — <span id="wstatus" class="unknown">…</span>
 <span id="whb" class="mono"></span>
 <button id="restart" onclick="restartWorker()">restart worker</button></h1>
<div id="running"></div>
<div id="queues"></div>
<h2>Recent jobs</h2><div id="recent"></div>
<div id="toast"></div>
<script>
const $=q=>document.querySelector(q);
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';
 setTimeout(()=>t.style.display='none',3000)}
async function act(url){const r=await fetch(url,{method:'POST'});
 const j=await r.json();toast(j.ok?'ok':('failed: '+(j.error||'')));load()}
function restartWorker(){if(confirm('Tree-kill and relaunch the worker?'))
 act('/api/worker/restart')}
function esc(s){return String(s??'').replace(/[&<>"]/g,
 c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(){
 let s;try{s=await (await fetch('/api/state')).json()}catch(e){
  $('#wstatus').textContent='dashboard error';return}
 const w=s.worker;$('#wstatus').textContent=w.status;
 $('#wstatus').className=w.status;
 $('#whb').textContent=w.heartbeat_age==null?'(no heartbeat ever)':
  `heartbeat ${Math.round(w.heartbeat_age)}s ago · master:${w.master} fork:${w.fork}`;
 const run=(s.db&&s.db.processing)||[];
 $('#running').innerHTML='<h2>Running now</h2>'+(run.length?'<table>'+
  run.map(j=>`<tr><td>${esc(j.song)} / ${esc(j.label)}</td>
   <td>${esc(j.current_phase)}</td><td>${Math.round((j.phase_pct||0)*100)}%</td>
   <td class=mono>${esc(j.id)}</td></tr>`).join('')+'</table>'
  :'<span class=mono>idle</span>');
 $('#queues').innerHTML=s.queues.map(q=>`<h2>${q.name} (${q.depth})
  ${q.error?`<span class=dead>${esc(q.error)}</span>`:''}</h2>`+
  (q.messages.length?`<table><tr><th>#</th><th>actor</th><th>args / context</th>
   <th></th></tr>`+q.messages.map(m=>{
   const ctx=m.context?` — ${esc(m.context.song)} / ${esc(m.context.label)}`:'';
   const body=m.parse_error?`<span class=dead>${esc(m.parse_error)}</span>
    <span class=mono>${esc(m.raw)}</span>`:
    `${esc(m.actor_name)}</td><td class=mono>${esc(JSON.stringify(m.args))}${ctx}`;
   return `<tr><td>${m.position}</td><td>${body}</td><td>
    <button onclick="act('/api/queue/${q.name}/${m.redis_message_id}/front')">front</button>
    <button onclick="act('/api/queue/${q.name}/${m.redis_message_id}/cancel')">cancel</button>
    </td></tr>`}).join('')+'</table>':'<span class=mono>empty</span>'))
  .join('');
 const rec=(s.db&&s.db.recent)||[];
 $('#recent').innerHTML=s.db&&s.db.error?
  `<span class=dead>db: ${esc(s.db.error)}</span>`:
  `<table><tr><th>song</th><th>status</th><th>error</th><th>dispatched</th>
  <th></th></tr>`+rec.map(j=>`<tr><td>${esc(j.song)} / ${esc(j.label)}</td>
  <td>${esc(j.status)}</td><td>${esc(j.error_code)}</td>
  <td class=mono>${esc(j.dispatched_at)}</td>
  <td>${j.status==='failed'?`<button onclick="act('/api/jobs/${j.id}/retry')">retry full analysis</button>`:''}</td>
  </tr>`).join('')+'</table>';
}
load();setInterval(load,2000);
</script>"""
