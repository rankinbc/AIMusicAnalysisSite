"""The dashboard's single inline HTML page (split out of app.py for size)."""

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
 .rl-died,.rl-running_or_died{color:#ef6a6a;font-weight:600}.rl-failed,.rl-timed_out{color:#e8b34c}
 .rl-ok{color:#5dd08c}.rl-skipped{color:#9aa3b2}
</style>
<h1>workerdash — <span id="wstatus" class="unknown">…</span>
 <span id="whb" class="mono"></span>
 <span id="wdog" class="mono"></span>
 <button id="restart" onclick="restartWorker()">restart worker</button></h1>
<div id="wdogBanner" style="display:none;background:#5a1f1f;border:1px solid #a04747;
 border-radius:6px;padding:.5rem .9rem;margin:.5rem 0"></div>
<div class="tabs">
 <button id="tabLive" class="tabbtn active" onclick="showTab('live')">Live</button>
 <button id="tabOps" class="tabbtn" onclick="showTab('ops')">Operations</button>
 <button id="tabRuns" class="tabbtn" onclick="showTab('runs')">Run logs</button>
</div>
<div id="liveView">
<div id="running"></div>
<div id="queues"></div>
<h2>Recent jobs</h2><div id="recent"></div>
</div>
<div id="opsView" style="display:none">
 <div class="opsFilters">
  <input id="opsSearch" placeholder="search song/version/job id…" oninput="opsDebouncedSearch()">
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
<div id="runsView" style="display:none">
 <div class="opsFilters">
  <input id="rlSearch" placeholder="job / analysis / message id…" oninput="rlDebounced()">
  <select id="rlStatus" onchange="rlLoad()">
   <option value="">any status</option>
   <option value="died">died (worker crashed)</option>
   <option value="running_or_died">no footer (running or died)</option>
   <option value="failed">failed</option>
   <option value="timed_out">timed out</option>
   <option value="skipped">skipped</option>
   <option value="ok">ok</option>
  </select>
  <select id="rlDays" onchange="rlLoad()">
   <option value="1">today</option><option value="3" selected>3 days</option>
   <option value="14">14 days</option>
  </select>
 </div>
 <div id="rlDir" class=mono></div>
 <div id="rlTable"></div>
 <pre id="rlText" class=mono style="max-height:600px;overflow:auto;white-space:pre-wrap"></pre>
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
 $('#tabRuns').classList.toggle('active',t==='runs');
 $('#liveView').style.display=t==='live'?'':'none';
 $('#opsView').style.display=t==='ops'?'':'none';
 $('#runsView').style.display=t==='runs'?'':'none';
 if(t==='ops')opsLoad(1);
 if(t==='runs')rlLoad();
}
let rlTimer=null;
function rlDebounced(){clearTimeout(rlTimer);rlTimer=setTimeout(rlLoad,300)}
function rlRows(rows){
 return rows.length?'<table><tr><th>started</th><th>actor</th><th>status</th><th>dur</th>'+
  '<th>pool</th><th>detail</th><th></th></tr>'+rows.map(r=>{
  const when=r.started?new Date(parseFloat(r.started)*1000).toLocaleString():r.day;
  const detail=[r.exc,r.retry,r.reason,r.prior_crashes>0?('prior crashes '+r.prior_crashes):'']
   .filter(Boolean).join(' · ');
  return `<tr><td class=mono>${esc(when)}</td><td>${esc(r.actor)}</td>`+
   `<td class="rl-${esc(r.status)}">${esc(r.status)}</td>`+
   `<td class=mono>${r.duration_s?esc(r.duration_s)+'s':''}</td><td class=mono>${esc(r.pool)}</td>`+
   `<td class=mono title="${esc(r.args.join(' | '))}">${esc(detail)}</td>`+
   `<td><button onclick="rlOpen('${esc(r.day)}','${esc(r.name)}')">view</button></td></tr>`}).join('')+
  '</table>':'<span class=mono>no run logs match</span>';
}
async function rlLoad(){
 const q=new URLSearchParams({days:$('#rlDays').value});
 const search=$('#rlSearch').value.trim(),status=$('#rlStatus').value;
 if(search)q.set('search',search);if(status)q.set('status',status);
 let s;try{s=await (await fetch('/api/runlogs?'+q)).json()}catch(e){
  $('#rlTable').innerHTML='<span class=dead>failed to load</span>';return}
 if(!s.ok){$('#rlTable').innerHTML=`<span class=dead>${esc(s.error||'error')}</span>`;return}
 $('#rlDir').textContent='dir: '+s.dir;
 $('#rlTable').innerHTML=rlRows(s.rows);
}
async function rlOpen(day,name){
 showTab('runs');
 const r=await fetch(`/api/runlogs/${encodeURIComponent(day)}/${encodeURIComponent(name)}`);
 $('#rlText').textContent=r.ok?await r.text():'not found';
 $('#rlText').scrollIntoView();
}
async function jobRunLogs(jobId){
 let s;try{s=await (await fetch('/api/runlogs?days=14&search='+encodeURIComponent(jobId))).json()}
 catch(e){return '<span class=dead>failed to load run logs</span>'}
 return s.ok?rlRows(s.rows):`<span class=dead>${esc(s.error||'error')}</span>`;
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
 $('#opsTable').innerHTML=s.rows.length?'<table><tr><th>job</th><th>song</th><th>status</th>'+
  '<th>error</th><th>dispatched</th><th>tokens</th><th>cost</th><th></th></tr>'+
  s.rows.map(j=>{
   const label=j.song?`${esc(j.song)} / ${esc(j.label)} v${j.version_number}`:
    `(anon) ${esc(j.file_path)}`;
   return `<tr><td class=mono title="${esc(j.id)}">${esc(j.id.slice(0,8))}</td>`+
    `<td>${label}</td><td>${esc(j.status)}</td><td>${esc(j.error_code)}</td>`+
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
  <h3>Worker run logs</h3><div id="opsRunLogs" class=mono>loading…</div>
  <h3>Token cost</h3>
  <p class=mono>total: ${(t.input_tokens||0)+(t.output_tokens||0)} tokens, ${fmtCost(t.cost_usd)}</p>
  <table><tr><th>purpose</th><th>prompt</th><th>model</th><th>in</th><th>out</th><th>cost</th><th>outcome</th></tr>${calls}</table>
  <h3>Verdicts</h3><table><tr><th>specialist</th><th>severity</th><th>headline</th><th>at</th></tr>${verdicts}</table>
  <h3>Coach transcript</h3>${coach||'<span class=mono>none</span>'}
  <h3>Files</h3>${files}
  <h3>Report JSON</h3>
  <p><a href="/api/ops/${encodeURIComponent(jobId)}/json" download>download raw JSON</a></p>
  <pre class=mono style="max-height:400px;overflow:auto">${esc(JSON.stringify(reportJson,null,2))}</pre>`;
 $('#opsRunLogs').innerHTML=await jobRunLogs(jobId);
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
 const wd=w.watchdog;
 $('#wdog').textContent=wd?(wd.halted?'· watchdog: HALTED':'· watchdog: on'):'· watchdog: off';
 const wb=$('#wdogBanner');
 if(wd&&wd.halted){wb.style.display='block';
  wb.textContent='Worker is CRASH-LOOPING — the watchdog stopped restarting it after '+
   wd.restarts_in_window+' restarts in 10 minutes. Check the Run logs tab (died runs) and the newest log in data/logs/.';}
 else wb.style.display='none';
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
