"""Flask app. All external clients injectable; defaults built from env."""
import os

from flask import Flask, jsonify, request, send_file, after_this_request

from . import db as dbmod
from . import files as files_mod
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
 .tabs{margin-bottom:1rem}.tabbtn{background:#1a1d24;color:#9aa3b2;border:1px solid #2a2e38;
 border-radius:4px 4px 0 0;padding:.4rem 1rem;cursor:pointer;margin-right:.2rem}
 .tabbtn.active{background:#232733;color:#e6e6e6;border-bottom-color:#232733}
 .opsFilters{display:flex;gap:.5rem;margin-bottom:.7rem}
 .opsFilters input,.opsFilters select{background:#1a1d24;color:#e6e6e6;
 border:1px solid #2a2e38;border-radius:4px;padding:.3rem .5rem}
 .pagebtn{margin-right:.3rem}
</style>
<h1>workerdash — <span id="wstatus" class="unknown">…</span>
 <span id="whb" class="mono"></span>
 <button id="restart" onclick="restartWorker()">restart worker</button></h1>
<div class="tabs">
 <button id="tabLive" class="tabbtn active" onclick="showTab('live')">Live</button>
 <button id="tabOps" class="tabbtn" onclick="showTab('ops')">Operations</button>
</div>
<div id="liveView">
<div id="running"></div>
<div id="queues"></div>
<h2>Recent jobs</h2><div id="recent"></div>
</div>
<div id="opsView" style="display:none">
 <div class="opsFilters">
  <input id="opsSearch" placeholder="search song/version…" oninput="opsDebouncedSearch()">
  <select id="opsStatus" onchange="opsLoad(1)">
   <option value="">any status</option>
   <option value="pending">pending</option>
   <option value="processing">processing</option>
   <option value="complete">complete</option>
   <option value="failed">failed</option>
  </select>
  <input id="opsSince" type="date" onchange="opsLoad(1)">
  <input id="opsUntil" type="date" onchange="opsLoad(1)">
 </div>
 <div id="opsTable"></div>
 <div id="opsPager"></div>
 <div id="opsDetail"></div>
</div>
<div id="toast"></div>
<script>
const $=q=>document.querySelector(q);
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';
 setTimeout(()=>t.style.display='none',3000)}
async function act(url){const r=await fetch(url,{method:'POST'});
 const j=await r.json();toast(j.ok?'ok':('failed: '+(j.error||'')));load()}
function restartWorker(){if(confirm('Tree-kill and relaunch the worker?'))
 act('/api/worker/restart')}
function esc(s){return String(s??'').replace(/[&<>"']/g,
 c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
let opsPage=1,opsSearchTimer=null;
function showTab(t){
 $('#tabLive').classList.toggle('active',t==='live');
 $('#tabOps').classList.toggle('active',t==='ops');
 $('#liveView').style.display=t==='live'?'':'none';
 $('#opsView').style.display=t==='ops'?'':'none';
 if(t==='ops')opsLoad(1);
}
function opsDebouncedSearch(){
 clearTimeout(opsSearchTimer);
 opsSearchTimer=setTimeout(()=>opsLoad(1),300);
}
async function opsLoad(page){
 opsPage=page;
 const q=new URLSearchParams({page,page_size:25});
 const search=$('#opsSearch').value.trim();
 const status=$('#opsStatus').value;
 const since=$('#opsSince').value;
 const until=$('#opsUntil').value;
 if(search)q.set('search',search);
 if(status)q.set('status',status);
 if(since)q.set('since',since);
 if(until)q.set('until',until);
 let s;try{s=await (await fetch('/api/ops?'+q)).json()}catch(e){
  $('#opsTable').innerHTML='<span class=dead>failed to load</span>';return}
 if(!s.ok){$('#opsTable').innerHTML=`<span class=dead>${esc(s.error||'error')}</span>`;return}
 $('#opsTable').innerHTML=s.rows.length?'<table><tr><th>song</th><th>status</th>'+
  '<th>error</th><th>dispatched</th><th>tokens</th><th>cost</th><th></th></tr>'+
  s.rows.map(j=>{
   const label=j.song?`${esc(j.song)} / ${esc(j.label)} v${j.version_number}`:
    `(anon) ${esc(j.file_path)}`;
   return `<tr><td>${label}</td><td>${esc(j.status)}</td><td>${esc(j.error_code)}</td>`+
    `<td class=mono>${esc(j.dispatched_at)}</td>`+
    `<td class=mono>${(j.input_tokens||0)+(j.output_tokens||0)}</td>`+
    `<td class=mono>$${(j.cost_usd||0).toFixed(4)}</td>`+
    `<td><button onclick="openJob('${esc(j.id)}')">view</button></td></tr>`}).join('')+
  '</table>':'<span class=mono>no runs match</span>';
 const totalPages=Math.max(1,Math.ceil(s.total/s.page_size));
 $('#opsPager').innerHTML=`<span class=mono>page ${s.page}/${totalPages} (${s.total} total)</span> `+
  `<button class=pagebtn ${s.page<=1?'disabled':''} onclick="opsLoad(${s.page-1})">prev</button>`+
  `<button class=pagebtn ${s.page>=totalPages?'disabled':''} onclick="opsLoad(${s.page+1})">next</button>`;
}
function fmtCost(n){return '$'+(n||0).toFixed(4)}
function fileLink(jobId,slot,entry){
 if(!entry)return `<span class=mono>${esc(slot)}: n/a</span>`;
 if(entry.purged)return `<span class=mono>${esc(entry.label)}: purged</span>`;
 if(!entry.key)return `<span class=mono>${esc(entry.label)}: n/a</span>`;
 const url=`/api/ops/${encodeURIComponent(jobId)}/file/${encodeURIComponent(slot)}`;
 if(slot==='waveform_image'||slot==='spectrogram_image')
  return `<div>${esc(entry.label)}<br><img src="${url}" style="max-width:100%"></div>`;
 if(slot==='source'||slot==='reference'||slot.startsWith('stem:'))
  return `<div>${esc(entry.label)}<br><audio controls src="${url}"></audio></div>`;
 return `<div><a href="${url}" download>${esc(entry.label)}</a></div>`;
}
async function openJob(jobId){
 showTab('ops');
 history.pushState({},'', '?job='+encodeURIComponent(jobId));
 $('#opsDetail').innerHTML='<span class=mono>loading…</span>';
 let s;try{s=await (await fetch('/api/ops/'+encodeURIComponent(jobId))).json()}catch(e){
  $('#opsDetail').innerHTML='<span class=dead>failed to load</span>';return}
 if(!s.ok){$('#opsDetail').innerHTML=`<span class=dead>${esc(s.error||'error')}</span>`;return}
 const t=s.totals||{};
 const files=Object.entries(s.files||{}).map(([slot,e])=>fileLink(jobId,slot,e)).join('');
 const calls=(s.llm_calls||[]).map(c=>`<tr><td>${esc(c.purpose)}</td><td>${esc(c.prompt_slug)}</td>`+
  `<td>${esc(c.model)}</td><td class=mono>${c.input_tokens}</td><td class=mono>${c.output_tokens}</td>`+
  `<td class=mono>${fmtCost(c.cost_usd)}</td><td>${esc(c.outcome)}</td></tr>`).join('');
 const verdicts=(s.verdicts||[]).map(v=>`<tr><td>${esc(v.specialist)}</td><td>${esc(v.severity)}</td>`+
  `<td>${esc(v.headline)}</td><td class=mono>${esc(v.created_at)}</td></tr>`).join('');
 const coach=(s.coach_transcript||[]).map(m=>`<div><b>${esc(m.role)}</b> `+
  `<span class=mono>${fmtCost(m.cost_usd)}</span><br>${esc(m.content)}</div>`).join('');
 const songLabel=s.song.name?`${esc(s.song.name)} / ${esc(s.song.label)} v${s.song.version_number}`:
  `(anon) ${esc(s.job.file_path)}`;
 const timing=['dispatched','started','completed','failed'].map(k=>{
  const v=s.job[k+'_at'];return v?`${k}: ${esc(v)}`:null}).filter(Boolean).join(' · ');
 const errLine=s.job.error_message?
  `<p class=dead>${esc(s.job.error_message)}</p>`:'';
 const reportJson=(s.analysis&&s.analysis.final_json)||null;
 $('#opsDetail').innerHTML=`
  <h2>Run ${esc(jobId)} <button onclick="closeJob()">close</button></h2>
  <p>${songLabel} — ${esc(s.job.status)}</p>
  ${timing?`<p class=mono>${timing}</p>`:''}
  ${errLine}
  <h3>Token cost</h3>
  <p class=mono>total: ${(t.input_tokens||0)+(t.output_tokens||0)} tokens, ${fmtCost(t.cost_usd)}</p>
  <table><tr><th>purpose</th><th>prompt</th><th>model</th><th>in</th><th>out</th><th>cost</th><th>outcome</th></tr>${calls}</table>
  <h3>Verdicts</h3><table><tr><th>specialist</th><th>severity</th><th>headline</th><th>at</th></tr>${verdicts}</table>
  <h3>Coach transcript</h3>${coach||'<span class=mono>none</span>'}
  <h3>Files</h3>${files}
  <h3>Report JSON</h3>
  <p><a href="/api/ops/${encodeURIComponent(jobId)}/json" download>download raw JSON</a></p>
  <pre class=mono style="max-height:400px;overflow:auto">${esc(JSON.stringify(reportJson,null,2))}</pre>`;
}
function closeJob(){
 $('#opsDetail').innerHTML='';
 history.pushState({},'', location.pathname);
}
window.addEventListener('DOMContentLoaded',()=>{
 const p=new URLSearchParams(location.search).get('job');
 if(p)openJob(p);
});
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
