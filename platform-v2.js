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

const UPLOADS_DIR     = path.join(__dirname, 'uploads');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
[UPLOADS_DIR, SCREENSHOTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
app.use('/uploads',     express.static(UPLOADS_DIR));
app.use('/screenshots', express.static(SCREENSHOTS_DIR));

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

db.seedDefaultData();

// ─── GOOGLE SHEET PING ────────────────────────────────────────────────────────
async function pingGoogleSheet(data) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0,10),
        client: data.clientName || data.client || '',
        site: data.website || data.site || '',
        bot: data.botType || data.bot || '',
        url: data.submissionUrl || data.url || '',
        status: data.status || 'Completed'
      })
    });
  } catch(e) { logger.warn('Sheet ping failed: ' + e.message); }
}

// ─── STATS ───────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => res.json({ ...db.getStats(), botStatus: queue.getStatus() }));

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
app.get('/api/clients',              (req, res) => res.json(db.clients.getAll()));
app.get('/api/clients/:id',          (req, res) => res.json(db.clients.getById(req.params.id) || {}));
app.post('/api/clients',             (req, res) => res.json(db.clients.add(req.body)));
app.put('/api/clients/:id',          (req, res) => res.json(db.clients.update(req.params.id, req.body)));
app.delete('/api/clients/:id',       (req, res) => res.json({ success: db.clients.delete(req.params.id) }));
app.post('/api/clients/:id/duplicate', (req, res) => res.json(db.clients.duplicate(req.params.id)));

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

// ─── SUBMISSIONS ─────────────────────────────────────────────────────────────
app.get('/api/submissions',           (req, res) => res.json(db.submissions.getAll()));
app.get('/api/submissions/today',     (req, res) => res.json(db.submissions.getToday()));
app.post('/api/submissions',          async (req, res) => {
  const sub = db.submissions.add(req.body);
  // Auto-ping Google Sheet when bot marks a submission complete
  if (req.body.status === 'Completed' || req.body.status === 'Live') {
    pingGoogleSheet({ ...req.body, ...sub }).catch(() => {});
  }
  res.json(sub);
});
app.put('/api/submissions/:id',       async (req, res) => {
  const sub = db.submissions.update(req.params.id, req.body);
  // Also ping if status updated to Completed
  if (req.body.status === 'Completed' || req.body.status === 'Live') {
    const full = db.submissions.getById ? db.submissions.getById(req.params.id) : req.body;
    pingGoogleSheet({ ...full, ...req.body }).catch(() => {});
  }
  res.json(sub);
});

// Screenshot save
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
const P4G_SITE_NAMES = {
  directory:    ['Brownbook','Hotfrog','Cylex','Tupalo','Storeboard','Sulekha','IndiaMART','ExportersIndia','FreeListingIndia'],
  article:      ['HubPages','EzineArticles','ArticleBiz','SooperArticles','SelfGrowth','ApSense','Medium','Hashnode','Bloglovin'],
  rss:          ['Feedage','FeedShark','Feedebee','RSSmountain','FeedmapNet'],
  microblog:    ['Tumblr','Plurk','Diigo','Mastodon'],
  web2:         ['WordPress','Blogger','Weebly','Site123','Strikingly','Jimdo'],
  guestpost:    ['Medium','HubPages','DevTo'],
  pptpdf:       ['SlideShare','Issuu','Scribd','Calameo','edocr','Yumpu'],
  image:        ['Flickr','Pinterest','Imgur','Ipernity','500px'],
  classified:   ['Locanto','ClassifiedAds','Adpost','Storeboard','FreeAdsTime','Khojle'],
  pressrelease: ['OpenPR','PRLog','IssueWire','PRFree','1888PressRelease'],
  profile:      ['AboutMe','Gravatar','Behance','Crunchbase','Disqus','Slides'],
};
app.post('/api/bot/start', (req, res) => {
  const { clientId, botType } = req.body;
  const client = db.clients.getById(clientId);
  if (!client) return res.json({ success: false, error: 'Client not found' });
  let sites = [];
  if (P4G_SITE_NAMES[botType])       sites = P4G_SITE_NAMES[botType].map(name => ({ name }));
  else if (botType === 'directory')  sites = db.directories.getActive();
  else if (botType === 'profile')    sites = db.profiles.getActive();
  else if (botType === 'blog')       sites = db.blogs.getActive();
  else                               sites = db.directories.getActive();
  if (!sites.length) sites = [{ name: '' }];
  sites.forEach(s => db.tasks.add({ clientId, clientName: client.name, botType, website: s.name, site: s.name, websiteId: s.id, status: 'Pending' }));
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
  return `const CACHE='p4g-v3';const OFFLINE=['/','/manifest.json'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(OFFLINE)));self.skipWaiting();});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});self.addEventListener('push',e=>{let d={};try{d=e.data.json();}catch{d={title:'P4G Alert',body:'Action needed!'}}e.waitUntil(self.registration.showNotification(d.title||'🚨 Manual Action Required',{body:d.body,tag:d.tag||'alert',data:d,requireInteraction:true,vibrate:[500,200,500,200,1000],actions:[{action:'done',title:'✅ Done'},{action:'skip',title:'⏭️ Skip'},{action:'retry',title:'🔄 Retry'},{action:'stop',title:'🛑 Stop'}]}));});self.addEventListener('notificationclick',e=>{const a=e.action,d=e.notification.data||{};e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{const url='/?page=alerts&alertId='+(d.alertId||d.id||'')+'&action='+(a||'open');for(const c of cs){if(c.url.includes(self.location.origin)){c.focus();c.postMessage({type:'NOTIF_ACTION',action:a,data:d});return;}}return self.clients.openWindow(url);}));});`;
}

function getManifest() {
  return { name:'P4G SEO Platform', short_name:'P4G SEO', description:'Per4mance Guru SEO Automation Platform', start_url:'/', display:'standalone', background_color:'#080c14', theme_color:'#3b82f6', icons:[{src:'/icon.svg',sizes:'192x192',type:'image/svg+xml'},{src:'/icon.svg',sizes:'512x512',type:'image/svg+xml'}], shortcuts:[{name:'Dashboard',url:'/'},{name:'Clients',url:'/?page=clients'},{name:'Alerts',url:'/?page=alerts'},{name:'Bot Engine',url:'/?page=botcontrol'}] };
}

// ─── CLIENT AUTO-FILL ────────────────────────────────────────────────────────
app.post('/api/clients/enrich', async (req, res) => {
  try {
    let { url } = req.body;
    if (!url) return res.json({ success: false, error: 'No URL provided' });
    if (!process.env.GEMINI_API_KEY) return res.json({ success: false, error: 'GEMINI_API_KEY not set on server' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let html = '';
    try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; P4GBot/1.0)' } }); html = await r.text(); } catch (e) { html = ''; }
    const text = html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0, 8000);
    const prompt = 'From this business website, extract details as STRICT JSON only (no markdown). Empty string if unknown.\n\nURL: ' + url + '\n\nContent:\n' + text + '\n\nReturn exactly: {"name":"","bizName":"","category":"","email":"","phone":"","mobile":"","address":"","city":"","state":"","zip":"","country":"","primaryKeyword":"","secondaryKeyword":"","targetLocation":"","facebook":"","instagram":"","linkedin":"","youtube":"","twitter":"","shortDesc":"","longDesc":""}';
    const gr = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' } })
    });
    const data = await gr.json();
    if (data.error) return res.json({ success: false, error: data.error.message || 'Gemini failed' });
    let raw = ''; try { raw = data.candidates[0].content.parts.map(p => p.text).join(''); } catch { raw = ''; }
    raw = raw.replace(/```json|```/g,'').trim();
    let info = {};
    try { info = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { info = JSON.parse(m[0]); } catch { info = null; } } if (!info) return res.json({ success:false, error:'Could not parse AI response' }); }
    info.website = url;
    res.json({ success: true, info });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getDashboardHTML());
});

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>P4G — Backlink Command</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;450;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#F6F7F9; --surface:#FFFFFF; --surface-2:#FBFCFD;
  --ink:#171A21; --ink-soft:#454B57; --muted:#8A909E; --faint:#B6BCC8;
  --border:#EAECF1; --border-2:#E0E3EA;
  --primary:#4636E6; --primary-soft:#EEECFD; --primary-ink:#3A2CC9;
  --green:#12A150; --green-soft:#E5F5EC;
  --amber:#C77700; --amber-soft:#FBF0DD;
  --red:#D64545; --red-soft:#FBE9E9;
  --cyan:#0E8FA8; --pink:#C42B7A; --violet:#7C3AED; --orange:#DC6803;
  --shadow-sm:0 1px 2px rgba(23,26,33,.04),0 1px 3px rgba(23,26,33,.06);
  --shadow-md:0 4px 12px rgba(23,26,33,.06),0 2px 4px rgba(23,26,33,.04);
  --shadow-lg:0 12px 32px rgba(23,26,33,.10),0 4px 8px rgba(23,26,33,.05);
  --r:14px; --r-sm:10px;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;font-size:14px;line-height:1.5;}
::selection{background:var(--primary-soft);color:var(--primary-ink)}
h1,h2,h3,h4{font-family:'Space Grotesk',sans-serif;font-weight:600;letter-spacing:-.02em;line-height:1.15}
.mono{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
button{font-family:inherit;cursor:pointer;border:none;background:none}
input,select,textarea{font-family:inherit;font-size:14px}
a{color:inherit;text-decoration:none}
.app{display:grid;grid-template-columns:250px 1fr;min-height:100vh}
.sidebar{background:var(--surface);border-right:1px solid var(--border);padding:22px 16px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:6px;}
.brand{display:flex;align-items:center;gap:11px;padding:6px 8px 20px;margin-bottom:6px}
.brand-mark{width:36px;height:36px;border-radius:10px;flex-shrink:0;position:relative;background:linear-gradient(135deg,var(--primary),#6B5CFF);box-shadow:0 4px 10px rgba(70,54,230,.28);}
.brand-mark::before,.brand-mark::after{content:"";position:absolute;width:11px;height:6px;border:2px solid #fff;border-radius:6px;}
.brand-mark::before{top:12px;left:8px;transform:rotate(-40deg)}
.brand-mark::after{top:17px;left:14px;transform:rotate(-40deg)}
.brand-name{font-family:'Space Grotesk';font-weight:700;font-size:16px;letter-spacing:-.02em}
.brand-sub{font-size:11px;color:var(--muted);margin-top:1px;letter-spacing:.01em}
.nav-label{font-size:11px;font-weight:600;color:var(--faint);letter-spacing:.06em;text-transform:uppercase;padding:14px 10px 6px}
.nav-item{display:flex;align-items:center;gap:11px;padding:9px 11px;border-radius:var(--r-sm);color:var(--ink-soft);font-weight:500;font-size:13.5px;transition:all .16s ease;position:relative;}
.nav-item svg{width:18px;height:18px;stroke-width:1.9;flex-shrink:0;opacity:.85}
.nav-item:hover{background:var(--surface-2);color:var(--ink)}
.nav-item.active{background:var(--primary-soft);color:var(--primary-ink);font-weight:600}
.nav-item.active svg{opacity:1}
.nav-badge{margin-left:auto;font-size:11px;font-weight:600;background:var(--surface-2);color:var(--muted);padding:1px 7px;border-radius:20px;min-width:20px;text-align:center}
.nav-item.active .nav-badge{background:#fff;color:var(--primary-ink)}
.side-foot{margin-top:auto;padding:12px 10px 4px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:6px}
.dot.live{background:var(--green);box-shadow:0 0 0 3px var(--green-soft)}
.dot.demo{background:var(--amber);box-shadow:0 0 0 3px var(--amber-soft)}
.main{display:flex;flex-direction:column;min-width:0}
.topbar{display:flex;align-items:center;gap:16px;padding:18px 30px;border-bottom:1px solid var(--border);background:rgba(246,247,249,.82);backdrop-filter:blur(8px);position:sticky;top:0;z-index:20;}
.page-title h1{font-size:21px}
.page-title p{font-size:12.5px;color:var(--muted);margin-top:2px}
.search{margin-left:auto;display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);padding:8px 12px;width:230px;transition:all .16s;}
.search:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.search svg{width:15px;height:15px;color:var(--muted);flex-shrink:0}
.search input{border:none;outline:none;width:100%;background:none;color:var(--ink)}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:var(--r-sm);font-weight:600;font-size:13.5px;transition:all .16s ease;white-space:nowrap;}
.btn svg{width:16px;height:16px;stroke-width:2}
.btn-primary{background:var(--primary);color:#fff;box-shadow:0 2px 6px rgba(70,54,230,.25)}
.btn-primary:hover{background:var(--primary-ink);box-shadow:0 4px 12px rgba(70,54,230,.32);transform:translateY(-1px)}
.btn-ghost{background:var(--surface);color:var(--ink-soft);border:1px solid var(--border)}
.btn-ghost:hover{border-color:var(--border-2);background:var(--surface-2)}
.btn-sm{padding:6px 11px;font-size:12.5px;border-radius:8px}
.btn-danger{background:var(--red-soft);color:var(--red);border:1px solid #F5C6C6}
.btn-danger:hover{background:var(--red);color:#fff}
.content{padding:26px 30px 60px;flex:1}
.page{display:none;animation:fadeUp .38s cubic-bezier(.22,.61,.36,1)}
.page.active{display:block}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 18px 16px;box-shadow:var(--shadow-sm);transition:all .2s ease;position:relative;overflow:hidden;}
.stat:hover{box-shadow:var(--shadow-md);transform:translateY(-2px)}
.stat-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.stat-ico{width:36px;height:36px;border-radius:10px;display:grid;place-items:center}
.stat-ico svg{width:19px;height:19px;stroke-width:2}
.stat-trend{font-size:11.5px;font-weight:600;color:var(--green);background:var(--green-soft);padding:2px 8px;border-radius:20px}
.stat-val{font-family:'Space Grotesk';font-size:30px;font-weight:600;letter-spacing:-.03em;line-height:1}
.stat-label{font-size:12.5px;color:var(--muted);margin-top:6px;font-weight:500}
.grid-2{display:grid;grid-template-columns:1.55fr 1fr;gap:16px;margin-bottom:16px}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--shadow-sm)}
.panel-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--border)}
.panel-head h3{font-size:15px}
.panel-head .sub{font-size:12px;color:var(--muted);font-weight:400;margin-top:2px}
.panel-body{padding:16px 18px}
.link-btn{font-size:12.5px;color:var(--primary);font-weight:600;display:inline-flex;align-items:center;gap:4px}
.link-btn:hover{color:var(--primary-ink)}
.fleet{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.bot{display:flex;align-items:center;gap:11px;padding:11px 12px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);transition:all .18s ease;}
.bot:hover{border-color:var(--border-2);background:var(--surface);box-shadow:var(--shadow-sm)}
.bot-ico{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:15px;flex-shrink:0}
.bot-info{min-width:0;flex:1}
.bot-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bot-meta{font-size:11.5px;color:var(--muted);display:flex;align-items:center;gap:5px;margin-top:1px}
.pulse{width:6px;height:6px;border-radius:50%;background:var(--faint);flex-shrink:0}
.bot.running .pulse{background:var(--green);animation:pulse 1.6s infinite}
.bot.running .bot-meta{color:var(--green)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(18,161,80,.4)}70%{box-shadow:0 0 0 6px rgba(18,161,80,0)}100%{box-shadow:0 0 0 0 rgba(18,161,80,0)}}
.attention{padding:14px 16px;border-radius:var(--r-sm);border:1px solid var(--amber-soft);background:linear-gradient(0deg,#FEFBF4,#fff);display:flex;gap:12px;align-items:flex-start;margin-bottom:10px}
.attention:last-child{margin-bottom:0}
.att-ico{width:30px;height:30px;border-radius:8px;background:var(--amber-soft);color:var(--amber);display:grid;place-items:center;flex-shrink:0}
.att-ico svg{width:16px;height:16px}
.att-body{flex:1;min-width:0}
.att-title{font-size:13px;font-weight:600}
.att-desc{font-size:12px;color:var(--muted);margin-top:1px}
.att-actions{display:flex;gap:6px;margin-top:9px}
.empty{text-align:center;padding:34px 20px;color:var(--muted)}
.empty svg{width:34px;height:34px;color:var(--faint);margin-bottom:10px;stroke-width:1.5}
.empty h4{font-size:14px;color:var(--ink-soft);margin-bottom:3px;font-weight:600}
.empty p{font-size:12.5px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;text-align:left;padding:10px 14px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:12px 14px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle}
tr:last-child td{border-bottom:none}
tbody tr{transition:background .14s}
tbody tr:hover{background:var(--surface-2)}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:20px;white-space:nowrap}
.tag .tdot{width:6px;height:6px;border-radius:50%}
.t-green{background:var(--green-soft);color:var(--green)} .t-green .tdot{background:var(--green)}
.t-amber{background:var(--amber-soft);color:var(--amber)} .t-amber .tdot{background:var(--amber)}
.t-red{background:var(--red-soft);color:var(--red)} .t-red .tdot{background:var(--red)}
.t-blue{background:var(--primary-soft);color:var(--primary-ink)} .t-blue .tdot{background:var(--primary)}
.t-gray{background:var(--surface-2);color:var(--muted);border:1px solid var(--border)} .t-gray .tdot{background:var(--faint)}
.cell-strong{font-weight:600}
.cell-link{color:var(--primary);font-weight:500}
.cell-link:hover{text-decoration:underline}
.cell-muted{color:var(--muted);font-size:12px}
.client-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.client-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:16px;box-shadow:var(--shadow-sm);transition:all .2s ease}
.client-card:hover{box-shadow:var(--shadow-md);transform:translateY(-2px);border-color:var(--border-2)}
.cc-top{display:flex;align-items:center;gap:11px;margin-bottom:13px}
.cc-avatar{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;font-family:'Space Grotesk';font-weight:600;font-size:16px;color:#fff;flex-shrink:0}
.cc-name{font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-cat{font-size:12px;color:var(--muted)}
.cc-stats{display:flex;gap:8px;margin-bottom:12px}
.cc-stat{flex:1;background:var(--surface-2);border-radius:9px;padding:9px 10px;text-align:center}
.cc-stat b{font-family:'Space Grotesk';font-size:17px;font-weight:600;display:block}
.cc-stat span{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em}
.cc-foot{display:flex;gap:7px}
.toolbar{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.chip{padding:7px 13px;border-radius:20px;font-size:12.5px;font-weight:500;border:1px solid var(--border);background:var(--surface);color:var(--ink-soft);transition:all .15s}
.chip:hover{border-color:var(--border-2)}
.chip.active{background:var(--ink);color:#fff;border-color:var(--ink)}
.spacer{margin-left:auto}
.pill-select{padding:8px 12px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface);color:var(--ink);font-weight:500;cursor:pointer}
.overlay{position:fixed;inset:0;background:rgba(23,26,33,.28);backdrop-filter:blur(3px);z-index:100;display:none;align-items:flex-start;justify-content:center;padding:40px 20px;overflow-y:auto}
.overlay.show{display:flex;animation:fade .2s}
@keyframes fade{from{opacity:0}to{opacity:1}}
.modal{background:var(--surface);border-radius:18px;width:100%;max-width:620px;box-shadow:var(--shadow-lg);animation:pop .28s cubic-bezier(.22,.61,.36,1);overflow:hidden}
@keyframes pop{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
.modal-head{padding:20px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.modal-head h3{font-size:17px}
.x-btn{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--muted);transition:all .15s}
.x-btn:hover{background:var(--surface-2);color:var(--ink)}
.modal-body{padding:22px;max-height:70vh;overflow-y:auto}
.enrich-bar{display:flex;gap:9px;background:var(--primary-soft);border:1px solid #DAD5FB;border-radius:var(--r-sm);padding:11px;margin-bottom:20px}
.enrich-bar input{flex:1;border:1px solid #D5CFF9;border-radius:8px;padding:9px 12px;outline:none;background:#fff}
.enrich-bar input:focus{border-color:var(--primary)}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.fg{display:flex;flex-direction:column;gap:6px}
.fg.full{grid-column:1/-1}
.fg label{font-size:12px;font-weight:600;color:var(--ink-soft)}
.fg input,.fg textarea,.fg select{border:1px solid var(--border-2);border-radius:9px;padding:9px 11px;outline:none;background:var(--surface);transition:all .15s;color:var(--ink)}
.fg input:focus,.fg textarea:focus,.fg select:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.modal-foot{padding:16px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;background:var(--surface-2)}
/* Task detail modal specific */
.detail-row{display:flex;flex-direction:column;gap:5px;padding:12px 0;border-bottom:1px solid var(--border)}
.detail-row:last-child{border-bottom:none}
.detail-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.detail-val{font-size:14px;color:var(--ink)}
.detail-url{color:var(--primary);font-weight:500;word-break:break-all}
.detail-url:hover{text-decoration:underline}
.detail-screenshot{width:100%;border-radius:10px;border:1px solid var(--border);margin-top:6px}
.no-data{color:var(--muted);font-style:italic;font-size:13px}
/* Sheet setup banner */
.sheet-banner{background:var(--green-soft);border:1px solid #A7DFC0;border-radius:var(--r-sm);padding:14px 16px;margin-bottom:16px;display:flex;gap:12px;align-items:center}
.sheet-banner svg{width:20px;height:20px;color:var(--green);flex-shrink:0}
.sheet-banner .sb-text{flex:1;font-size:13px}
.sheet-banner .sb-text b{display:block;font-weight:600;margin-bottom:2px}
.toast-wrap{position:fixed;bottom:24px;right:24px;z-index:200;display:flex;flex-direction:column;gap:10px}
.toast{background:var(--ink);color:#fff;padding:12px 16px;border-radius:var(--r-sm);font-size:13px;font-weight:500;box-shadow:var(--shadow-lg);display:flex;align-items:center;gap:9px;animation:slideIn .3s cubic-bezier(.22,.61,.36,1);max-width:340px}
.toast svg{width:17px;height:17px;flex-shrink:0}
.toast.ok{background:#0F7A3D} .toast.err{background:#B93A3A} .toast.info{background:var(--primary-ink)}
@keyframes slideIn{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:none}}
.section-gap{margin-top:22px}
.report-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.rs{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px 16px}
.rs b{font-family:'Space Grotesk';font-size:22px;display:block;letter-spacing:-.02em}
.rs span{font-size:12px;color:var(--muted)}
@media(max-width:1080px){.stat-grid{grid-template-columns:repeat(2,1fr)}.grid-2{grid-template-columns:1fr}.report-summary{grid-template-columns:repeat(2,1fr)}}
@media(max-width:720px){.app{grid-template-columns:1fr}.sidebar{display:none}.form-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark"></div>
      <div>
        <div class="brand-name">Backlink Command</div>
        <div class="brand-sub">Per4mance Guru</div>
      </div>
    </div>
    <nav id="nav">
      <div class="nav-item active" data-page="overview">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
        Overview
      </div>
      <div class="nav-item" data-page="clients">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0111 0"/><path d="M16 6.2a3 3 0 010 5.6M18.5 20a5.5 5.5 0 00-3-4.9"/></svg>
        Clients <span class="nav-badge" id="nb-clients">0</span>
      </div>
      <div class="nav-item" data-page="bots">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4M9 4h6"/><circle cx="9" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.3" fill="currentColor" stroke="none"/></svg>
        Bot Fleet <span class="nav-badge" id="nb-bots">11</span>
      </div>
      <div class="nav-item" data-page="backlinks">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 015.6 5.6l-1 1"/><path d="M13 18l-1 1a4 4 0 01-5.6-5.6l1-1"/></svg>
        Backlinks <span class="nav-badge" id="nb-links">0</span>
      </div>
      <div class="nav-item" data-page="tasks">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 1.5-2M4 12l1 1 1.5-2M4 18l1 1 1.5-2"/></svg>
        Task Queue <span class="nav-badge" id="nb-tasks">0</span>
      </div>
      <div class="nav-label">Library</div>
      <div class="nav-item" data-page="sites">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>
        Site Directory
      </div>
      <div class="nav-item" data-page="settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2l-.4-2.6H8.9l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 004 12a7 7 0 00.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2l.4 2.6h4.2l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0019 12z"/></svg>
        Settings
      </div>
    </nav>
    <div class="side-foot">
      <div id="conn-status"><span class="dot demo"></span>Demo data</div>
      <div style="margin-top:6px;font-size:11px;color:var(--faint)">v2.2 · 11-bot fleet</div>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <div class="page-title">
        <h1 id="pt-title">Overview</h1>
        <p id="pt-sub">Your backlink fleet at a glance</p>
      </div>
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
        <input placeholder="Search clients, sites…" id="globalSearch"/>
      </div>
      <button class="btn btn-primary" onclick="openClientModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>
        Add Client
      </button>
    </header>

    <div class="content">
      <!-- OVERVIEW -->
      <section class="page active" id="page-overview">
        <div class="stat-grid" id="statGrid"></div>
        <div class="grid-2">
          <div class="panel">
            <div class="panel-head">
              <div><h3>Bot Fleet</h3><div class="sub">Live status across all 11 bots</div></div>
              <a class="link-btn" onclick="go('bots')">View all →</a>
            </div>
            <div class="panel-body"><div class="fleet" id="fleetMini"></div></div>
          </div>
          <div class="panel">
            <div class="panel-head">
              <div><h3>Needs your attention</h3><div class="sub">Calm queue — handle when free</div></div>
            </div>
            <div class="panel-body" id="attentionList"></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head">
            <div><h3>Recent backlinks</h3><div class="sub">Latest submissions across clients</div></div>
            <a class="link-btn" onclick="go('backlinks')">Full report →</a>
          </div>
          <div class="table-wrap"><table id="recentLinks"></table></div>
        </div>
      </section>

      <!-- CLIENTS -->
      <section class="page" id="page-clients">
        <div class="toolbar">
          <div class="chip active">All clients</div>
          <div class="spacer"></div>
          <button class="btn btn-primary" onclick="openClientModal()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>Add Client</button>
        </div>
        <div class="client-grid" id="clientGrid"></div>
      </section>

      <!-- BOTS -->
      <section class="page" id="page-bots">
        <div class="panel"><div class="panel-body"><div class="fleet" id="fleetFull" style="grid-template-columns:repeat(3,1fr)"></div></div></div>
      </section>

      <!-- BACKLINKS -->
      <section class="page" id="page-backlinks">
        <div class="report-summary" id="reportSummary"></div>
        <div class="toolbar">
          <div class="chip active" onclick="filterLinks(this,'all')">All</div>
          <div class="chip" onclick="filterLinks(this,'Live')">Live</div>
          <div class="chip" onclick="filterLinks(this,'Pending')">Pending</div>
          <div class="chip" onclick="filterLinks(this,'Failed')">Failed</div>
          <div class="spacer"></div>
          <button class="btn btn-ghost btn-sm" onclick="exportCSV()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>Export CSV</button>
          <button class="btn btn-ghost btn-sm" onclick="exportToSheet()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>Sync to Sheet</button>
        </div>
        <div class="panel"><div class="table-wrap"><table id="linksTable"></table></div></div>
      </section>

      <!-- TASKS -->
      <section class="page" id="page-tasks">
        <div class="toolbar">
          <div class="spacer"></div>
          <button class="btn btn-danger btn-sm" onclick="clearCompleted()">Clear completed</button>
        </div>
        <div class="panel"><div class="table-wrap"><table id="tasksTable"></table></div></div>
      </section>

      <!-- SITES -->
      <section class="page" id="page-sites"><div id="sitesWrap"></div></section>

      <!-- SETTINGS -->
      <section class="page" id="page-settings">
        <div class="panel" style="max-width:640px">
          <div class="panel-head"><div><h3>Connection</h3><div class="sub">Dashboard API & integrations</div></div></div>
          <div class="panel-body" style="display:flex;flex-direction:column;gap:18px">
            <div class="fg full">
              <label>Dashboard API base URL</label>
              <input id="apiBaseInput" value=""/>
            </div>
            <div class="fg full">
              <label>Catch-all mail domain</label>
              <input value="p4gbacklinkautomation.work.gd" readonly/>
            </div>
            <hr style="border:none;border-top:1px solid var(--border)"/>
            <div style="font-family:'Space Grotesk';font-weight:600;font-size:15px">📊 Google Sheets Auto-Log</div>
            <div class="sheet-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M12 3a9 9 0 100 18A9 9 0 0012 3z"/></svg>
              <div class="sb-text">
                <b>Har completed backlink automatically sheet mein save hoga</b>
                Setup: Google Sheet kholo → Extensions → Apps Script → code paste karo → Deploy → URL yahan daalo
              </div>
            </div>
            <div class="fg full">
              <label>Google Apps Script Webhook URL</label>
              <input id="sheetWebhookInput" placeholder="https://script.google.com/macros/s/…/exec"/>
            </div>
            <div style="display:flex;gap:10px">
              <button class="btn btn-primary btn-sm" onclick="saveSettings()">Save & reconnect</button>
              <button class="btn btn-ghost btn-sm" onclick="testSheet()">Test Sheet connection</button>
            </div>
            <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-sm);padding:14px">
              <div style="font-weight:600;font-size:13px;margin-bottom:10px">Apps Script code (copy & paste):</div>
              <pre id="appsScriptCode" style="font-size:11px;color:var(--ink-soft);white-space:pre-wrap;line-height:1.6;font-family:monospace">function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    // Add header if sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Date', 'Client', 'Site', 'Bot', 'Backlink URL', 'Status']);
      sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#4636E6').setFontColor('#ffffff');
    }
    sheet.appendRow([data.date, data.client, data.site, data.bot, data.url || '—', data.status]);
    return ContentService.createTextOutput('ok');
  } catch(e) {
    return ContentService.createTextOutput('error: ' + e.message);
  }
}
function doGet(e) {
  return ContentService.createTextOutput('P4G Sheet Webhook Active');
}</pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<!-- CLIENT MODAL -->
<div class="overlay" id="clientOverlay">
  <div class="modal">
    <div class="modal-head">
      <h3 id="cmTitle">Add Client</h3>
      <button class="x-btn" onclick="closeClientModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="enrich-bar">
        <input id="enrichUrl" placeholder="Paste client website URL to auto-fill…"/>
        <button class="btn btn-primary btn-sm" id="enrichBtn" onclick="runEnrich()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l1.9 4.3L18 9l-4.1 1.7L12 15l-1.9-4.3L6 9l4.1-1.7z"/></svg>Auto-fill</button>
      </div>
      <div class="form-grid">
        <div class="fg"><label>Client name *</label><input id="f-name" placeholder="Per4mance Guru"/></div>
        <div class="fg"><label>Business name</label><input id="f-bizName" placeholder="PER4MANCE GURU"/></div>
        <div class="fg"><label>Website *</label><input id="f-website" placeholder="https://…"/></div>
        <div class="fg"><label>Category</label><input id="f-category" placeholder="Marketing Agency"/></div>
        <div class="fg"><label>Email</label><input id="f-email" placeholder="hello@…"/></div>
        <div class="fg"><label>Phone</label><input id="f-phone" placeholder="+91…"/></div>
        <div class="fg"><label>City</label><input id="f-city"/></div>
        <div class="fg"><label>Country</label><input id="f-country"/></div>
        <div class="fg"><label>Primary keyword</label><input id="f-primaryKeyword"/></div>
        <div class="fg"><label>Target location</label><input id="f-targetLocation"/></div>
        <div class="fg full"><label>Short description</label><textarea id="f-shortDesc" rows="2"></textarea></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeClientModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveClient()">Save client</button>
    </div>
  </div>
</div>

<!-- TASK DETAIL MODAL -->
<div class="overlay" id="taskOverlay">
  <div class="modal" style="max-width:520px">
    <div class="modal-head">
      <h3>Task Detail</h3>
      <button class="x-btn" onclick="closeTaskModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="modal-body" id="taskModalBody"></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeTaskModal()">Close</button>
      <button class="btn btn-primary btn-sm" id="taskOpenLink" onclick="openTaskLink()" style="display:none">Open backlink ↗</button>
    </div>
  </div>
</div>

<div class="toast-wrap" id="toastWrap"></div>

<script>
// ============ config ============
let API_BASE = '';
let LIVE = false;
let SHEET_URL = localStorage.getItem('p4g_sheet_url') || '';
let _currentTaskUrl = '';

const BOTS = [
  ['directory','Directory','📋','var(--primary)'],['article','Article','📝','var(--cyan)'],
  ['rss','RSS','📡','var(--orange)'],['microblog','Microblog','💬','var(--pink)'],
  ['web2','Web 2.0','🌐','var(--violet)'],['guestpost','Guest Post','✍️','var(--green)'],
  ['pptpdf','PPT / PDF','📄','var(--cyan)'],['image','Image','🖼️','var(--violet)'],
  ['classified','Classified','📢','var(--amber)'],['pressrelease','Press Release','📰','var(--green)'],
  ['profile','Profile','👤','var(--primary)']
];
const AVATAR_COLORS=['#4636E6','#0E8FA8','#DC6803','#C42B7A','#7C3AED','#12A150'];

const DEMO = {
  stats:{ totalClients:6, backlinksToday:18, runningBots:4, pendingTasks:12, totalLinks:247 },
  clients:[
    {id:'1',name:'Per4mance Guru',category:'Marketing Agency',website:'https://per4mance.guru',links:42,live:38},
    {id:'2',name:'Mackly',category:'Kids Sleepwear',website:'https://mackly.lk',links:31,live:27},
    {id:'3',name:'Assembly Travel',category:'Luggage & Travel',website:'https://assembly.com',links:28,live:22},
    {id:'4',name:'Three Sixty Life',category:'Wellness',website:'https://threesixtylife.com',links:19,live:15},
    {id:'5',name:'Hues Studio',category:'Fashion',website:'https://huesstudio.com',links:24,live:20},
    {id:'6',name:'JJ Valaya',category:'Luxury Fashion',website:'https://jjvalaya.com',links:16,live:13}
  ],
  bots:{ directory:'running',rss:'running',profile:'running',article:'running',microblog:'idle',web2:'idle',guestpost:'idle',pptpdf:'idle',image:'idle',classified:'idle',pressrelease:'idle' },
  botStats:{ directory:8,rss:5,profile:3,article:2 },
  links:[
    {client:'Per4mance Guru',site:'Brownbook',type:'DoFollow',status:'Live',date:'Jul 7',url:'https://brownbook.net/per4mance-guru',screenshot:''},
    {client:'Mackly',site:'HubPages',type:'DoFollow',status:'Live',date:'Jul 7',url:'https://hubpages.com/mackly',screenshot:''},
    {client:'Assembly Travel',site:'Tumblr',type:'NoFollow',status:'Live',date:'Jul 7',url:'https://tumblr.com/assembly-travel',screenshot:''},
    {client:'Per4mance Guru',site:'AboutMe',type:'DoFollow',status:'Pending',date:'Jul 7',url:'',screenshot:''},
    {client:'Hues Studio',site:'Medium',type:'DoFollow',status:'Live',date:'Jul 6',url:'https://medium.com/@huesstudio',screenshot:''},
    {client:'Three Sixty Life',site:'IssueWire',type:'NoFollow',status:'Failed',date:'Jul 6',url:'',screenshot:''},
    {client:'Mackly',site:'Feedage',type:'DoFollow',status:'Live',date:'Jul 6',url:'https://feedage.com/mackly',screenshot:''},
    {client:'JJ Valaya',site:'Behance',type:'NoFollow',status:'Pending',date:'Jul 6',url:'',screenshot:''}
  ],
  tasks:[
    {client:'Per4mance Guru',bot:'profile',site:'AboutMe',status:'Running',url:'',screenshot:''},
    {client:'Mackly',bot:'directory',site:'Cylex',status:'Pending',url:'',screenshot:''},
    {client:'Assembly Travel',bot:'article',site:'EzineArticles',status:'Pending',url:'',screenshot:''},
    {client:'Hues Studio',bot:'rss',site:'FeedShark',status:'Completed',url:'https://feedshark.brainbliss.com/huesstudio',screenshot:''}
  ],
  attention:[
    {client:'Per4mance Guru',site:'AboutMe',issue:'Waiting on email confirmation'},
    {client:'JJ Valaya',site:'Crunchbase',issue:'CAPTCHA needs a manual solve'}
  ]
};

// ============ data ============
async function api(path){
  try{ const r=await fetch(API_BASE+path,{headers:{'Accept':'application/json'}}); if(!r.ok) throw 0; return await r.json(); }
  catch(e){ return null; }
}
let STATE={clients:[],links:[],tasks:[],bots:{},botStats:{},stats:{},attention:[]};

async function loadAll(){
  const stats=await api('/api/stats');
  if(stats){ LIVE=true; setConn(true);
    STATE.stats=stats;
    STATE.bots={}; STATE.botStats={};
    const bs=stats.botStatus||{};
    if(bs.currentBot) STATE.bots[bs.currentBot]='running';
    const clients=await api('/api/clients'); STATE.clients=Array.isArray(clients)?clients:[];
    const subs=await api('/api/submissions'); STATE.links=Array.isArray(subs)?subs.map(mapSub):[];
    const tasks=await api('/api/tasks'); STATE.tasks=Array.isArray(tasks)?tasks.map(mapTask):[];
    const alerts=await api('/api/alerts/pending'); STATE.attention=Array.isArray(alerts)?alerts.map(a=>({client:a.client||'—',site:a.website||'—',issue:a.issue||'Manual action needed'})):[];
  } else {
    LIVE=false; setConn(false);
    STATE.stats={totalClients:DEMO.clients.length,backlinksToday:DEMO.stats.backlinksToday,runningBots:DEMO.stats.runningBots,pendingTasks:DEMO.stats.pendingTasks,totalLinks:DEMO.stats.totalLinks};
    STATE.clients=DEMO.clients; STATE.links=DEMO.links; STATE.tasks=DEMO.tasks;
    STATE.bots=DEMO.bots; STATE.botStats=DEMO.botStats; STATE.attention=DEMO.attention;
  }
  renderAll();
}
function mapSub(s){
  return{
    client:s.clientName||s.client||'—',
    site:s.website||s.site||'—',
    type:s.dofollow===false?'NoFollow':'DoFollow',
    status:s.status||'Live',
    date:fmtDate(s.date||s.createdAt),
    url:s.submissionUrl||s.url||'',
    screenshot:s.screenshotPath||s.screenshot||''
  };
}
function mapTask(t){
  return{
    client:t.clientName||t.client||'—',
    bot:t.botType||t.bot||'—',
    site:t.website||t.site||'—',
    status:t.status||'Pending',
    url:t.submissionUrl||t.url||'',
    screenshot:t.screenshotPath||t.screenshot||''
  };
}
function fmtDate(d){if(!d)return'—';try{return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'})}catch{return'—'}}
function setConn(live){ document.getElementById('conn-status').innerHTML= live ? '<span class="dot live"></span>Live · connected' : '<span class="dot demo"></span>Demo data'; }

// ============ Google Sheet ============
async function sendToSheet(data){
  const url = SHEET_URL || localStorage.getItem('p4g_sheet_url');
  if(!url) return;
  try{
    await fetch(url, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
  }catch(e){}
}
async function exportToSheet(){
  const url = SHEET_URL || localStorage.getItem('p4g_sheet_url');
  if(!url){ toast('Sheet URL set nahi hai — Settings mein jao','err'); go('settings'); return; }
  toast('Sheet sync ho raha hai…','info');
  let sent=0;
  for(const l of STATE.links){
    await sendToSheet({date:l.date,client:l.client,site:l.site,bot:'—',url:l.url||'',status:l.status});
    sent++;
  }
  toast(sent+' backlinks sheet mein sync ho gaye ✅','ok');
}
async function testSheet(){
  const url=document.getElementById('sheetWebhookInput').value.trim()||SHEET_URL;
  if(!url){toast('Pehle URL paste karo','err');return;}
  await sendToSheet({date:new Date().toISOString().slice(0,10),client:'TEST',site:'Per4mance Guru',bot:'test',url:'https://per4mance.guru',status:'Test'});
  toast('Test entry bheji — Sheet check karo ✅','ok');
}

// ============ render ============
function renderAll(){ renderStats(); renderFleet(); renderAttention(); renderRecent(); renderClients(); renderLinks(); renderTasks(); renderSites(); renderBadges(); }

function renderBadges(){
  document.getElementById('nb-clients').textContent=STATE.clients.length;
  document.getElementById('nb-links').textContent=STATE.stats.totalLinks||STATE.links.length;
  document.getElementById('nb-tasks').textContent=STATE.tasks.filter(t=>t.status!=='Completed').length;
}
function renderStats(){
  const s=STATE.stats;
  const cards=[
    ['Total clients',s.totalClients??STATE.clients.length,'clients','var(--primary)','var(--primary-soft)','M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0'],
    ['Backlinks today',s.backlinksToday??0,'+ today','var(--green)','var(--green-soft)','M9 15l6-6M11 6l1-1a4 4 0 015.6 5.6l-1 1'],
    ['Running bots',s.runningBots??Object.values(STATE.bots).filter(x=>x==='running').length,'of 11 active','var(--cyan)','#E1F3F7','M4 8h16v11H4zM12 8V4'],
    ['Pending tasks',s.pendingTasks??STATE.tasks.filter(t=>t.status==='Pending').length,'in queue','var(--amber)','var(--amber-soft)','M9 6h11M9 12h11M9 18h11']
  ];
  document.getElementById('statGrid').innerHTML=cards.map((c,i)=>\`
    <div class="stat">
      <div class="stat-top">
        <div class="stat-ico" style="background:\${c[4]};color:\${c[3]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="\${c[5]}"/></svg></div>
        \${i===1?'<span class="stat-trend">▲ live</span>':''}
      </div>
      <div class="stat-val mono" data-count="\${c[1]}">0</div>
      <div class="stat-label">\${c[0]} · <span style="color:var(--faint)">\${c[2]}</span></div>
    </div>\`).join('');
  animateCounts();
}
function animateCounts(){
  document.querySelectorAll('[data-count]').forEach(el=>{
    const target=+el.dataset.count||0; let cur=0; const step=Math.max(1,Math.ceil(target/28));
    const t=setInterval(()=>{cur+=step;if(cur>=target){cur=target;clearInterval(t)}el.textContent=cur},22);
  });
}
function botStatus(id){ return STATE.bots[id]||'idle'; }
function fleetHTML(id,name,ico,color){
  const st=botStatus(id); const cnt=STATE.botStats[id]||0;
  return \`<div class="bot \${st==='running'?'running':''}">
    <div class="bot-ico" style="background:\${color}1a">\${ico}</div>
    <div class="bot-info">
      <div class="bot-name">\${name} Bot</div>
      <div class="bot-meta"><span class="pulse"></span>\${st==='running'?'Working now':'Idle'} · \${cnt} today</div>
    </div>
  </div>\`;
}
function renderFleet(){
  document.getElementById('fleetMini').innerHTML=BOTS.slice(0,6).map(b=>fleetHTML(...b)).join('');
  document.getElementById('fleetFull').innerHTML=BOTS.map(b=>fleetHTML(...b)).join('');
}
function renderAttention(){
  const el=document.getElementById('attentionList');
  if(!STATE.attention.length){
    el.innerHTML=\`<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6L9 17l-5-5"/></svg><h4>All clear</h4><p>No bot is waiting on you right now.</p></div>\`;
    return;
  }
  el.innerHTML=STATE.attention.map((a,i)=>\`
    <div class="attention">
      <div class="att-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></div>
      <div class="att-body">
        <div class="att-title">\${a.site} · \${a.client}</div>
        <div class="att-desc">\${a.issue}</div>
        <div class="att-actions">
          <button class="btn btn-ghost btn-sm" onclick="resolveAtt(\${i},'done')">Mark done</button>
          <button class="btn btn-ghost btn-sm" onclick="resolveAtt(\${i},'skip')">Skip</button>
        </div>
      </div>
    </div>\`).join('');
}
function resolveAtt(i,action){ STATE.attention.splice(i,1); renderAttention(); toast(action==='done'?'Marked done':'Skipped','ok'); }

function statusTag(s){
  const m={Live:'t-green',Completed:'t-green',Running:'t-blue',Pending:'t-amber',Failed:'t-red'};
  return \`<span class="tag \${m[s]||'t-gray'}"><span class="tdot"></span>\${s}</span>\`;
}
function typeTag(t){ return t==='DoFollow'?'<span class="tag t-green"><span class="tdot"></span>DoFollow</span>':'<span class="tag t-gray"><span class="tdot"></span>NoFollow</span>'; }

function renderRecent(){
  const rows=STATE.links.slice(0,6);
  document.getElementById('recentLinks').innerHTML=\`
    <thead><tr><th>Client</th><th>Site</th><th>Type</th><th>Status</th><th>Backlink URL</th><th>Date</th></tr></thead>
    <tbody>\${rows.map(l=>\`<tr>
      <td class="cell-strong">\${l.client}</td>
      <td class="cell-link">\${l.site}</td>
      <td>\${typeTag(l.type)}</td>
      <td>\${statusTag(l.status)}</td>
      <td>\${l.url?'<a href="'+l.url+'" target="_blank" class="cell-link">Open ↗</a>':'<span class="cell-muted">—</span>'}</td>
      <td class="cell-muted">\${l.date}</td>
    </tr>\`).join('')||emptyRow(6)}</tbody>\`;
}
function emptyRow(cols){return \`<tr><td colspan="\${cols}"><div class="empty"><h4>Nothing yet</h4><p>Data will appear here as bots run.</p></div></td></tr>\`;}

function renderClients(){
  const q=(document.getElementById('globalSearch').value||'').toLowerCase();
  const list=STATE.clients.filter(c=>!q||(c.name||'').toLowerCase().includes(q));
  document.getElementById('clientGrid').innerHTML=list.map((c,i)=>{
    const links=c.links??'—',live=c.live??'—';
    const col=AVATAR_COLORS[i%AVATAR_COLORS.length];
    const initials=(c.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
    return \`<div class="client-card">
      <div class="cc-top">
        <div class="cc-avatar" style="background:\${col}">\${initials}</div>
        <div style="min-width:0"><div class="cc-name">\${c.name||'Unnamed'}</div><div class="cc-cat">\${c.category||'—'}</div></div>
      </div>
      <div class="cc-stats">
        <div class="cc-stat"><b>\${links}</b><span>Backlinks</span></div>
        <div class="cc-stat"><b>\${live}</b><span>Live</span></div>
      </div>
      <div class="cc-foot">
        <button class="btn btn-primary btn-sm" style="flex:1" onclick="quickRun('\${c.id||''}','\${(c.name||'').replace(/'/g,'')}')">Run bots</button>
        <button class="btn btn-ghost btn-sm" onclick="toast('Opening \${(c.name||'').replace(/'/g,'')}…','info')">Details</button>
      </div>
    </div>\`;
  }).join('')||\`<div class="empty" style="grid-column:1/-1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/></svg><h4>No clients yet</h4><p>Add your first client to get started.</p></div>\`;
}

let linkFilter='all';
function renderLinks(){
  const rows=STATE.links.filter(l=>linkFilter==='all'||l.status===linkFilter);
  const total=STATE.links.length, live=STATE.links.filter(l=>l.status==='Live'||l.status==='Completed').length,
    dofollow=STATE.links.filter(l=>l.type==='DoFollow').length, pending=STATE.links.filter(l=>l.status==='Pending').length;
  document.getElementById('reportSummary').innerHTML=\`
    <div class="rs"><b class="mono">\${STATE.stats.totalLinks||total}</b><span>Total backlinks</span></div>
    <div class="rs"><b class="mono" style="color:var(--green)">\${live}</b><span>Live & verified</span></div>
    <div class="rs"><b class="mono">\${dofollow}</b><span>DoFollow</span></div>
    <div class="rs"><b class="mono" style="color:var(--amber)">\${pending}</b><span>Pending</span></div>\`;
  document.getElementById('linksTable').innerHTML=\`
    <thead><tr><th>Client</th><th>Site</th><th>Type</th><th>Status</th><th>Backlink URL</th><th>Date</th></tr></thead>
    <tbody>\${rows.map(l=>\`<tr>
      <td class="cell-strong">\${l.client}</td>
      <td class="cell-link">\${l.site}</td>
      <td>\${typeTag(l.type)}</td>
      <td>\${statusTag(l.status)}</td>
      <td>\${l.url?'<a href="'+l.url+'" target="_blank" class="cell-link" style="max-width:200px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom">'+l.url+'</a>':'<span class="cell-muted">—</span>'}</td>
      <td class="cell-muted">\${l.date}</td>
    </tr>\`).join('')||emptyRow(6)}</tbody>\`;
}
function filterLinks(el,f){ document.querySelectorAll('#page-backlinks .chip').forEach(c=>c.classList.remove('active')); el.classList.add('active'); linkFilter=f; renderLinks(); }

function renderTasks(){
  document.getElementById('tasksTable').innerHTML=\`
    <thead><tr><th>Client</th><th>Bot</th><th>Target site</th><th>Status</th><th>Backlink</th><th></th></tr></thead>
    <tbody>\${STATE.tasks.map((t,idx)=>{
      const bot=BOTS.find(b=>b[0]===t.bot);
      return \`<tr>
        <td class="cell-strong">\${t.client}</td>
        <td>\${bot?bot[2]+' '+bot[1]:t.bot}</td>
        <td class="cell-link">\${t.site}</td>
        <td>\${statusTag(t.status)}</td>
        <td>\${t.url?'<a href="'+t.url+'" target="_blank" class="cell-link">Open ↗</a>':'<span class="cell-muted">—</span>'}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="showTaskDetail(\${idx})">View</button></td>
      </tr>\`;}).join('')||emptyRow(6)}</tbody>\`;
}

function renderSites(){
  const SITES={
    directory:['Brownbook','Hotfrog','Cylex','Tupalo','Storeboard','Sulekha','IndiaMART'],
    article:['HubPages','EzineArticles','ArticleBiz','SooperArticles','Medium','Hashnode'],
    rss:['Feedage','FeedShark','Feedebee','RSSmountain'],
    microblog:['Tumblr','Plurk','Diigo','Mastodon'],
    web2:['WordPress','Blogger','Weebly','Site123','Strikingly'],
    guestpost:['Medium','HubPages','Dev.to'],
    pptpdf:['SlideShare','Issuu','Scribd','Calaméo','Yumpu'],
    image:['Flickr','Pinterest','Imgur','500px'],
    classified:['Locanto','ClassifiedAds','Adpost','Khojle'],
    pressrelease:['OpenPR','PRLog','IssueWire','1888PressRelease'],
    profile:['About.me','Gravatar','Behance','Crunchbase','Disqus']
  };
  document.getElementById('sitesWrap').innerHTML=BOTS.map(b=>{
    const sites=SITES[b[0]]||[];
    return \`<div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><div style="display:flex;align-items:center;gap:10px">
        <div class="bot-ico" style="background:\${b[3]}1a">\${b[2]}</div>
        <div><h3>\${b[1]} Bot</h3><div class="sub">\${sites.length} sites in library</div></div>
      </div></div>
      <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:8px">
        \${sites.map(s=>\`<span class="tag t-gray"><span class="tdot"></span>\${s}</span>\`).join('')}
      </div></div>\`;
  }).join('');
}

// ============ task detail modal ============
function showTaskDetail(idx){
  const t = STATE.tasks[idx];
  if(!t) return;
  _currentTaskUrl = t.url || '';
  const urlBtn = document.getElementById('taskOpenLink');
  if(_currentTaskUrl){ urlBtn.style.display='inline-flex'; } else { urlBtn.style.display='none'; }
  const bot = BOTS.find(b=>b[0]===t.bot);
  document.getElementById('taskModalBody').innerHTML = \`
    <div class="detail-row"><div class="detail-label">Client</div><div class="detail-val cell-strong">\${t.client}</div></div>
    <div class="detail-row"><div class="detail-label">Bot</div><div class="detail-val">\${bot?bot[2]+' '+bot[1]+' Bot':t.bot}</div></div>
    <div class="detail-row"><div class="detail-label">Target Site</div><div class="detail-val">\${t.site}</div></div>
    <div class="detail-row"><div class="detail-label">Status</div><div class="detail-val">\${statusTag(t.status)}</div></div>
    <div class="detail-row">
      <div class="detail-label">Backlink URL</div>
      <div class="detail-val">
        \${t.url
          ? '<a href="'+t.url+'" target="_blank" class="detail-url">'+t.url+'</a>'
          : '<span class="no-data">Bot ne abhi URL capture nahi kiya — tab milega jab task complete hoga</span>'
        }
      </div>
    </div>
    <div class="detail-row">
      <div class="detail-label">Screenshot</div>
      <div class="detail-val">
        \${t.screenshot
          ? '<img src="'+t.screenshot+'" class="detail-screenshot" alt="Screenshot"/>'
          : '<span class="no-data">Screenshot pending — bot complete hone ke baad capture karega</span>'
        }
      </div>
    </div>
  \`;
  document.getElementById('taskOverlay').classList.add('show');
}
function closeTaskModal(){ document.getElementById('taskOverlay').classList.remove('show'); _currentTaskUrl=''; }
function openTaskLink(){ if(_currentTaskUrl) window.open(_currentTaskUrl,'_blank'); }
document.getElementById('taskOverlay').addEventListener('click',e=>{ if(e.target.id==='taskOverlay') closeTaskModal(); });

// ============ clear completed tasks ============
async function clearCompleted(){
  if(LIVE){
    try{ await fetch(API_BASE+'/api/tasks/completed/all',{method:'DELETE'}); }catch(e){}
  } else {
    STATE.tasks=STATE.tasks.filter(t=>t.status!=='Completed');
  }
  toast('Completed tasks cleared','ok'); loadOrRender();
}

// ============ navigation ============
const TITLES={
  overview:['Overview','Your backlink fleet at a glance'],
  clients:['Clients','Manage brands and their profiles'],
  bots:['Bot Fleet','11 independent bots, live status'],
  backlinks:['Backlinks','Every link your bots have built'],
  tasks:['Task Queue','What the fleet is working on'],
  sites:['Site Directory','Where each bot can post'],
  settings:['Settings','Connection & preferences']
};
function go(page){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.getElementById('pt-title').textContent=TITLES[page][0];
  document.getElementById('pt-sub').textContent=TITLES[page][1];
  window.scrollTo({top:0,behavior:'smooth'});
}
document.getElementById('nav').addEventListener('click',e=>{const it=e.target.closest('.nav-item');if(it)go(it.dataset.page);});
document.getElementById('globalSearch').addEventListener('input',renderClients);

// ============ client modal ============
function openClientModal(){ document.getElementById('clientOverlay').classList.add('show'); }
function closeClientModal(){ document.getElementById('clientOverlay').classList.remove('show'); clearForm(); }
function clearForm(){ ['name','bizName','website','category','email','phone','city','country','primaryKeyword','targetLocation','shortDesc'].forEach(k=>{const el=document.getElementById('f-'+k);if(el)el.value='';}); document.getElementById('enrichUrl').value=''; }
document.getElementById('clientOverlay').addEventListener('click',e=>{if(e.target.id==='clientOverlay')closeClientModal();});

async function runEnrich(){
  const url=document.getElementById('enrichUrl').value.trim();
  if(!url){toast('Paste a website URL first','err');return;}
  const btn=document.getElementById('enrichBtn'); btn.disabled=true; const orig=btn.innerHTML; btn.innerHTML='⏳ Reading…';
  if(!LIVE){
    setTimeout(()=>{ fill({name:'Per4mance Guru',bizName:'PER4MANCE GURU',website:url,category:'Marketing Agency',email:'hello@per4mance.guru',phone:'+91 98110 96907',city:'Delhi',country:'India',primaryKeyword:'digital marketing agency',targetLocation:'India, UAE, Canada',shortDesc:'AI-first performance marketing agency.'}); btn.disabled=false;btn.innerHTML=orig; toast('Auto-filled (demo)','ok'); },900);
    return;
  }
  try{
    const r=await fetch(API_BASE+'/api/clients/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const d=await r.json();
    if(d&&d.success){ fill(d.info||{}); toast('Auto-filled from website','ok'); }
    else toast('Auto-fill failed: '+((d&&d.error)||'unknown'),'err');
  }catch(e){ toast('Auto-fill error','err'); }
  btn.disabled=false; btn.innerHTML=orig;
}
function fill(info){ Object.keys(info).forEach(k=>{const el=document.getElementById('f-'+k);if(el&&info[k])el.value=info[k];}); }
async function saveClient(){
  const name=document.getElementById('f-name').value.trim();
  if(!name){toast('Client name is required','err');return;}
  const payload={}; ['name','bizName','website','category','email','phone','city','country','primaryKeyword','targetLocation','shortDesc'].forEach(k=>payload[k]=document.getElementById('f-'+k).value.trim());
  if(LIVE){ try{ await fetch(API_BASE+'/api/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); }catch(e){} }
  else { STATE.clients.unshift({id:Date.now()+'',name,category:payload.category,website:payload.website,links:0,live:0}); }
  closeClientModal(); toast('Client saved','ok'); loadOrRender();
}
function loadOrRender(){ if(LIVE) loadAll(); else { renderClients(); renderBadges(); } }

// ============ quick run ============
function quickRun(cid,name){
  if(!cid){ toast('Save the client first','err'); return; }
  var old=document.getElementById('botPicker'); if(old) old.remove();
  var wrap=document.createElement('div'); wrap.id='botPicker';
  wrap.style.cssText='position:fixed;inset:0;background:rgba(23,26,33,.28);backdrop-filter:blur(3px);z-index:150;display:flex;align-items:center;justify-content:center;padding:20px';
  var box=document.createElement('div');
  box.style.cssText='background:#fff;border-radius:16px;box-shadow:0 12px 32px rgba(23,26,33,.18);width:100%;max-width:460px;overflow:hidden';
  var html='<div style="padding:16px 18px;border-bottom:1px solid #EAECF1;font-weight:600;font-size:15px;font-family:Space Grotesk,sans-serif">Run a bot for '+name+'</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:16px">';
  for(var i=0;i<BOTS.length;i++){ var b=BOTS[i];
    html+='<button data-bot="'+b[0]+'" style="display:flex;align-items:center;gap:8px;padding:10px 11px;border:1px solid #EAECF1;border-radius:10px;background:#FBFCFD;cursor:pointer;font-size:13px;font-weight:500;text-align:left;transition:all .15s"><span style="font-size:15px">'+b[2]+'</span>'+b[1]+' Bot</button>';
  }
  html+='</div><div style="padding:12px 16px;border-top:1px solid #EAECF1;text-align:right"><button id="bpCancel" style="padding:8px 14px;border:1px solid #EAECF1;border-radius:8px;background:#fff;font-weight:600;cursor:pointer">Cancel</button></div>';
  box.innerHTML=html; wrap.appendChild(box); document.body.appendChild(wrap);
  wrap.addEventListener('click',function(e){ if(e.target===wrap) wrap.remove(); });
  document.getElementById('bpCancel').addEventListener('click',function(){ wrap.remove(); });
  box.querySelectorAll('button[data-bot]').forEach(function(btn){
    btn.addEventListener('mouseenter',function(){ btn.style.borderColor='#4636E6'; btn.style.background='#EEECFD'; });
    btn.addEventListener('mouseleave',function(){ btn.style.borderColor='#EAECF1'; btn.style.background='#FBFCFD'; });
    btn.addEventListener('click',function(){ startBot(cid, btn.getAttribute('data-bot'), btn); });
  });
}
async function startBot(cid,botType,btn){
  if(btn){ btn.disabled=true; btn.style.opacity=0.5; btn.textContent='Starting…'; }
  try{
    var r=await fetch(API_BASE+'/api/bot/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:cid,botType:botType})});
    var d=await r.json();
    var p=document.getElementById('botPicker'); if(p) p.remove();
    if(d&&d.success){ toast('Queued '+d.tasks+' task(s) — bot pick karega','ok'); if(LIVE) loadAll(); }
    else toast('Could not start: '+((d&&d.error)||'unknown'),'err');
  }catch(e){ toast('Start failed — check connection','err'); }
}

// ============ export ============
function exportCSV(){
  const rows=[['Client','Site','Type','Status','Backlink URL','Date'],...STATE.links.map(l=>[l.client,l.site,l.type,l.status,l.url||'',l.date])];
  const csv=rows.map(r=>r.map(c=>\`"\${(c||'').toString().replace(/"/g,'""')}"\`).join(',')).join('\\n');
  const blob=new Blob([csv],{type:'text/csv'}); const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='p4g-backlinks-\${new Date().toISOString().slice(0,10)}.csv'; a.click();
  toast('Report exported','ok');
}

// ============ settings ============
function saveSettings(){
  API_BASE=document.getElementById('apiBaseInput').value.trim()||API_BASE;
  const sheetUrl=document.getElementById('sheetWebhookInput').value.trim();
  if(sheetUrl){ SHEET_URL=sheetUrl; localStorage.setItem('p4g_sheet_url',sheetUrl); }
  toast('Settings saved — reconnecting…','info'); loadAll();
}

// ============ toast ============
function toast(msg,type){
  const t=document.createElement('div'); t.className='toast '+(type||'');
  const ico=type==='ok'?'<path d="M20 6L9 17l-5-5"/>':type==='err'?'<path d="M18 6L6 18M6 6l12 12"/>':'<path d="M12 8v4M12 16h.01"/>';
  t.innerHTML=\`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">\${ico}</svg>\${msg}\`;
  document.getElementById('toastWrap').appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(30px)';t.style.transition='all .3s';setTimeout(()=>t.remove(),300)},2600);
}

// ============ boot ============
document.getElementById('apiBaseInput').value=API_BASE;
// Restore saved sheet URL
if(SHEET_URL) document.getElementById('sheetWebhookInput').value=SHEET_URL;
loadAll();
setInterval(()=>{ if(LIVE) loadAll(); },15000);
</script>
</body>
</html>`;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n\x1b[35m' + '═'.repeat(55) + '\x1b[0m');
  console.log('\x1b[35m  P4G SEO AUTOMATION PLATFORM v2.2 — READY\x1b[0m');
  console.log(`\x1b[36m  http://localhost:${PORT}\x1b[0m`);
  console.log('\x1b[32m  ✅ All features active!\x1b[0m');
  console.log('\x1b[35m' + '═'.repeat(55) + '\x1b[0m\n');
});

module.exports = { app };
