const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const webpush  = require('web-push');
const multer   = require('multer');

const db     = require('./core/database-v2');
const queue  = require('./core/task-queue');
const notify = require('./core/notification');
const logger = require('./core/logger');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static folders
const UPLOADS_DIR     = path.join(__dirname, 'uploads');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
[UPLOADS_DIR, SCREENSHOTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
app.use('/uploads',     express.static(UPLOADS_DIR));
app.use('/screenshots', express.static(SCREENSHOTS_DIR));

// File upload (logo/banner)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, req.params.id || 'general');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + Date.now() + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Seed data
db.seedDefaultData();

// ─── STATS ───────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => res.json({ ...db.getStats(), botStatus: queue.getStatus() }));

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
app.get('/api/clients',              (req, res) => res.json(db.clients.getAll()));
app.get('/api/clients/:id',          (req, res) => res.json(db.clients.getById(req.params.id) || {}));
app.post('/api/clients',             (req, res) => res.json(db.clients.add(req.body)));
app.put('/api/clients/:id',          (req, res) => res.json(db.clients.update(req.params.id, req.body)));
app.delete('/api/clients/:id',       (req, res) => res.json({ success: db.clients.delete(req.params.id) }));
app.post('/api/clients/:id/duplicate', (req, res) => res.json(db.clients.duplicate(req.params.id)));

// Logo/Banner upload
app.post('/api/clients/:id/upload', upload.fields([{ name: 'logo' }, { name: 'banner' }]), (req, res) => {
  const updates = {};
  if (req.files?.logo)   updates.logo   = '/uploads/' + req.params.id + '/' + req.files.logo[0].filename;
  if (req.files?.banner) updates.banner = '/uploads/' + req.params.id + '/' + req.files.banner[0].filename;
  if (Object.keys(updates).length > 0) db.clients.update(req.params.id, updates);
  res.json({ success: true, ...updates });
});

// ─── DIRECTORIES ─────────────────────────────────────────────────────────────
app.get('/api/directories',           (req, res) => res.json(db.directories.getAll()));
app.get('/api/directories/active',    (req, res) => res.json(db.directories.getActive()));
app.post('/api/directories',          (req, res) => res.json(db.directories.add(req.body)));
app.put('/api/directories/:id',       (req, res) => res.json(db.directories.update(req.params.id, req.body)));
app.delete('/api/directories/:id',    (req, res) => res.json({ success: db.directories.delete(req.params.id) }));

// ─── PROFILES ─────────────────────────────────────────────────────────────────
app.get('/api/profiles',              (req, res) => res.json(db.profiles.getAll()));
app.post('/api/profiles',             (req, res) => res.json(db.profiles.add(req.body)));
app.put('/api/profiles/:id',          (req, res) => res.json(db.profiles.update(req.params.id, req.body)));
app.delete('/api/profiles/:id',       (req, res) => res.json({ success: db.profiles.delete(req.params.id) }));

// ─── BLOGS ───────────────────────────────────────────────────────────────────
app.get('/api/blogs',                 (req, res) => res.json(db.blogs.getAll()));
app.post('/api/blogs',                (req, res) => res.json(db.blogs.add(req.body)));
app.put('/api/blogs/:id',             (req, res) => res.json(db.blogs.update(req.params.id, req.body)));
app.delete('/api/blogs/:id',          (req, res) => res.json({ success: db.blogs.delete(req.params.id) }));

// ─── TASKS ───────────────────────────────────────────────────────────────────
app.get('/api/tasks',                       (req, res) => res.json(db.tasks.getAll()));
app.post('/api/tasks',                      (req, res) => res.json(db.tasks.add(req.body)));
app.put('/api/tasks/:id',                   (req, res) => res.json(db.tasks.update(req.params.id, req.body)));
app.delete('/api/tasks/:id',                (req, res) => res.json({ success: db.tasks.delete(req.params.id) }));
app.delete('/api/tasks/completed/all',      (req, res) => res.json({ success: db.tasks.clearCompleted() }));

// ─── SUBMISSIONS ──────────────────────────────────────────────────────────────
app.get('/api/submissions',           (req, res) => res.json(db.submissions.getAll()));
app.get('/api/submissions/today',     (req, res) => res.json(db.submissions.getToday()));
app.post('/api/submissions',          (req, res) => res.json(db.submissions.add(req.body)));
app.put('/api/submissions/:id',       (req, res) => res.json(db.submissions.update(req.params.id, req.body)));

// Screenshot save (base64 from bot)
app.post('/api/screenshot', async (req, res) => {
  try {
    const { clientName, websiteName, base64, submissionId } = req.body;
    const dir  = path.join(SCREENSHOTS_DIR, (clientName||'unknown').replace(/\s/g,'-'), (websiteName||'unknown').replace(/\s/g,'-'));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `screenshot-${Date.now()}.png`);
    const data = base64.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    const relativePath = '/screenshots/' + path.relative(SCREENSHOTS_DIR, file).replace(/\\/g, '/');
    if (submissionId) db.submissions.update(submissionId, { screenshotPath: relativePath });
    res.json({ success: true, path: relativePath });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ─── ALERTS ───────────────────────────────────────────────────────────────────
app.get('/api/alerts',           (req, res) => res.json(db.alerts.getAll()));
app.get('/api/alerts/pending',   (req, res) => res.json(db.alerts.getPending()));
app.post('/api/alerts/create',   async (req, res) => {
  const action = await queue.requireManualAction(req.body);
  res.json({ success: true, action });
});
app.post('/api/alerts/:id/action', (req, res) => {
  const success = queue.resolveAlert(req.params.id, req.body.action);
  res.json({ success });
});

// ─── BOT ──────────────────────────────────────────────────────────────────────
app.get('/api/bot/status',         (req, res) => res.json(queue.getStatus()));
app.get('/api/bot/directories',    (req, res) => res.json(db.directories.getActive()));
app.get('/api/bot/profiles',       (req, res) => res.json(db.profiles.getActive()));
app.get('/api/bot/blogs',          (req, res) => res.json(db.blogs.getActive()));
app.post('/api/bot/status',        (req, res) => { queue.updateStatus(req.body); res.json({ success: true }); });
app.post('/api/bot/start',         (req, res) => {
  const { clientId, botType } = req.body;
  const client = db.clients.getById(clientId);
  if (!client) return res.json({ success: false, error: 'Client not found' });
  const sites = botType === 'directory' ? db.directories.getActive()
              : botType === 'profile'   ? db.profiles.getActive()
              : botType === 'blog'      ? db.blogs.getActive()
              : db.directories.getActive();
  sites.forEach(s => db.tasks.add({ clientId, clientName: client.name, botType, website: s.name, websiteId: s.id, status: 'Pending' }));
  queue.updateStatus({ status: 'running', currentBot: botType, client: client.name });
  queue.broadcast({ type: 'BOT_STARTED', clientId, botType, tasks: sites.length });
  res.json({ success: true, tasks: sites.length });
});
app.post('/api/bot/stop',   (req, res) => { queue.botEvents.emit('bot:stop');   queue.updateStatus({ status: 'stopped', currentBot: null, currentJob: null }); res.json({ success: true }); });
app.post('/api/bot/pause',  (req, res) => { queue.botEvents.emit('bot:pause');  queue.updateStatus({ status: 'paused' }); res.json({ success: true }); });
app.post('/api/bot/resume', (req, res) => { queue.botEvents.emit('bot:resume'); queue.updateStatus({ status: 'running' }); res.json({ success: true }); });

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
app.get('/api/vapid-key',       (req, res) => res.json({ publicKey: notify.VAPID_PUBLIC }));
app.post('/api/subscribe',      (req, res) => res.json({ success: true, count: notify.addSubscription(req.body) }));
app.post('/api/test-siren',     async (req, res) => {
  const action = await queue.requireManualAction({ client: 'Per4mance Guru', website: 'TradeIndia', issue: '🧪 Test — CAPTCHA detected!' });
  res.json({ success: true, action });
});

// ─── LOG ─────────────────────────────────────────────────────────────────────
app.post('/api/log', (req, res) => {
  const { msg, type } = req.body;
  logger[type === 'ok' || type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'info'](msg);
  queue.broadcast({ type: 'LOG', entry: { msg, type, time: db.nowIST() } });
  res.json({ success: true });
});

// ─── SSE ─────────────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', time: db.nowIST() })}\n\n`);
  queue.addSSEClient(res);
  req.on('close', () => queue.removeSSEClient(res));
});

setInterval(() => {
  queue.broadcast({ type: 'HEARTBEAT', status: queue.getStatus(), stats: db.getStats(), time: db.nowIST() });
}, 5000);

// ─── STATIC ───────────────────────────────────────────────────────────────────
app.get('/sw.js',         (req, res) => { res.setHeader('Content-Type', 'application/javascript'); res.send(getSW()); });
app.get('/manifest.json', (req, res) => res.json(getManifest()));
app.get('/icon.svg',      (req, res) => { res.setHeader('Content-Type', 'image/svg+xml'); res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="24" fill="#3b82f6"/><text y="145" x="16" font-size="140" font-family="sans-serif">🤖</text></svg>`); });

function getSW() {
  return `const CACHE='p4g-v3';
const OFFLINE=['/','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(OFFLINE)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
self.addEventListener('push',e=>{let d={};try{d=e.data.json();}catch{d={title:'P4G Alert',body:'Action needed!'}}
e.waitUntil(self.registration.showNotification(d.title||'🚨 Manual Action Required',{body:d.body,tag:d.tag||'alert',data:d,requireInteraction:true,vibrate:[500,200,500,200,1000],actions:[{action:'done',title:'✅ Done'},{action:'skip',title:'⏭️ Skip'},{action:'retry',title:'🔄 Retry'},{action:'stop',title:'🛑 Stop'}]}));});
self.addEventListener('notificationclick',e=>{const a=e.action,d=e.notification.data||{};e.notification.close();
e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{const url='/?page=alerts&alertId='+(d.alertId||d.id||'')+'&action='+(a||'open');for(const c of cs){if(c.url.includes(self.location.origin)){c.focus();c.postMessage({type:'NOTIF_ACTION',action:a,data:d});return;}}return self.clients.openWindow(url);}));});`;
}

function getManifest() {
  return { name:'P4G SEO Platform', short_name:'P4G SEO', description:'Per4mance Guru SEO Automation Platform', start_url:'/', display:'standalone', background_color:'#080c14', theme_color:'#3b82f6', icons:[{src:'/icon.svg',sizes:'192x192',type:'image/svg+xml'},{src:'/icon.svg',sizes:'512x512',type:'image/svg+xml'}], shortcuts:[{name:'Dashboard',url:'/'},{name:'Clients',url:'/?page=clients'},{name:'Alerts',url:'/?page=alerts'},{name:'Bot Engine',url:'/?page=botcontrol'}] };
}

// ══════════════════════════════════════════════════════════════════════════
//  P4G ADD-ON (GEMINI / FREE) — 11 bots in dropdowns + AI client Auto-fill
//  Paste this block IN PLACE OF your existing 4-line  app.get('*', ...)  block.
//  Uses Google Gemini (free tier). Needs env var:  GEMINI_API_KEY
// ══════════════════════════════════════════════════════════════════════════

// ── AI client auto-fill via Google Gemini (free) ──
app.post('/api/clients/enrich', async (req, res) => {
  try {
    let { url } = req.body;
    if (!url) return res.json({ success: false, error: 'No URL provided' });
    if (!process.env.GEMINI_API_KEY) return res.json({ success: false, error: 'GEMINI_API_KEY not set on server' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    let html = '';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; P4GBot/1.0)' } });
      html = await r.text();
    } catch (e) { html = ''; }

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 8000);

    const prompt = 'From this business website, extract the company details as STRICT JSON only (no markdown fences, no preamble). Empty string if not found.\n\nURL: ' + url + '\n\nContent:\n' + text + '\n\nReturn exactly: {"name":"","bizName":"","category":"","email":"","phone":"","mobile":"","address":"","city":"","state":"","zip":"","country":"","primaryKeyword":"","secondaryKeyword":"","targetLocation":"","facebook":"","instagram":"","linkedin":"","youtube":"","twitter":"","shortDesc":"","longDesc":""}';

    const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1024 } }),
    });
    const data = await gr.json();
    if (data.error) return res.json({ success: false, error: data.error.message || 'Gemini request failed' });

    let raw = '';
    try { raw = data.candidates[0].content.parts.map(p => p.text).join(''); } catch { raw = ''; }
    raw = raw.replace(/```json|```/g, '').trim();
    let info = {};
    try { info = JSON.parse(raw); } catch { return res.json({ success: false, error: 'Could not parse AI response' }); }
    info.website = url;
    res.json({ success: true, info });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// ── the enhancement script injected into every page (adds bots + auto-fill) ──
const P4G_ENHANCE = `<script>
(function(){
  try{
    var BOTS=[["directory","📋 Directory Bot"],["article","📝 Article Bot"],["rss","📡 RSS Bot"],["microblog","💬 Microblog Bot"],["web2","🌐 Web 2.0 Bot"],["guestpost","✍️ Guest Post Bot"],["pptpdf","📄 PPT/PDF Bot"],["image","🖼️ Image Bot"],["classified","📢 Classified Bot"],["pressrelease","📰 Press Release Bot"],["profile","👤 Profile Bot"]];
    function optsHTML(sel){var h="";for(var i=0;i<BOTS.length;i++){h+='<option value="'+BOTS[i][0]+'"'+(sel===BOTS[i][0]?" selected":"")+'>'+BOTS[i][1]+"</option>";}return h;}
    function fixDropdowns(){
      var sels=document.querySelectorAll("select");
      for(var i=0;i<sels.length;i++){var s=sels[i];var isBot=false;
        for(var j=0;j<s.options.length;j++){var v=s.options[j].value;if(v==="directory"||v==="profile"||v==="blog"||v==="guest"||v==="social"||v==="citation"||v==="web2"){isBot=true;break;}}
        if(isBot&&!s.getAttribute("data-p4g")){var cur=s.value;s.innerHTML=optsHTML(cur);s.setAttribute("data-p4g","1");}}
    }
    var st=document.createElement("style");
    st.textContent=".bb-article{background:rgba(59,130,246,.15);color:#3b82f6}.bb-rss{background:rgba(249,115,22,.15);color:#f97316}.bb-microblog{background:rgba(236,72,153,.15);color:#ec4899}.bb-pptpdf{background:rgba(6,182,212,.15);color:#06b6d4}.bb-image{background:rgba(168,85,247,.15);color:#a855f7}.bb-classified{background:rgba(234,179,8,.15);color:#eab308}.bb-pressrelease{background:rgba(34,197,94,.15);color:#22c55e}.bb-guestpost{background:rgba(249,115,22,.15);color:#f97316}.bb-web2{background:rgba(168,85,247,.15);color:#a855f7}";
    document.head.appendChild(st);
    function fieldKey(el){var lab="";if(el.labels&&el.labels[0])lab=el.labels[0].innerText;return ((el.name||"")+" "+(el.id||"")+" "+(el.placeholder||"")+" "+lab).toLowerCase();}
    function fillModal(info){var f=document.querySelectorAll("input, textarea");var n=0;
      for(var i=0;i<f.length;i++){var el=f[i];if(!el.offsetParent)continue;var t=(el.type||"").toLowerCase();
        if(["hidden","submit","button","file","checkbox","radio"].indexOf(t)>=0)continue;var h=fieldKey(el);var val="";
        if(/business.?name|company|brand|biz/.test(h))val=info.bizName||info.name;
        else if(/full.?name|contact.?name|owner|^name| name/.test(h))val=info.name||info.bizName;
        else if(/website|url|web/.test(h))val=info.website;
        else if(/e-?mail/.test(h))val=info.email;
        else if(/mobile|whatsapp/.test(h))val=info.mobile||info.phone;
        else if(/phone|tel|number/.test(h))val=info.phone||info.mobile;
        else if(/category|industry|sector|niche|type/.test(h))val=info.category;
        else if(/address|street/.test(h))val=info.address;
        else if(/city|town/.test(h))val=info.city;
        else if(/state|province/.test(h))val=info.state;
        else if(/zip|postal|pin/.test(h))val=info.zip;
        else if(/country/.test(h))val=info.country;
        else if(/primary.?key|keyword|main.?key/.test(h))val=info.primaryKeyword;
        else if(/secondary.?key/.test(h))val=info.secondaryKeyword;
        else if(/location|area|region/.test(h))val=info.targetLocation||info.city;
        else if(/facebook|fb/.test(h))val=info.facebook;
        else if(/instagram|insta|ig/.test(h))val=info.instagram;
        else if(/linkedin/.test(h))val=info.linkedin;
        else if(/youtube|yt/.test(h))val=info.youtube;
        else if(/twitter/.test(h))val=info.twitter;
        else if(/short.?desc|tagline|summary/.test(h))val=info.shortDesc;
        else if(/desc|about|detail|bio/.test(h))val=info.longDesc||info.shortDesc;
        if(val){el.value=val;el.dispatchEvent(new Event("input",{bubbles:true}));n++;}}
      return n;}
    function injectBar(){
      var inputs=document.querySelectorAll("input");var target=null;
      for(var i=0;i<inputs.length;i++){var h=fieldKey(inputs[i]);if(/website|url|web/.test(h)&&inputs[i].offsetParent){target=inputs[i];break;}}
      if(!target)return;
      var host=target.closest("form")||target.closest("[class*=modal],[id*=modal],[class*=Modal]")||target.parentNode;
      if(!host||host.querySelector("#p4g-enrich-bar"))return;
      var bar=document.createElement("div");bar.id="p4g-enrich-bar";
      bar.style.cssText="display:flex;gap:8px;margin:10px 0;align-items:center;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.3);border-radius:8px;padding:10px";
      bar.innerHTML='<input id="p4g-enrich-url" placeholder="Paste client website URL to auto-fill..." style="flex:1;padding:8px 10px;border-radius:6px;border:1px solid rgba(148,163,184,.35);background:transparent;color:inherit"/><button id="p4g-enrich-btn" type="button" style="padding:8px 14px;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer;white-space:nowrap">🔍 Auto-fill</button>';
      host.insertBefore(bar,host.firstChild);
      document.getElementById("p4g-enrich-btn").onclick=async function(){
        var u=(document.getElementById("p4g-enrich-url").value||target.value||"").trim();
        if(!u){alert("Enter a website URL first");return;}
        var b=this;b.disabled=true;b.textContent="⏳ Reading website...";
        try{var res=await fetch("/api/clients/enrich",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u})});var r=await res.json();
          if(r&&r.success){var c=fillModal(r.info||{});b.textContent="✅ Filled "+c+" fields";}
          else{b.textContent="❌ Failed";alert("Auto-fill failed: "+((r&&r.error)||"unknown"));}
        }catch(e){b.textContent="❌ Error";alert("Error: "+e.message);}
        setTimeout(function(){b.disabled=false;b.textContent="🔍 Auto-fill";},2500);};
    }
    setInterval(function(){try{fixDropdowns();injectBar();}catch(e){}},1200);
    fixDropdowns();
  }catch(e){console.log("p4g enhance err",e);}
})();
</script>`;

// ── serve the dashboard with the enhancement appended ──
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let __html = getDashboardHTML();
  try { __html = __html.replace('</body>', P4G_ENHANCE + '</body>'); } catch (e) {}
  res.send(__html);
});



function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<meta name="theme-color" content="#3b82f6"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="P4G SEO"/>
<title>P4G SEO Automation Platform</title>
<link rel="manifest" href="/manifest.json"/>
<link rel="icon" href="/icon.svg"/>
<style>
:root{--bg:#080c14;--s1:#0e1420;--s2:#141c2e;--s3:#1a2540;--border:#1e2d45;--blue:#3b82f6;--indigo:#6366f1;--green:#22c55e;--yellow:#eab308;--red:#ef4444;--orange:#f97316;--pink:#ec4899;--cyan:#06b6d4;--purple:#a855f7;--text:#f1f5f9;--muted:#64748b;}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:13px;min-height:100vh;overflow-x:hidden}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:52px;background:var(--s1);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:200;gap:10px}
.brand{font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px;white-space:nowrap}
.brand-logo{width:30px;height:30px;background:var(--blue);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--muted);flex-shrink:0}
.live-dot.running{background:var(--green);box-shadow:0 0 8px var(--green);animation:blink 1.5s infinite}
.live-dot.paused{background:var(--yellow);animation:blink 1s infinite}
.live-dot.stopped{background:var(--red)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
.layout{display:flex;height:calc(100vh - 52px)}
.sidebar{width:220px;flex-shrink:0;background:var(--s1);border-right:1px solid var(--border);overflow-y:auto}
.sb-sec{padding:8px 0}
.sb-lbl{font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;padding:6px 14px 3px}
.sb-item{display:flex;align-items:center;gap:9px;padding:8px 12px;cursor:pointer;transition:background .1s;border-right:2px solid transparent;user-select:none}
.sb-item:hover{background:var(--s2)}
.sb-item.active{background:rgba(59,130,246,.1);border-right-color:var(--blue)}
.sb-item.active .sb-name{color:var(--blue)}
.sb-icon{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.sb-name{font-size:12px;font-weight:600;white-space:nowrap}
.sb-badge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;flex-shrink:0}
.content{flex:1;overflow-y:auto;padding:18px 20px}
.btn{padding:7px 13px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;transition:all .15s;display:inline-flex;align-items:center;gap:5px;font-family:inherit;white-space:nowrap}
.btn:active{transform:scale(.97)}
.btn-blue{background:var(--blue);color:#fff}
.btn-green{background:#14532d;color:#86efac}
.btn-yellow{background:#713f12;color:#fde68a}
.btn-red{background:#7f1d1d;color:#fca5a5}
.btn-orange{background:#7c2d12;color:#fed7aa}
.btn-ghost{background:var(--s2);color:var(--text);border:1px solid var(--border)}
.btn-ghost:hover{background:var(--s3)}
.btn-sm{padding:5px 10px;font-size:11px;border-radius:5px}
.btn-block{width:100%;justify-content:center;padding:11px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.stat-card{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:14px;position:relative;overflow:hidden}
.stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.stat-blue::before{background:var(--blue)}.stat-green::before{background:var(--green)}.stat-yellow::before{background:var(--yellow)}.stat-red::before{background:var(--red)}.stat-purple::before{background:var(--purple)}.stat-cyan::before{background:var(--cyan)}.stat-orange::before{background:var(--orange)}
.stat-label{font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
.stat-val{font-size:24px;font-weight:800;letter-spacing:-1px;line-height:1}
.card{background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px}
.card-title{font-size:13px;font-weight:700;display:flex;align-items:center;gap:7px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:600px}
thead th{padding:8px 12px;text-align:left;font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border);background:var(--s2);white-space:nowrap}
tbody tr{border-bottom:1px solid var(--border);transition:background .1s}
tbody tr:last-child{border:none}
tbody tr:hover{background:rgba(255,255,255,.02)}
td{padding:9px 12px;font-size:12px;vertical-align:middle}
.td-bold{font-weight:700}
.pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;white-space:nowrap}
.pill-dot{width:4px;height:4px;border-radius:50%}
.p-running{background:rgba(59,130,246,.12);color:var(--blue)}.p-running .pill-dot{background:var(--blue)}
.p-pending{background:rgba(234,179,8,.12);color:var(--yellow)}.p-pending .pill-dot{background:var(--yellow)}
.p-done,.p-completed{background:rgba(34,197,94,.12);color:var(--green)}.p-done .pill-dot,.p-completed .pill-dot{background:var(--green)}
.p-failed{background:rgba(239,68,68,.12);color:var(--red)}.p-failed .pill-dot{background:var(--red)}
.p-paused{background:rgba(249,115,22,.12);color:var(--orange)}.p-paused .pill-dot{background:var(--orange)}
.p-waiting{background:rgba(168,85,247,.12);color:var(--purple)}.p-waiting .pill-dot{background:var(--purple)}
.p-idle{background:rgba(100,116,139,.12);color:var(--muted)}
.toggle{position:relative;width:36px;height:20px;flex-shrink:0;cursor:pointer}
.toggle input{opacity:0;width:0;height:0}
.tslider{position:absolute;inset:0;background:var(--s3);border-radius:10px;transition:.2s}
.tslider:before{content:'';position:absolute;height:14px;width:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.toggle input:checked+.tslider{background:var(--green)}
.toggle input:checked+.tslider:before{transform:translateX(16px)}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-grid.three{grid-template-columns:1fr 1fr 1fr}
.fg{display:flex;flex-direction:column;gap:4px}
.fg.full{grid-column:1/-1}
.fg label{font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.fi,.fs,.fta{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:8px 11px;color:var(--text);font-size:12px;outline:none;width:100%;font-family:inherit;transition:border .15s}
.fi:focus,.fs:focus,.fta:focus{border-color:var(--blue)}
.fi::placeholder,.fta::placeholder{color:var(--muted)}
.fta{resize:vertical;min-height:80px}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;align-items:center;justify-content:center;padding:16px;overflow-y:auto}
.modal-bg.show{display:flex}
.modal{background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:22px;width:100%;max-width:640px;max-height:90vh;overflow-y:auto}
.modal-title{font-size:15px;font-weight:700;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between}
.alert-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;align-items:center;justify-content:center;padding:16px}
.alert-overlay.show{display:flex;animation:pop .25s ease}
@keyframes pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}
.alert-box{background:var(--s1);border:2px solid var(--yellow);border-radius:20px;padding:28px 22px;width:100%;max-width:440px;text-align:center;box-shadow:0 0 80px rgba(234,179,8,.3)}
@keyframes shake{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
.alert-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}
.alert-btns .btn{padding:14px;font-size:13px;border-radius:12px;justify-content:center}
.bot-bar{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.bot-info{flex:1;min-width:200px}
.progress{height:3px;background:var(--s3);border-radius:2px;overflow:hidden;margin-top:8px}
.progress-fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--indigo));border-radius:2px;transition:width .5s}
.notif-banner{background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.notif-banner.hidden{display:none}
@keyframes sirenFlash{0%,100%{background:var(--bg)}33%{background:rgba(239,68,68,.07)}66%{background:rgba(234,179,8,.07)}}
body.siren{animation:sirenFlash .4s infinite}
.page{display:none}.page.active{display:block}
.page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px}
.page-title{font-size:18px;font-weight:800;letter-spacing:-.4px}
.bot-badge{display:inline-block;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700}
.bb-directory{background:rgba(59,130,246,.15);color:var(--blue)}.bb-profile{background:rgba(99,102,241,.15);color:var(--indigo)}.bb-blog{background:rgba(34,197,94,.15);color:var(--green)}.bb-guest{background:rgba(249,115,22,.15);color:var(--orange)}.bb-social{background:rgba(236,72,153,.15);color:var(--pink)}.bb-citation{background:rgba(6,182,212,.15);color:var(--cyan)}.bb-web2{background:rgba(168,85,247,.15);color:var(--purple)}
.da{padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700}
.da-h{background:rgba(34,197,94,.12);color:var(--green)}.da-m{background:rgba(234,179,8,.12);color:var(--yellow)}.da-l{background:rgba(239,68,68,.12);color:var(--red)}
.client-avatar{width:42px;height:42px;border-radius:10px;background:rgba(99,102,241,.15);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0;overflow:hidden}
.client-avatar img{width:100%;height:100%;object-fit:cover}
.upload-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;background:var(--s2);border:1px dashed var(--border);border-radius:7px;cursor:pointer;font-size:11px;color:var(--muted);transition:all .15s}
.upload-btn:hover{border-color:var(--blue);color:var(--blue)}
.ss-thumb{width:60px;height:40px;border-radius:5px;object-fit:cover;border:1px solid var(--border);cursor:pointer}
@media(max-width:768px){.sidebar{display:none}.stats-grid{grid-template-columns:repeat(2,1fr)}.form-grid{grid-template-columns:1fr}.bottom-nav{display:flex!important}.content{padding:12px 14px;padding-bottom:75px}}
.bottom-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--s1);border-top:1px solid var(--border);z-index:100;padding-bottom:env(safe-area-inset-bottom)}
.bnav-btn{flex:1;padding:10px 4px;text-align:center;cursor:pointer;border:none;background:none;color:var(--muted);font-size:9px;font-weight:700;transition:color .15s;font-family:inherit}
.bnav-btn .ni{display:block;font-size:20px;margin-bottom:1px}
.bnav-btn.active,.bnav-btn:hover{color:var(--blue)}
#toastContainer{position:fixed;bottom:80px;right:16px;z-index:9997;display:flex;flex-direction:column;gap:6px}
.toast{background:var(--s1);border-radius:9px;padding:10px 14px;font-size:12px;font-weight:700;max-width:280px;transform:translateX(120%);transition:transform .3s;border-left:3px solid var(--blue)}
.toast.show{transform:translateX(0)}
.toast.t-green{border-color:var(--green);color:var(--green)}.toast.t-red{border-color:var(--red);color:var(--red)}.toast.t-blue{border-color:var(--blue);color:var(--blue)}.toast.t-yellow{border-color:var(--yellow);color:var(--yellow)}
.empty{text-align:center;padding:40px 20px;color:var(--muted)}.empty-icon{font-size:40px;margin-bottom:10px}.empty-title{font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px}
::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
</style>
</head>
<body>

<div class="topbar">
  <div class="brand"><div class="brand-logo">🤖</div>P4G SEO Platform v2</div>
  <div style="display:flex;align-items:center;gap:8px">
    <div class="live-dot" id="topDot"></div>
    <span id="topStatus" style="font-size:11px;color:var(--muted)">Idle</span>
    <span id="alertBadgeTop" style="display:none;background:var(--red);color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px">0</span>
    <button class="btn btn-ghost btn-sm" onclick="openClientModal()">+ Client</button>
    <button class="btn btn-blue btn-sm" onclick="showPage('alerts')">🚨 Alerts</button>
  </div>
</div>

<!-- ALERT OVERLAY -->
<div class="alert-overlay" id="alertOverlay">
  <div class="alert-box">
    <div style="font-size:52px;margin-bottom:12px;animation:shake .4s infinite">🚨</div>
    <div style="font-size:18px;font-weight:800;color:var(--yellow);margin-bottom:16px">Manual Action Required!</div>
    <div style="background:var(--s2);border-radius:10px;padding:14px;text-align:left;margin-bottom:4px">
      <div style="margin-bottom:6px;font-size:12px"><span style="color:var(--muted)">👤 Client:</span> <strong id="aClient">—</strong></div>
      <div style="margin-bottom:6px;font-size:12px"><span style="color:var(--muted)">🌐 Website:</span> <strong id="aWebsite">—</strong></div>
      <div style="font-size:12px"><span style="color:var(--muted)">⚠️ Issue:</span> <strong id="aIssue">—</strong></div>
    </div>
    <div style="font-size:10px;color:var(--muted);margin-bottom:14px" id="aTime">—</div>
    <div class="alert-btns">
      <button class="btn btn-green" onclick="doAction('done')">✅ Done</button>
      <button class="btn btn-yellow" onclick="doAction('skip')">⏭️ Skip</button>
      <button class="btn btn-orange" onclick="doAction('retry')">🔄 Retry</button>
      <button class="btn btn-red" onclick="doAction('stop')">🛑 Stop Bot</button>
    </div>
  </div>
</div>

<!-- CLIENT MODAL -->
<div class="modal-bg" id="clientModal">
  <div class="modal">
    <div class="modal-title"><span id="clientModalTitle">➕ Add Client</span><button class="btn btn-ghost btn-sm" onclick="closeModal('clientModal')">✕</button></div>

    <!-- Logo/Banner Upload -->
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center">
      <div>
        <div style="font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:4px">LOGO</div>
        <div class="client-avatar" id="logoPreview" style="width:60px;height:60px;font-size:20px">🏢</div>
        <label class="upload-btn" style="margin-top:6px;width:60px;justify-content:center">
          📁 <input type="file" id="logoFile" accept="image/*" style="display:none" onchange="previewImg(this,'logoPreview')"/>
        </label>
      </div>
      <div>
        <div style="font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:4px">BANNER</div>
        <div style="width:200px;height:60px;border-radius:8px;background:var(--s2);border:1px solid var(--border);overflow:hidden" id="bannerPreview">
          <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px">No banner</div>
        </div>
        <label class="upload-btn" style="margin-top:6px">
          📁 Upload Banner <input type="file" id="bannerFile" accept="image/*" style="display:none" onchange="previewImg(this,'bannerPreview')"/>
        </label>
      </div>
    </div>

    <div class="form-grid">
      <div class="fg"><label>Client Name *</label><input class="fi" id="cl-name" placeholder="Per4mance Guru"/></div>
      <div class="fg"><label>Business Name *</label><input class="fi" id="cl-bizname" placeholder="PER4MANCE GURU"/></div>
      <div class="fg"><label>Website *</label><input class="fi" id="cl-website" placeholder="https://..."/></div>
      <div class="fg"><label>Blog URL</label><input class="fi" id="cl-blog" placeholder="https://blog..."/></div>
      <div class="fg"><label>Email *</label><input class="fi" id="cl-email" placeholder="email@..."/></div>
      <div class="fg"><label>Phone</label><input class="fi" id="cl-phone" placeholder="+91..."/></div>
      <div class="fg"><label>Mobile</label><input class="fi" id="cl-mobile" placeholder="+91..."/></div>
      <div class="fg"><label>Category</label><input class="fi" id="cl-category" placeholder="Digital Marketing"/></div>
      <div class="fg full"><label>Address</label><input class="fi" id="cl-address" placeholder="Street address"/></div>
      <div class="fg"><label>City</label><input class="fi" id="cl-city" placeholder="Delhi"/></div>
      <div class="fg"><label>State</label><input class="fi" id="cl-state" placeholder="Delhi"/></div>
      <div class="fg"><label>Zip Code</label><input class="fi" id="cl-zip" placeholder="110001"/></div>
      <div class="fg"><label>Country</label><input class="fi" id="cl-country" placeholder="India" value="India"/></div>
      <div class="fg"><label>Primary Keyword</label><input class="fi" id="cl-kw1" placeholder="digital marketing agency"/></div>
      <div class="fg"><label>Secondary Keyword</label><input class="fi" id="cl-kw2" placeholder="seo agency delhi"/></div>
      <div class="fg"><label>Target Location</label><input class="fi" id="cl-location" placeholder="Delhi, India"/></div>
      <div class="fg"><label>Facebook</label><input class="fi" id="cl-fb" placeholder="https://facebook.com/..."/></div>
      <div class="fg"><label>Instagram</label><input class="fi" id="cl-ig" placeholder="https://instagram.com/..."/></div>
      <div class="fg"><label>LinkedIn</label><input class="fi" id="cl-li" placeholder="https://linkedin.com/..."/></div>
      <div class="fg"><label>YouTube</label><input class="fi" id="cl-yt" placeholder="https://youtube.com/..."/></div>
      <div class="fg"><label>Twitter/X</label><input class="fi" id="cl-tw" placeholder="https://twitter.com/..."/></div>
      <div class="fg full"><label>Short Description</label><input class="fi" id="cl-shortdesc" placeholder="One line description"/></div>
      <div class="fg full"><label>Long Description</label><textarea class="fta" id="cl-longdesc" placeholder="Full business description..."></textarea></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModal('clientModal')">Cancel</button>
      <button class="btn btn-blue" onclick="saveClient()">Save Client ✅</button>
    </div>
  </div>
</div>

<!-- DIRECTORY MODAL -->
<div class="modal-bg" id="dirModal">
  <div class="modal" style="max-width:520px">
    <div class="modal-title"><span id="dirModalTitle">➕ Add Directory</span><button class="btn btn-ghost btn-sm" onclick="closeModal('dirModal')">✕</button></div>
    <div class="form-grid">
      <div class="fg"><label>Name *</label><input class="fi" id="dir-name" placeholder="TradeIndia"/></div>
      <div class="fg"><label>Website URL</label><input class="fi" id="dir-url" placeholder="https://..."/></div>
      <div class="fg full"><label>Signup URL *</label><input class="fi" id="dir-signupUrl" placeholder="https://..."/></div>
      <div class="fg full"><label>Login URL</label><input class="fi" id="dir-loginUrl" placeholder="https://..."/></div>
      <div class="fg"><label>Category</label><input class="fi" id="dir-category" placeholder="B2B Directory"/></div>
      <div class="fg"><label>DA</label><input class="fi" id="dir-da" type="number" placeholder="0-100"/></div>
      <div class="fg"><label>Requirements</label>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;text-transform:none;letter-spacing:0;color:var(--text);font-weight:500"><input type="checkbox" id="dir-captcha" style="accent-color:var(--blue)"/> CAPTCHA Required</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;text-transform:none;letter-spacing:0;color:var(--text);font-weight:500"><input type="checkbox" id="dir-emailOTP" style="accent-color:var(--blue)"/> Email OTP Required</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;text-transform:none;letter-spacing:0;color:var(--text);font-weight:500"><input type="checkbox" id="dir-mobileOTP" style="accent-color:var(--blue)"/> Mobile OTP Required</label>
        </div>
      </div>
      <div class="fg"><label>Active</label><label class="toggle" style="margin-top:8px"><input type="checkbox" id="dir-active" checked/><span class="tslider"></span></label></div>
      <div class="fg full"><label>Notes</label><input class="fi" id="dir-notes" placeholder="Any notes..."/></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModal('dirModal')">Cancel</button>
      <button class="btn btn-blue" onclick="saveDirectory()">Save ✅</button>
    </div>
  </div>
</div>

<!-- TASK MODAL -->
<div class="modal-bg" id="taskModal">
  <div class="modal" style="max-width:460px">
    <div class="modal-title">➕ Add Task<button class="btn btn-ghost btn-sm" onclick="closeModal('taskModal')">✕</button></div>
    <div class="form-grid">
      <div class="fg"><label>Client *</label><select class="fs" id="task-client"></select></div>
      <div class="fg"><label>Bot Type *</label>
        <select class="fs" id="task-bottype">
          <option value="directory">📋 Directory Bot</option><option value="profile">👤 Profile Bot</option>
          <option value="blog">✍️ Blog Bot</option><option value="guest">📝 Guest Post Bot</option>
          <option value="social">📱 Social Bot</option><option value="citation">📍 Citation Bot</option><option value="web2">🌐 Web 2.0 Bot</option>
        </select>
      </div>
      <div class="fg full"><label>Website</label><input class="fi" id="task-website" placeholder="e.g. TradeIndia"/></div>
      <div class="fg full"><label>Notes</label><input class="fi" id="task-notes" placeholder="Any notes..."/></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-ghost" onclick="closeModal('taskModal')">Cancel</button>
      <button class="btn btn-blue" onclick="saveTask()">Add Task ✅</button>
    </div>
  </div>
</div>

<!-- SCREENSHOT MODAL -->
<div class="modal-bg" id="ssModal">
  <div class="modal" style="max-width:800px;background:#000">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-weight:700" id="ssModalTitle">Screenshot</div>
      <button class="btn btn-ghost btn-sm" onclick="closeModal('ssModal')">✕</button>
    </div>
    <img id="ssModalImg" src="" style="width:100%;border-radius:8px"/>
  </div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="sb-sec">
      <div class="sb-lbl">Main</div>
      <div class="sb-item active" onclick="showPage('overview')" id="nav-overview"><div class="sb-icon" style="background:rgba(59,130,246,.12)">📊</div><span class="sb-name">Overview</span></div>
      <div class="sb-item" onclick="showPage('clients')" id="nav-clients"><div class="sb-icon" style="background:rgba(99,102,241,.12)">👥</div><span class="sb-name">Clients</span></div>
      <div class="sb-item" onclick="showPage('tasks')" id="nav-tasks"><div class="sb-icon" style="background:rgba(234,179,8,.12)">📋</div><span class="sb-name">Task Queue</span><span class="sb-badge" id="sb-tasks" style="display:none">0</span></div>
      <div class="sb-item" onclick="showPage('tracker')" id="nav-tracker"><div class="sb-icon" style="background:rgba(34,197,94,.12)">📈</div><span class="sb-name">Tracker</span></div>
      <div class="sb-item" onclick="showPage('alerts')" id="nav-alerts"><div class="sb-icon" style="background:rgba(239,68,68,.12)">🚨</div><span class="sb-name">Alerts</span><span class="sb-badge" id="sb-alerts">0</span></div>
    </div>
    <div class="sb-sec">
      <div class="sb-lbl">Databases</div>
      <div class="sb-item" onclick="showPage('directories')" id="nav-directories"><div class="sb-icon" style="background:rgba(6,182,212,.12)">📋</div><span class="sb-name">Directories</span></div>
      <div class="sb-item" onclick="showPage('profiles')" id="nav-profiles"><div class="sb-icon" style="background:rgba(168,85,247,.12)">👤</div><span class="sb-name">Profiles</span></div>
      <div class="sb-item" onclick="showPage('blogs')" id="nav-blogs"><div class="sb-icon" style="background:rgba(249,115,22,.12)">✍️</div><span class="sb-name">Blogs</span></div>
    </div>
    <div class="sb-sec">
      <div class="sb-lbl">Bot Control</div>
      <div class="sb-item" onclick="showPage('botcontrol')" id="nav-botcontrol"><div class="sb-icon" style="background:rgba(34,197,94,.12)">🤖</div><span class="sb-name">Bot Engine</span></div>
      <div class="sb-item" onclick="showPage('screenshots')" id="nav-screenshots"><div class="sb-icon" style="background:rgba(236,72,153,.12)">📸</div><span class="sb-name">Screenshots</span></div>
      <div class="sb-item" onclick="showPage('logs')" id="nav-logs"><div class="sb-icon" style="background:rgba(100,116,139,.12)">📜</div><span class="sb-name">Live Logs</span></div>
      <div class="sb-item" onclick="showPage('settings')" id="nav-settings"><div class="sb-icon" style="background:rgba(59,130,246,.12)">⚙️</div><span class="sb-name">Settings</span></div>
    </div>
  </div>

  <div class="content">
    <div id="toastContainer"></div>

    <div class="notif-banner" id="notifBanner">
      <div><div style="font-weight:700;font-size:13px">🔔 Enable Push Notifications</div><div style="font-size:11px;color:var(--muted);margin-top:2px">Zepto-style siren on phone when bot needs help</div></div>
      <button class="btn btn-blue btn-sm" onclick="enableNotif()">Enable Now</button>
    </div>

    <!-- OVERVIEW -->
    <div class="page active" id="page-overview">
      <div class="page-header"><div class="page-title">📊 Overview</div><button class="btn btn-ghost btn-sm" onclick="loadAll()">🔄 Refresh</button></div>
      <div class="stats-grid">
        <div class="stat-card stat-blue"><div class="stat-label">Total Clients</div><div class="stat-val" id="st-clients">0</div></div>
        <div class="stat-card stat-green"><div class="stat-label">Active Clients</div><div class="stat-val" id="st-active">0</div></div>
        <div class="stat-card stat-purple"><div class="stat-label">Total Bots</div><div class="stat-val" id="st-totalbots">7</div></div>
        <div class="stat-card stat-blue"><div class="stat-label">Running Bots</div><div class="stat-val" id="st-runningbots">0</div></div>
        <div class="stat-card stat-yellow"><div class="stat-label">Pending Tasks</div><div class="stat-val" id="st-pending">0</div></div>
        <div class="stat-card stat-green"><div class="stat-label">Completed</div><div class="stat-val" id="st-completed">0</div></div>
        <div class="stat-card stat-red"><div class="stat-label">Failed</div><div class="stat-val" id="st-failed">0</div></div>
        <div class="stat-card stat-cyan"><div class="stat-label">Today Backlinks</div><div class="stat-val" id="st-backlinks">0</div></div>
        <div class="stat-card stat-indigo" style="--indigo:#6366f1" ><div class="stat-label">Today Profiles</div><div class="stat-val" id="st-profiles">0</div></div>
        <div class="stat-card stat-orange"><div class="stat-label">Today Blogs</div><div class="stat-val" id="st-blogs">0</div></div>
        <div class="stat-card stat-green"><div class="stat-label">Today Dir Subs</div><div class="stat-val" id="st-dirs">0</div></div>
        <div class="stat-card stat-red"><div class="stat-label">Pending Alerts</div><div class="stat-val" id="st-palerts" style="color:var(--red)">0</div></div>
      </div>
      <div class="bot-bar">
        <div class="bot-info">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><div class="live-dot" id="botDot"></div><span id="botStatusText" style="font-weight:700;font-size:13px">Idle</span></div>
          <div id="botJobText" style="font-size:11px;color:var(--muted)">No active job</div>
          <div class="progress"><div class="progress-fill" id="progressBar" style="width:0%"></div></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <select class="fi btn-sm" id="quickClient" style="width:auto"><option value="">Select client...</option></select>
          <select class="fi btn-sm" id="quickBot" style="width:auto">
            <option value="directory">📋 Directory</option><option value="profile">👤 Profile</option>
            <option value="blog">✍️ Blog</option><option value="guest">📝 Guest Post</option>
          </select>
          <button class="btn btn-green btn-sm" onclick="startBot()">▶️ Start</button>
          <button class="btn btn-yellow btn-sm" onclick="pauseBot()">⏸️</button>
          <button class="btn btn-red btn-sm" onclick="stopBot()">🛑</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">⚠️ Pending Alerts</div><button class="btn btn-ghost btn-sm" onclick="testSiren()">🧪 Test Siren</button></div>
        <div id="overviewAlerts"><div class="empty"><div class="empty-icon">✅</div><div class="empty-title">All clear!</div></div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">📈 Today's Submissions</div><button class="btn btn-ghost btn-sm" onclick="showPage('tracker')">View All →</button></div>
        <div id="recentSubs"><div class="empty"><div class="empty-icon">📊</div><div class="empty-title">No submissions today</div></div></div>
      </div>
    </div>

    <!-- CLIENTS -->
    <div class="page" id="page-clients">
      <div class="page-header"><div class="page-title">👥 Clients</div><button class="btn btn-blue btn-sm" onclick="openClientModal()">+ Add Client</button></div>
      <div id="clientsList"></div>
    </div>

    <!-- TASKS -->
    <div class="page" id="page-tasks">
      <div class="page-header">
        <div class="page-title">📋 Task Queue</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="clearCompletedTasks()">🗑️ Clear Done</button>
          <button class="btn btn-blue btn-sm" onclick="populateTaskModal();openModal('taskModal')">+ Add Task</button>
        </div>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:14px;overflow-x:auto;padding-bottom:2px">
        <button class="btn btn-blue btn-sm" onclick="filterTasks('all',this)">All</button>
        <button class="btn btn-ghost btn-sm" onclick="filterTasks('Pending',this)">⏳ Pending</button>
        <button class="btn btn-ghost btn-sm" onclick="filterTasks('Running',this)">▶️ Running</button>
        <button class="btn btn-ghost btn-sm" onclick="filterTasks('Completed',this)">✅ Done</button>
        <button class="btn btn-ghost btn-sm" onclick="filterTasks('Failed',this)">❌ Failed</button>
        <button class="btn btn-ghost btn-sm" onclick="filterTasks('Waiting Manual Action',this)">⚠️ Waiting</button>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap"><table>
          <thead><tr><th>Client</th><th>Bot</th><th>Website</th><th>Status</th><th>Created</th><th>Notes</th><th></th></tr></thead>
          <tbody id="taskTableBody"></tbody>
        </table></div>
      </div>
    </div>

    <!-- TRACKER -->
    <div class="page" id="page-tracker">
      <div class="page-header"><div class="page-title">📈 Submission Tracker</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="filterTracker('all',this)">All</button>
          <button class="btn btn-ghost btn-sm" onclick="filterTracker('directory',this)">Directory</button>
          <button class="btn btn-ghost btn-sm" onclick="filterTracker('profile',this)">Profile</button>
          <button class="btn btn-ghost btn-sm" onclick="filterTracker('blog',this)">Blog</button>
          <button class="btn btn-ghost btn-sm" onclick="exportTracker()">📤 CSV</button>
        </div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Client</th><th>Website</th><th>Bot</th><th>Status</th><th>Profile URL</th><th>Sub URL</th><th>Screenshot</th><th>Notes</th></tr></thead>
          <tbody id="trackerTableBody"></tbody>
        </table></div>
      </div>
    </div>

    <!-- ALERTS -->
    <div class="page" id="page-alerts">
      <div class="page-header"><div class="page-title">🚨 Alert Center</div></div>
      <div id="alertsList"></div>
    </div>

    <!-- DIRECTORIES -->
    <div class="page" id="page-directories">
      <div class="page-header">
        <div class="page-title">📋 Directory Database</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="toggleAllDirs(true)">✅ All On</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleAllDirs(false)">❌ All Off</button>
          <button class="btn btn-blue btn-sm" onclick="resetDirForm();openModal('dirModal')">+ Add</button>
        </div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap"><table>
          <thead><tr><th>Bot</th><th>Name</th><th>DA</th><th>Category</th><th>CAPTCHA</th><th>Email OTP</th><th>Mobile OTP</th><th>Last Run</th><th>Status</th><th></th></tr></thead>
          <tbody id="dirTableBody"></tbody>
        </table></div>
      </div>
    </div>

    <!-- PROFILES -->
    <div class="page" id="page-profiles">
      <div class="page-header"><div class="page-title">👤 Profile Websites (13)</div><button class="btn btn-blue btn-sm" onclick="addProfilePrompt()">+ Add</button></div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap"><table>
          <thead><tr><th>Active</th><th>Name</th><th>DA</th><th>Requirements</th><th>Profile URL</th><th>Status</th><th>Signup</th><th></th></tr></thead>
          <tbody id="profileTableBody"></tbody>
        </table></div>
      </div>
    </div>

    <!-- BLOGS -->
    <div class="page" id="page-blogs">
      <div class="page-header"><div class="page-title">✍️ Blog Websites (7)</div><button class="btn btn-blue btn-sm" onclick="addBlogPrompt()">+ Add</button></div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="table-wrap"><table>
          <thead><tr><th>Active</th><th>Name</th><th>DA</th><th>PA</th><th>Spam Score</th><th>Category</th><th>Signup</th><th>Submit</th><th></th></tr></thead>
          <tbody id="blogTableBody"></tbody>
        </table></div>
      </div>
    </div>

    <!-- BOT ENGINE -->
    <div class="page" id="page-botcontrol">
      <div class="page-header"><div class="page-title">🤖 Bot Engine</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="card">
          <div class="card-header"><div class="card-title">⚡ Launch Bot</div></div>
          <div class="fg" style="margin-bottom:10px"><label>Client</label><select class="fs" id="bc-client"><option value="">Select client...</option></select></div>
          <div class="fg" style="margin-bottom:14px"><label>Bot Type</label>
            <select class="fs" id="bc-bot">
              <option value="directory">📋 Directory Bot</option><option value="profile">👤 Profile Bot</option>
              <option value="blog">✍️ Blog Bot</option><option value="guest">📝 Guest Post Bot</option>
              <option value="social">📱 Social Bot</option><option value="citation">📍 Citation Bot</option><option value="web2">🌐 Web 2.0 Bot</option>
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button class="btn btn-green btn-block" onclick="startBotFull()">▶️ Start</button>
            <button class="btn btn-yellow btn-block" onclick="pauseBot()">⏸️ Pause</button>
            <button class="btn btn-orange btn-block" onclick="resumeBot()">▶ Resume</button>
            <button class="btn btn-red btn-block" onclick="stopBot()">🛑 Stop</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">📊 Live Status</div></div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div class="live-dot" id="botDot2"></div><div id="botStatusText2" style="font-weight:700">Idle</div></div>
          <div id="botJobText2" style="font-size:11px;color:var(--muted);margin-bottom:10px">No active job</div>
          <div class="progress"><div class="progress-fill" id="progressBar2" style="width:0%"></div></div>
          <div style="margin-top:14px;font-size:11px;color:var(--muted)">
            <div>Pending: <strong id="bc-pending" style="color:var(--yellow)">0</strong></div>
            <div>Running: <strong id="bc-running" style="color:var(--blue)">0</strong></div>
            <div>Completed: <strong id="bc-completed" style="color:var(--green)">0</strong></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">🔗 Bot API Endpoints</div></div>
        <div style="font-family:monospace;font-size:11px;color:var(--cyan);line-height:2.2;background:var(--bg);padding:12px;border-radius:7px">
          GET  /api/bot/directories  ← enabled dirs<br/>
          GET  /api/bot/profiles     ← enabled profiles<br/>
          GET  /api/bot/blogs        ← enabled blogs<br/>
          POST /api/bot/status       ← update status<br/>
          POST /api/alerts/create    ← manual action<br/>
          POST /api/screenshot       ← save screenshot<br/>
          POST /api/submissions      ← log submission<br/>
          POST /api/log              ← send log
        </div>
      </div>
    </div>

    <!-- SCREENSHOTS -->
    <div class="page" id="page-screenshots">
      <div class="page-header"><div class="page-title">📸 Screenshot Gallery</div></div>
      <div id="screenshotsList">
        <div class="empty"><div class="empty-icon">📸</div><div class="empty-title">No screenshots yet</div><div>Bot will save screenshots automatically</div></div>
      </div>
    </div>

    <!-- LOGS -->
    <div class="page" id="page-logs">
      <div class="page-header"><div class="page-title">📜 Live Logs</div><button class="btn btn-ghost btn-sm" onclick="liveLogs=[];renderLogs()">🗑️ Clear</button></div>
      <div class="card" style="padding:0"><div id="logList" style="font-family:monospace;font-size:11px;max-height:calc(100vh - 180px);overflow-y:auto;padding:4px 0"></div></div>
    </div>

    <!-- SETTINGS -->
    <div class="page" id="page-settings">
      <div class="page-header"><div class="page-title">⚙️ Settings</div></div>
      <div class="card">
        <div class="card-header"><div class="card-title">🔔 Push Notifications</div></div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="background:var(--bg);border-radius:7px;padding:12px"><div style="font-size:10px;color:var(--muted);margin-bottom:3px">Status</div><div id="notifStatusSetting" style="font-weight:700">Checking...</div></div>
          <button class="btn btn-blue btn-block" onclick="enableNotif()">🔔 Enable Siren Notifications</button>
          <button class="btn btn-ghost btn-block" onclick="testSiren()">🧪 Test Siren Now</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">📡 Platform Info</div></div>
        <div style="font-size:12px;color:var(--muted);line-height:2.2">
          <div>Version: <strong style="color:var(--text)">2.0.0</strong></div>
          <div>Server: <strong style="color:var(--text)">http://localhost:${PORT}</strong></div>
          <div>Agency: <strong style="color:var(--text)">Per4mance Guru</strong></div>
          <div>Screenshots: <strong style="color:var(--text)">/screenshots/{client}/{site}/</strong></div>
          <div>Logs: <strong style="color:var(--text)">/logs/success.log, failed.log, manual-actions.log</strong></div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="bottom-nav">
  <button class="bnav-btn active" id="bnav-overview" onclick="showPage('overview')"><span class="ni">📊</span>Home</button>
  <button class="bnav-btn" id="bnav-clients" onclick="showPage('clients')"><span class="ni">👥</span>Clients</button>
  <button class="bnav-btn" id="bnav-tasks" onclick="showPage('tasks')"><span class="ni">📋</span>Tasks</button>
  <button class="bnav-btn" id="bnav-alerts" onclick="showPage('alerts')"><span class="ni">🚨</span>Alerts</button>
  <button class="bnav-btn" id="bnav-botcontrol" onclick="showPage('botcontrol')"><span class="ni">🤖</span>Bot</button>
</div>

<script>
let currentAlertId=null,editingClientId=null,editingDirId=null,sirenPlaying=false,sirenCtx=null,sirenStop=false,sw=null,liveLogs=[],taskFilter='all',trackerFilter='all';

function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name)?.classList.add('active');
  document.querySelectorAll('.sb-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('nav-'+name)?.classList.add('active');
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('bnav-'+name)?.classList.add('active');
  const loaders={clients:loadClientsPage,tasks:loadTasksPage,tracker:loadTrackerPage,alerts:loadAlertsPage,directories:loadDirsPage,profiles:loadProfilesPage,blogs:loadBlogsPage,botcontrol:populateBotSelects,logs:renderLogs,screenshots:loadScreenshots};
  loaders[name]?.();
}

function openModal(id){document.getElementById(id).classList.add('show');}
function closeModal(id){document.getElementById(id).classList.remove('show');}
document.querySelectorAll('.modal-bg').forEach(el=>el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('show');}));

function openClientModal(id=null){
  editingClientId=id;
  resetClientForm();
  document.getElementById('clientModalTitle').textContent=id?'✏️ Edit Client':'➕ Add Client';
  if(id){
    api('/api/clients/'+id).then(c=>{
      if(!c)return;
      const m={'cl-name':c.name,'cl-bizname':c.bizName,'cl-website':c.website,'cl-blog':c.blog,'cl-email':c.email,'cl-phone':c.phone,'cl-mobile':c.mobile,'cl-category':c.category,'cl-address':c.address,'cl-city':c.city,'cl-state':c.state,'cl-zip':c.zip,'cl-country':c.country,'cl-kw1':c.primaryKeyword,'cl-kw2':c.secondaryKeyword,'cl-location':c.targetLocation,'cl-fb':c.facebook,'cl-ig':c.instagram,'cl-li':c.linkedin,'cl-yt':c.youtube,'cl-tw':c.twitter,'cl-shortdesc':c.shortDesc,'cl-longdesc':c.longDesc};
      Object.entries(m).forEach(([k,v])=>{const el=document.getElementById(k);if(el)el.value=v||'';});
      if(c.logo){const lp=document.getElementById('logoPreview');lp.innerHTML='';const img=document.createElement('img');img.src=c.logo;lp.appendChild(img);}
    });
  }
  openModal('clientModal');
}

function resetClientForm(){
  ['cl-name','cl-bizname','cl-website','cl-blog','cl-email','cl-phone','cl-mobile','cl-category','cl-address','cl-city','cl-state','cl-zip','cl-kw1','cl-kw2','cl-location','cl-fb','cl-ig','cl-li','cl-yt','cl-tw','cl-shortdesc','cl-longdesc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('cl-country').value='India';
  document.getElementById('logoPreview').innerHTML='🏢';
  document.getElementById('bannerPreview').innerHTML='<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px">No banner</div>';
}

function previewImg(input,previewId){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    const el=document.getElementById(previewId);
    el.innerHTML='';
    const img=document.createElement('img');
    img.src=e.target.result;
    img.style.cssText='width:100%;height:100%;object-fit:cover';
    el.appendChild(img);
  };
  reader.readAsDataURL(file);
}

async function saveClient(){
  const name=document.getElementById('cl-name').value.trim();
  if(!name){toast('Client name required!','red');return;}
  const data={name,bizName:document.getElementById('cl-bizname').value.trim(),website:document.getElementById('cl-website').value.trim(),blog:document.getElementById('cl-blog').value.trim(),email:document.getElementById('cl-email').value.trim(),phone:document.getElementById('cl-phone').value.trim(),mobile:document.getElementById('cl-mobile').value.trim(),category:document.getElementById('cl-category').value.trim(),address:document.getElementById('cl-address').value.trim(),city:document.getElementById('cl-city').value.trim(),state:document.getElementById('cl-state').value.trim(),zip:document.getElementById('cl-zip').value.trim(),country:document.getElementById('cl-country').value.trim(),primaryKeyword:document.getElementById('cl-kw1').value.trim(),secondaryKeyword:document.getElementById('cl-kw2').value.trim(),targetLocation:document.getElementById('cl-location').value.trim(),facebook:document.getElementById('cl-fb').value.trim(),instagram:document.getElementById('cl-ig').value.trim(),linkedin:document.getElementById('cl-li').value.trim(),youtube:document.getElementById('cl-yt').value.trim(),twitter:document.getElementById('cl-tw').value.trim(),shortDesc:document.getElementById('cl-shortdesc').value.trim(),longDesc:document.getElementById('cl-longdesc').value.trim()};
  let client;
  if(editingClientId){client=await api('/api/clients/'+editingClientId,'PUT',data);toast('Client updated!','green');}
  else{client=await api('/api/clients','POST',data);toast('"'+name+'" added!','green');}
  // Upload logo/banner if selected
  if(client?.id){
    const logoFile=document.getElementById('logoFile').files[0];
    const bannerFile=document.getElementById('bannerFile').files[0];
    if(logoFile||bannerFile){
      const fd=new FormData();
      if(logoFile)fd.append('logo',logoFile);
      if(bannerFile)fd.append('banner',bannerFile);
      await fetch('/api/clients/'+(client.id||editingClientId)+'/upload',{method:'POST',body:fd});
    }
  }
  closeModal('clientModal');
  loadClientsPage();loadStats();
}

async function loadClientsPage(){
  const clients=await api('/api/clients');
  const el=document.getElementById('clientsList');
  if(!el)return;
  if(!clients||clients.length===0){el.innerHTML='<div class="empty"><div class="empty-icon">👥</div><div class="empty-title">No clients yet</div><div>Click "+ Add Client" to get started</div></div>';return;}
  el.innerHTML=clients.map(c=>\`
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="client-avatar">\${c.logo?\`<img src="\${c.logo}"/>\`:c.name?.slice(0,2).toUpperCase()||'??'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px">\${c.name}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">\${c.bizName||''} · \${c.category||'—'} · \${c.website?'<a href="'+c.website+'" target="_blank" style="color:var(--blue)">Website ↗</a>':'No website'}</div>
          <div style="font-size:11px;color:var(--muted)">\${c.email||''}\${c.city?' · '+c.city:''}\${c.country?' · '+c.country:''}</div>
          \${c.shortDesc?\`<div style="font-size:11px;color:var(--muted);margin-top:2px">\${c.shortDesc}</div>\`:''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" onclick="openClientModal('\${c.id}')">✏️</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateClient('\${c.id}')">📋</button>
          <button class="btn btn-red btn-sm" onclick="deleteClient('\${c.id}')">🗑️</button>
        </div>
      </div>
    </div>
  \`).join('');
  populateClientSelects(clients);
}

async function deleteClient(id){if(!confirm('Delete?'))return;await fetch('/api/clients/'+id,{method:'DELETE'});loadClientsPage();loadStats();toast('Deleted.','red');}
async function duplicateClient(id){await api('/api/clients/'+id+'/duplicate','POST');loadClientsPage();toast('Duplicated!','green');}
function populateClientSelects(clients){
  if(!clients)return;
  ['quickClient','bc-client','task-client'].forEach(id=>{const el=document.getElementById(id);if(!el)return;el.innerHTML='<option value="">Select client...</option>'+clients.map(c=>\`<option value="\${c.id}">\${c.name}</option>\`).join('');});
}

async function loadDirsPage(){
  const dirs=await api('/api/directories');
  const tbody=document.getElementById('dirTableBody');if(!tbody)return;
  if(!dirs||dirs.length===0){tbody.innerHTML='<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px">No directories</td></tr>';return;}
  tbody.innerHTML=dirs.map(d=>\`
    <tr>
      <td><label class="toggle"><input type="checkbox" \${d.active?'checked':''} onchange="toggleDir('\${d.id}',this.checked)"/><span class="tslider"></span></label></td>
      <td class="td-bold">\${d.name}</td>
      <td><span class="da \${d.da>=50?'da-h':d.da>=30?'da-m':'da-l'}">DA \${d.da||'?'}</span></td>
      <td style="color:var(--muted)">\${d.category||'—'}</td>
      <td>\${d.requiresCaptcha?'<span style="color:var(--red)">⚠️ Yes</span>':'<span style="color:var(--muted)">No</span>'}</td>
      <td>\${d.requiresEmailOTP?'<span style="color:var(--yellow)">📧 Yes</span>':'<span style="color:var(--muted)">No</span>'}</td>
      <td>\${d.requiresMobileOTP?'<span style="color:var(--orange)">📱 Yes</span>':'<span style="color:var(--muted)">No</span>'}</td>
      <td style="color:var(--muted);font-size:11px">\${d.lastRun||'Never'}</td>
      <td><span class="pill \${d.active?'p-running':'p-idle'}">\${d.active?'Active':'Disabled'}</span></td>
      <td><div style="display:flex;gap:4px"><button class="btn btn-ghost btn-sm" onclick="editDir('\${d.id}')">✏️</button><button class="btn btn-red btn-sm" onclick="deleteDir('\${d.id}')">🗑️</button></div></td>
    </tr>
  \`).join('');
}

function resetDirForm(){editingDirId=null;['dir-name','dir-url','dir-signupUrl','dir-loginUrl','dir-category','dir-notes'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});['dir-da'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});['dir-captcha','dir-emailOTP','dir-mobileOTP'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});document.getElementById('dir-active').checked=true;document.getElementById('dirModalTitle').textContent='➕ Add Directory';}
async function editDir(id){
  const dirs=await api('/api/directories');const d=dirs.find(x=>x.id===id);if(!d)return;
  editingDirId=id;
  document.getElementById('dir-name').value=d.name||'';document.getElementById('dir-url').value=d.url||'';document.getElementById('dir-signupUrl').value=d.signupUrl||'';document.getElementById('dir-loginUrl').value=d.loginUrl||'';document.getElementById('dir-category').value=d.category||'';document.getElementById('dir-da').value=d.da||'';document.getElementById('dir-notes').value=d.notes||'';document.getElementById('dir-captcha').checked=!!d.requiresCaptcha;document.getElementById('dir-emailOTP').checked=!!d.requiresEmailOTP;document.getElementById('dir-mobileOTP').checked=!!d.requiresMobileOTP;document.getElementById('dir-active').checked=d.active!==false;
  document.getElementById('dirModalTitle').textContent='✏️ Edit Directory';
  openModal('dirModal');
}
async function saveDirectory(){
  const name=document.getElementById('dir-name').value.trim();if(!name){toast('Name required!','red');return;}
  const data={name,url:document.getElementById('dir-url').value.trim(),signupUrl:document.getElementById('dir-signupUrl').value.trim(),loginUrl:document.getElementById('dir-loginUrl').value.trim(),category:document.getElementById('dir-category').value.trim()||'Business Directory',da:parseInt(document.getElementById('dir-da').value)||0,notes:document.getElementById('dir-notes').value.trim(),requiresCaptcha:document.getElementById('dir-captcha').checked,requiresEmailOTP:document.getElementById('dir-emailOTP').checked,requiresMobileOTP:document.getElementById('dir-mobileOTP').checked,active:document.getElementById('dir-active').checked};
  if(editingDirId){await fetch('/api/directories/'+editingDirId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});toast('Updated!','green');}
  else{await api('/api/directories','POST',data);toast('"'+name+'" added!','green');}
  closeModal('dirModal');editingDirId=null;loadDirsPage();
}
async function deleteDir(id){if(!confirm('Delete?'))return;await fetch('/api/directories/'+id,{method:'DELETE'});loadDirsPage();toast('Deleted.','red');}
async function toggleDir(id,active){await fetch('/api/directories/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});toast(active?'Enabled ✅':'Disabled ❌',active?'green':'red');}
async function toggleAllDirs(active){const dirs=await api('/api/directories');for(const d of dirs)await fetch('/api/directories/'+d.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});loadDirsPage();toast(active?'All enabled!':'All disabled!',active?'green':'red');}

async function loadProfilesPage(){
  const profiles=await api('/api/profiles');
  const tbody=document.getElementById('profileTableBody');if(!tbody)return;
  tbody.innerHTML=(profiles||[]).map(p=>\`
    <tr>
      <td><label class="toggle"><input type="checkbox" \${p.active?'checked':''} onchange="toggleProfile('\${p.id}',this.checked)"/><span class="tslider"></span></label></td>
      <td class="td-bold">\${p.name}</td>
      <td><span class="da \${p.da>=50?'da-h':'da-m'}">DA \${p.da||'?'}</span></td>
      <td style="color:var(--muted);font-size:11px">\${p.requirements||'—'}</td>
      <td>\${p.profileUrl?\`<a href="\${p.profileUrl}" target="_blank" style="color:var(--blue);font-size:11px">View ↗</a>\`:'<span style="color:var(--muted)">—</span>'}</td>
      <td><span class="pill \${p.status==='Done'?'p-done':'p-pending'}">\${p.status||'Pending'}</span></td>
      <td><a href="\${p.signupUrl}" target="_blank" style="color:var(--blue);font-size:11px">Sign up ↗</a></td>
      <td><button class="btn btn-red btn-sm" onclick="deleteProfile('\${p.id}')">🗑️</button></td>
    </tr>
  \`).join('');
}
async function toggleProfile(id,active){await fetch('/api/profiles/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});}
async function deleteProfile(id){await fetch('/api/profiles/'+id,{method:'DELETE'});loadProfilesPage();}
function addProfilePrompt(){const name=prompt('Profile website name:');if(!name)return;const url=prompt('Signup URL:');if(!url)return;const da=parseInt(prompt('DA:')||'0');const req=prompt('Requirements (e.g. Email, Google login):')||'Email';api('/api/profiles','POST',{name,signupUrl:url,da,requirements:req,active:true}).then(()=>{loadProfilesPage();toast('"'+name+'" added!','green');});}

async function loadBlogsPage(){
  const blogs=await api('/api/blogs');
  const tbody=document.getElementById('blogTableBody');if(!tbody)return;
  tbody.innerHTML=(blogs||[]).map(b=>\`
    <tr>
      <td><label class="toggle"><input type="checkbox" \${b.active?'checked':''} onchange="toggleBlog('\${b.id}',this.checked)"/><span class="tslider"></span></label></td>
      <td class="td-bold">\${b.name}</td>
      <td><span class="da \${b.da>=50?'da-h':'da-m'}">DA \${b.da||'?'}</span></td>
      <td><span class="da da-m">PA \${b.pa||'?'}</span></td>
      <td><span style="font-size:11px;color:\${b.spamScore>5?'var(--red)':b.spamScore>2?'var(--yellow)':'var(--green)'}">\${b.spamScore||0}%</span></td>
      <td style="color:var(--muted);font-size:11px">\${b.category||'General'}</td>
      <td><a href="\${b.signupUrl}" target="_blank" style="color:var(--blue);font-size:11px">Sign up ↗</a></td>
      <td>\${b.submissionUrl?\`<a href="\${b.submissionUrl}" target="_blank" style="color:var(--blue);font-size:11px">Submit ↗</a>\`:'—'}</td>
      <td><button class="btn btn-red btn-sm" onclick="deleteBlog('\${b.id}')">🗑️</button></td>
    </tr>
  \`).join('');
}
async function toggleBlog(id,active){await fetch('/api/blogs/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({active})});}
async function deleteBlog(id){await fetch('/api/blogs/'+id,{method:'DELETE'});loadBlogsPage();}
function addBlogPrompt(){const name=prompt('Blog website name:');if(!name)return;const url=prompt('Signup URL:');if(!url)return;const subUrl=prompt('Submission URL:')||'';const da=parseInt(prompt('DA:')||'0');const pa=parseInt(prompt('PA:')||'0');const spam=parseInt(prompt('Spam Score (0-100):')||'0');api('/api/blogs','POST',{name,signupUrl:url,submissionUrl:subUrl,da,pa,spamScore:spam,active:true}).then(()=>{loadBlogsPage();toast('"'+name+'" added!','green');});}

async function loadTasksPage(){
  const tasks=await api('/api/tasks');
  const tbody=document.getElementById('taskTableBody');if(!tbody)return;
  let filtered=tasks||[];
  if(taskFilter!=='all')filtered=filtered.filter(t=>t.status===taskFilter);
  if(filtered.length===0){tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No tasks</td></tr>';return;}
  tbody.innerHTML=filtered.map(t=>\`
    <tr>
      <td class="td-bold">\${t.clientName||'—'}</td>
      <td><span class="bot-badge bb-\${t.botType||'directory'}">\${t.botType||'dir'}</span></td>
      <td>\${t.website||'—'}</td>
      <td>\${statusPill(t.status)}</td>
      <td style="color:var(--muted);font-size:11px">\${(t.createdAt||'').split(',')[0]||'—'}</td>
      <td style="color:var(--muted);font-size:11px">\${t.notes||'—'}</td>
      <td><div style="display:flex;gap:4px"><button class="btn btn-ghost btn-sm" onclick="updateTask('\${t.id}','Completed')">✅</button><button class="btn btn-red btn-sm" onclick="deleteTask('\${t.id}')">🗑️</button></div></td>
    </tr>
  \`).join('');
}
function filterTasks(f,btn){taskFilter=f;document.querySelectorAll('#page-tasks .btn').forEach(b=>b.className=b===btn?'btn btn-blue btn-sm':'btn btn-ghost btn-sm');loadTasksPage();}
async function updateTask(id,s){await fetch('/api/tasks/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s})});loadTasksPage();loadStats();}
async function deleteTask(id){await fetch('/api/tasks/'+id,{method:'DELETE'});loadTasksPage();loadStats();}
async function clearCompletedTasks(){await fetch('/api/tasks/completed/all',{method:'DELETE'});loadTasksPage();loadStats();toast('Cleared!','green');}
function populateTaskModal(){api('/api/clients').then(cs=>populateClientSelects(cs));}
async function saveTask(){const clientId=document.getElementById('task-client').value;const botType=document.getElementById('task-bottype').value;const website=document.getElementById('task-website').value.trim();const notes=document.getElementById('task-notes').value.trim();if(!clientId){toast('Select client!','red');return;}await api('/api/tasks','POST',{clientId,botType,website,notes,status:'Pending'});closeModal('taskModal');loadTasksPage();loadStats();toast('Task added!','green');}

async function loadTrackerPage(){
  const subs=await api('/api/submissions');
  const tbody=document.getElementById('trackerTableBody');if(!tbody)return;
  let filtered=subs||[];
  if(trackerFilter!=='all')filtered=filtered.filter(s=>s.botType===trackerFilter);
  if(filtered.length===0){tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px">No submissions yet</td></tr>';return;}
  tbody.innerHTML=filtered.map(s=>\`
    <tr>
      <td style="font-size:11px;color:var(--muted);white-space:nowrap">\${(s.date||'').split(',')[0]||'—'}</td>
      <td class="td-bold">\${s.client||'—'}</td>
      <td>\${s.website||'—'}</td>
      <td><span class="bot-badge bb-\${s.botType||'directory'}">\${s.botType||'—'}</span></td>
      <td>\${statusPill(s.status)}</td>
      <td>\${s.profileUrl?\`<a href="\${s.profileUrl}" target="_blank" style="color:var(--blue);font-size:11px">View ↗</a>\`:'—'}</td>
      <td>\${s.submissionUrl?\`<a href="\${s.submissionUrl}" target="_blank" style="color:var(--blue);font-size:11px">View ↗</a>\`:'—'}</td>
      <td>\${s.screenshotPath?\`<img src="\${s.screenshotPath}" class="ss-thumb" onclick="viewSS('\${s.screenshotPath}','\${s.client} - \${s.website}')"/>\`:'—'}</td>
      <td style="color:var(--muted);font-size:11px">\${s.notes||'—'}</td>
    </tr>
  \`).join('');
}
function filterTracker(f,btn){trackerFilter=f;document.querySelectorAll('#page-tracker .btn').forEach(b=>b.className=b===btn?'btn btn-blue btn-sm':'btn btn-ghost btn-sm');loadTrackerPage();}
async function exportTracker(){const subs=await api('/api/submissions');const h=['Date','Client','Website','Bot','Status','Profile URL','Sub URL','Screenshot','Issue','Notes'];const rows=subs.map(s=>[s.date,s.client,s.website,s.botType,s.status,s.profileUrl,s.submissionUrl,s.screenshotPath,s.issue,s.notes].map(v=>\`"\${String(v||'').replace(/"/g,'""')}"\`).join(','));const csv=[h.join(','),...rows].join('\\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='submissions-'+Date.now()+'.csv';a.click();toast('Exported!','green');}

function viewSS(src,title){document.getElementById('ssModalTitle').textContent=title;document.getElementById('ssModalImg').src=src;openModal('ssModal');}

async function loadAlertsPage(){
  const alerts=await api('/api/alerts');const el=document.getElementById('alertsList');if(!el)return;
  if(!alerts||alerts.length===0){el.innerHTML='<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">No alerts yet</div></div>';return;}
  el.innerHTML=alerts.map(a=>\`
    <div class="card" style="margin-bottom:10px;border-color:\${a.status==='pending'?'var(--yellow)':'var(--border)'}">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:24px">\${a.status==='pending'?'🚨':'✅'}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:13px">\${a.client} → \${a.website}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">\${a.issue} · \${a.createdAt}</div>
          \${a.action?\`<div style="font-size:11px;color:var(--green);margin-top:2px">Action: \${a.action}</div>\`:''}
        </div>
        \${a.status==='pending'?\`<div style="display:flex;flex-direction:column;gap:4px">
          <button class="btn btn-green btn-sm" onclick="currentAlertId='\${a.id}';doAction('done')">✅ Done</button>
          <button class="btn btn-yellow btn-sm" onclick="currentAlertId='\${a.id}';doAction('skip')">⏭️ Skip</button>
          <button class="btn btn-orange btn-sm" onclick="currentAlertId='\${a.id}';doAction('retry')">🔄 Retry</button>
          <button class="btn btn-red btn-sm" onclick="currentAlertId='\${a.id}';doAction('stop')">🛑 Stop</button>
        </div>\`:\`<span class="pill p-done">Resolved · \${a.action}</span>\`}
      </div>
    </div>
  \`).join('');
}

async function loadScreenshots(){
  const el=document.getElementById('screenshotsList');if(!el)return;
  const subs=await api('/api/submissions');
  const withSS=(subs||[]).filter(s=>s.screenshotPath);
  if(withSS.length===0){el.innerHTML='<div class="empty"><div class="empty-icon">📸</div><div class="empty-title">No screenshots yet</div><div>Bot will save screenshots automatically</div></div>';return;}
  el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">'+withSS.map(s=>\`
    <div class="card" style="padding:10px;cursor:pointer" onclick="viewSS('\${s.screenshotPath}','\${s.client} - \${s.website}')">
      <img src="\${s.screenshotPath}" style="width:100%;border-radius:6px;margin-bottom:8px;height:120px;object-fit:cover"/>
      <div style="font-weight:700;font-size:12px">\${s.website}</div>
      <div style="font-size:11px;color:var(--muted)">\${s.client} · \${(s.date||'').split(',')[0]||'—'}</div>
    </div>
  \`).join('')+'</div>';
}

async function populateBotSelects(){const cs=await api('/api/clients');populateClientSelects(cs);}
async function startBot(){const clientId=document.getElementById('quickClient')?.value;const botType=document.getElementById('quickBot')?.value||'directory';if(!clientId){toast('Select client!','red');return;}const r=await api('/api/bot/start','POST',{clientId,botType});toast('▶️ Bot started — '+r.tasks+' tasks!','green');loadStats();}
async function startBotFull(){const clientId=document.getElementById('bc-client')?.value;const botType=document.getElementById('bc-bot')?.value||'directory';if(!clientId){toast('Select client!','red');return;}const r=await api('/api/bot/start','POST',{clientId,botType});toast('▶️ Started — '+r.tasks+' tasks!','green');loadStats();}
async function pauseBot(){await fetch('/api/bot/pause',{method:'POST'});toast('⏸️ Paused','yellow');loadStats();}
async function resumeBot(){await fetch('/api/bot/resume',{method:'POST'});toast('▶️ Resumed','green');loadStats();}
async function stopBot(){await fetch('/api/bot/stop',{method:'POST'});toast('🛑 Stopped','red');loadStats();}

async function registerSW(){if(!('serviceWorker' in navigator))return;try{const reg=await navigator.serviceWorker.register('/sw.js');sw=reg;navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='NOTIF_ACTION')handleNotifAction(e.data.action,e.data.data);});}catch(e){console.warn('SW:',e);}}

async function enableNotif(){if(!('Notification' in window)){toast('Not supported','red');return;}const perm=await Notification.requestPermission();if(perm!=='granted'){toast('Please allow notifications!','red');return;}try{const reg=sw||await(async()=>{await registerSW();return sw;})();if(!reg){toast('SW not ready','red');return;}const kd=await(await fetch('/api/vapid-key')).json();const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToUint8(kd.publicKey)});const r=await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub)});if((await r.json()).success){document.getElementById('notifBanner').classList.add('hidden');document.getElementById('notifStatusSetting').textContent='✅ Active — Siren ready!';document.getElementById('notifStatusSetting').style.color='var(--green)';toast('🔔 Siren enabled!','green');}}catch(e){toast('Failed: '+e.message,'red');}}
async function testSiren(){await fetch('/api/test-siren',{method:'POST'});toast('🧪 Test siren sent!','blue');}

function showAlertPopup(alert){currentAlertId=alert.id||alert.alertId;document.getElementById('aClient').textContent=alert.client||'—';document.getElementById('aWebsite').textContent=alert.website||'—';document.getElementById('aIssue').textContent=alert.issue||'—';document.getElementById('aTime').textContent=alert.createdAt||'';document.getElementById('alertOverlay').classList.add('show');document.body.classList.add('siren');document.title='🚨 ACTION NEEDED!';playSiren();}
function closeAlertPopup(){document.getElementById('alertOverlay').classList.remove('show');document.body.classList.remove('siren');stopSiren();currentAlertId=null;document.title='P4G SEO Automation Platform';}
async function doAction(action){if(!currentAlertId)return;stopSiren();const r=await fetch('/api/alerts/'+currentAlertId+'/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});if((await r.json()).success){closeAlertPopup();toast('Action "'+action+'" sent!',action==='stop'?'red':'green');loadStats();loadAlertsPage();}}
function handleNotifAction(action,data){if(!data)return;currentAlertId=data.alertId||data.id;if(['done','skip','retry','stop'].includes(action))doAction(action);else showAlertPopup(data);}
function renderOverviewAlerts(alerts){const el=document.getElementById('overviewAlerts');if(!el)return;if(alerts.length===0){el.innerHTML='<div class="empty"><div class="empty-icon">✅</div><div class="empty-title">All clear! No pending alerts.</div></div>';return;}el.innerHTML=alerts.map(a=>\`<div style="background:var(--s2);border:1px solid var(--yellow);border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px"><div style="flex:1"><div style="font-weight:700;font-size:12px">🚨 \${a.client} → \${a.website}</div><div style="font-size:11px;color:var(--muted);margin-top:2px">\${a.issue}</div></div><div style="display:flex;gap:4px"><button class="btn btn-green btn-sm" onclick="currentAlertId='\${a.id}';doAction('done')">✅</button><button class="btn btn-yellow btn-sm" onclick="currentAlertId='\${a.id}';doAction('skip')">⏭️</button><button class="btn btn-orange btn-sm" onclick="currentAlertId='\${a.id}';doAction('retry')">🔄</button><button class="btn btn-red btn-sm" onclick="currentAlertId='\${a.id}';doAction('stop')">🛑</button></div></div>\`).join('');}

function playSiren(){if(sirenPlaying)return;sirenPlaying=true;sirenStop=false;if(navigator.vibrate){const vib=()=>{if(!sirenPlaying)return;navigator.vibrate([600,200,600,200,1000]);setTimeout(vib,2200);};vib();}try{sirenCtx=new(window.AudioContext||window.webkitAudioContext)();async function loop(){while(!sirenStop){for(const[f1,f2]of[[600,1400],[1400,600]]){if(sirenStop)break;const o=sirenCtx.createOscillator(),g=sirenCtx.createGain();o.connect(g);g.connect(sirenCtx.destination);o.type='sawtooth';o.frequency.setValueAtTime(f1,sirenCtx.currentTime);o.frequency.linearRampToValueAtTime(f2,sirenCtx.currentTime+0.5);g.gain.setValueAtTime(0,sirenCtx.currentTime);g.gain.linearRampToValueAtTime(0.5,sirenCtx.currentTime+0.1);g.gain.linearRampToValueAtTime(0,sirenCtx.currentTime+0.5);o.start(sirenCtx.currentTime);o.stop(sirenCtx.currentTime+0.5);await new Promise(r=>setTimeout(r,500));}}}loop();}catch(e){}}
function stopSiren(){sirenPlaying=false;sirenStop=true;if(sirenCtx){try{sirenCtx.close();}catch{}sirenCtx=null;}if(navigator.vibrate)navigator.vibrate(0);}

async function loadStats(){try{const d=await api('/api/stats');if(!d)return;const ids={'st-clients':d.totalClients,'st-active':d.activeClients,'st-totalbots':d.totalBots,'st-runningbots':d.runningBots,'st-pending':d.pendingTasks,'st-completed':d.completedTasks,'st-failed':d.failedTasks,'st-backlinks':d.todayBacklinks,'st-profiles':d.todayProfiles,'st-blogs':d.todayBlogs,'st-dirs':d.todayDirectories,'st-palerts':d.pendingAlerts};Object.entries(ids).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.textContent=val||0;});const pa=d.pendingAlerts||0;['sb-alerts','alertBadgeTop'].forEach(id=>{const el=document.getElementById(id);if(el){el.textContent=pa;el.style.display=pa>0?'inline-block':'none';}});const pt=d.pendingTasks||0;const sbT=document.getElementById('sb-tasks');if(sbT){sbT.textContent=pt;sbT.style.display=pt>0?'inline-block':'none';}updateBotUI(d.botStatus||{});if(pa>0){const alerts=await api('/api/alerts/pending');if(alerts?.length>0&&!currentAlertId)showAlertPopup(alerts[0]);renderOverviewAlerts(alerts||[]);}else{renderOverviewAlerts([]);if(currentAlertId)closeAlertPopup();}}catch{}}

function updateBotUI(bs){const status=bs.status||'idle';['botDot','botDot2'].forEach(id=>{const el=document.getElementById(id);if(el)el.className='live-dot '+status;});document.getElementById('topDot')?.setAttribute('class','live-dot '+status);const smap={idle:'⏹️ Idle',running:'▶️ Running',paused:'⏸️ Paused',stopped:'🛑 Stopped'};const stxt=smap[status]||status;document.getElementById('topStatus').textContent=stxt;['botStatusText','botStatusText2'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=stxt;});const job=bs.currentJob||'No active job';['botJobText','botJobText2'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=job;});['bc-pending','bc-running','bc-completed'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=0;});}

function renderLogs(){const el=document.getElementById('logList');if(!el)return;if(liveLogs.length===0){el.innerHTML='<div style="color:var(--muted);padding:12px;font-size:11px">Waiting for bot activity...</div>';return;}el.innerHTML=liveLogs.slice(0,200).map(l=>\`<div style="padding:5px 12px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:flex-start"><span style="color:\${l.type==='ok'||l.type==='success'?'var(--green)':l.type==='error'?'var(--red)':l.type==='warn'?'var(--yellow)':'var(--blue)'};font-weight:700;flex-shrink:0">[\${(l.type||'info').toUpperCase()}]</span><span style="flex:1">\${l.msg}</span><span style="color:var(--muted);font-size:10px;flex-shrink:0">\${(l.time||'').split(',')[1]||''}</span></div>\`).join('');}

function statusPill(s){const m={'Pending':'p-pending','Running':'p-running','Completed':'p-done','Done':'p-done','Failed':'p-failed','Paused':'p-paused','Waiting Manual Action':'p-waiting'};return \`<span class="pill \${m[s]||'p-idle'}"><span class="pill-dot"></span>\${s||'—'}</span>\`;}
function b64ToUint8(b){const pad='='.repeat((4-b.length%4)%4);const raw=window.atob((b+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
async function api(url,method,data){try{const opts={method:method||'GET',headers:{'Content-Type':'application/json'}};if(data)opts.body=JSON.stringify(data);const r=await fetch(url,opts);return await r.json();}catch{return null;}}
function toast(msg,color='green'){const colors={green:'var(--green)',red:'var(--red)',blue:'var(--blue)',yellow:'var(--yellow)'};const el=document.createElement('div');el.className='toast t-'+color;el.textContent=msg;document.getElementById('toastContainer').appendChild(el);setTimeout(()=>el.classList.add('show'),10);setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),400);},3500);}

function connectSSE(){const es=new EventSource('/api/events');es.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.type==='ALERT'){showAlertPopup(d.alert);renderOverviewAlerts([d.alert]);loadStats();}else if(d.type==='ACTION_TAKEN'){if(d.alertId===currentAlertId)closeAlertPopup();loadStats();}else if(d.type==='LOG'){liveLogs.unshift(d.entry);renderLogs();}else if(d.type==='HEARTBEAT'){updateBotUI(d.status||{});}}catch{}};es.onerror=()=>setTimeout(connectSSE,3000);}

async function loadAll(){await loadStats();const cs=await api('/api/clients');if(cs)populateClientSelects(cs);const ts=await api('/api/submissions/today');if(ts){const el=document.getElementById('recentSubs');if(el&&ts.length>0)el.innerHTML=ts.slice(0,5).map(s=>\`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span class="bot-badge bb-\${s.botType||'directory'}">\${s.botType||'dir'}</span><span style="flex:1;font-weight:600;font-size:12px">\${s.client} → \${s.website}</span>\${statusPill(s.status)}</div>\`).join('');}}

if(Notification.permission==='granted')document.getElementById('notifBanner').classList.add('hidden');
registerSW();loadAll();connectSSE();setInterval(loadStats,6000);
</script>
</body>
</html>`;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n\x1b[35m' + '═'.repeat(55) + '\x1b[0m');
  console.log('\x1b[35m  P4G SEO AUTOMATION PLATFORM v2.0 — READY\x1b[0m');
  console.log(`\x1b[36m  http://localhost:${PORT}\x1b[0m`);
  console.log('\x1b[32m  ✅ All features active!\x1b[0m');
  console.log('\x1b[35m' + '═'.repeat(55) + '\x1b[0m\n');
});

module.exports = { app };
