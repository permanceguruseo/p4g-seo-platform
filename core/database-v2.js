// DATABASE v2 — Added missing fields
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Screenshots dir
const SS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

function loadDB(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { }
  return [];
}

function saveDB(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function nowIST() { return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }); }

// CLIENTS — with logo/banner upload paths
const clients = {
  getAll:  () => loadDB('clients'),
  getById: id => loadDB('clients').find(c => c.id === id),
  add: data => {
    const all = loadDB('clients');
    const c   = { id: uid(), createdAt: nowIST(), status: 'active', logo: '', banner: '', ...data };
    all.push(c);
    saveDB('clients', all);
    return c;
  },
  update: (id, data) => {
    const all = loadDB('clients');
    const idx = all.findIndex(c => c.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data, updatedAt: nowIST() };
    saveDB('clients', all);
    return all[idx];
  },
  delete: id => { saveDB('clients', loadDB('clients').filter(c => c.id !== id)); return true; },
  duplicate: id => {
    const o = loadDB('clients').find(c => c.id === id);
    if (!o) return null;
    return clients.add({ ...o, id: undefined, name: o.name + ' (Copy)', createdAt: undefined });
  },
};

// DIRECTORIES — with lastRun, profileUrl, status per client
const directories = {
  getAll:    () => loadDB('directories'),
  getActive: () => loadDB('directories').filter(d => d.active !== false),
  getById:   id => loadDB('directories').find(d => d.id === id),
  add: data => {
    const all = loadDB('directories');
    const d   = { id: uid(), createdAt: nowIST(), active: true, lastRun: null, clientStatuses: {}, ...data };
    all.push(d);
    saveDB('directories', all);
    return d;
  },
  update: (id, data) => {
    const all = loadDB('directories');
    const idx = all.findIndex(d => d.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data, updatedAt: nowIST() };
    saveDB('directories', all);
    return all[idx];
  },
  updateLastRun: id => {
    const all = loadDB('directories');
    const idx = all.findIndex(d => d.id === id);
    if (idx !== -1) { all[idx].lastRun = nowIST(); saveDB('directories', all); }
  },
  delete: id => { saveDB('directories', loadDB('directories').filter(d => d.id !== id)); return true; },
};

// PROFILES — extended list
const profiles = {
  getAll:    () => loadDB('profiles'),
  getActive: () => loadDB('profiles').filter(p => p.active !== false),
  add: data => {
    const all = loadDB('profiles');
    const p   = { id: uid(), createdAt: nowIST(), active: true, profileUrl: '', status: 'Pending', ...data };
    all.push(p);
    saveDB('profiles', all);
    return p;
  },
  update: (id, data) => {
    const all = loadDB('profiles');
    const idx = all.findIndex(p => p.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data };
    saveDB('profiles', all);
    return all[idx];
  },
  delete: id => { saveDB('profiles', loadDB('profiles').filter(p => p.id !== id)); return true; },
};

// BLOGS — with PA, Spam Score
const blogs = {
  getAll:    () => loadDB('blogs'),
  getActive: () => loadDB('blogs').filter(b => b.active !== false),
  add: data => {
    const all = loadDB('blogs');
    const b   = { id: uid(), createdAt: nowIST(), active: true, da: 0, pa: 0, spamScore: 0, submissionUrl: '', ...data };
    all.push(b);
    saveDB('blogs', all);
    return b;
  },
  update: (id, data) => {
    const all = loadDB('blogs');
    const idx = all.findIndex(b => b.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data };
    saveDB('blogs', all);
    return all[idx];
  },
  delete: id => { saveDB('blogs', loadDB('blogs').filter(b => b.id !== id)); return true; },
};

// TASKS
const tasks = {
  getAll:     () => loadDB('tasks'),
  getPending: () => loadDB('tasks').filter(t => t.status === 'Pending'),
  getRunning: () => loadDB('tasks').filter(t => t.status === 'Running'),
  add: data => {
    const all  = loadDB('tasks');
    const task = { id: uid(), createdAt: nowIST(), status: 'Pending', startedAt: null, completedAt: null, notes: '', ...data };
    all.push(task);
    saveDB('tasks', all);
    return task;
  },
  update: (id, data) => {
    const all = loadDB('tasks');
    const idx = all.findIndex(t => t.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data, updatedAt: nowIST() };
    saveDB('tasks', all);
    return all[idx];
  },
  delete: id => { saveDB('tasks', loadDB('tasks').filter(t => t.id !== id)); return true; },
  clearCompleted: () => { saveDB('tasks', loadDB('tasks').filter(t => t.status !== 'Completed')); return true; },
};

// SUBMISSIONS — with screenshot, submissionUrl
const submissions = {
  getAll:     () => loadDB('submissions'),
  getByClient: id => loadDB('submissions').filter(s => s.clientId === id),
  getToday:   () => {
    const today = new Date().toLocaleDateString('en-IN');
    return loadDB('submissions').filter(s => (s.date || '').startsWith(today));
  },
  add: data => {
    const all = loadDB('submissions');
    const s   = { id: uid(), date: nowIST(), status: 'Completed', profileUrl: '', submissionUrl: '', screenshotPath: '', issue: '', notes: '', ...data };
    all.unshift(s);
    saveDB('submissions', all);
    return s;
  },
  update: (id, data) => {
    const all = loadDB('submissions');
    const idx = all.findIndex(s => s.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data };
    saveDB('submissions', all);
    return all[idx];
  },
};

// ALERTS
const alerts = {
  getAll:     () => loadDB('alerts'),
  getPending: () => loadDB('alerts').filter(a => a.status === 'pending'),
  add: data => {
    const all   = loadDB('alerts');
    const alert = { id: uid(), createdAt: nowIST(), status: 'pending', action: null, ...data };
    all.unshift(alert);
    saveDB('alerts', all);
    return alert;
  },
  resolve: (id, action) => {
    const all = loadDB('alerts');
    const idx = all.findIndex(a => a.id === id);
    if (idx === -1) return null;
    all[idx].status = 'resolved'; all[idx].action = action; all[idx].resolvedAt = nowIST();
    saveDB('alerts', all);
    return all[idx];
  },
};

// STATS
function getStats() {
  const allClients = clients.getAll();
  const allTasks   = tasks.getAll();
  const todaySubs  = submissions.getToday();
  const allDirs    = directories.getAll();
  const pendAlerts = alerts.getPending();
  return {
    totalClients:      allClients.length,
    activeClients:     allClients.filter(c => c.status === 'active').length,
    totalBots:         7,
    runningBots:       allTasks.filter(t => t.status === 'Running').length,
    pendingTasks:      allTasks.filter(t => t.status === 'Pending').length,
    runningTasks:      allTasks.filter(t => t.status === 'Running').length,
    completedTasks:    allTasks.filter(t => t.status === 'Completed').length,
    failedTasks:       allTasks.filter(t => t.status === 'Failed').length,
    pendingAlerts:     pendAlerts.length,
    todayBacklinks:    todaySubs.length,
    todayDirectories:  todaySubs.filter(s => s.botType === 'directory').length,
    todayProfiles:     todaySubs.filter(s => s.botType === 'profile').length,
    todayBlogs:        todaySubs.filter(s => s.botType === 'blog').length,
    todayGuestPosts:   todaySubs.filter(s => s.botType === 'guest').length,
    enabledDirs:       allDirs.filter(d => d.active).length,
    totalDirs:         allDirs.length,
  };
}

// SEED DEFAULT DATA
function seedDefaultData() {
  if (directories.getAll().length === 0) {
    [
      { name:'TradeIndia',   url:'https://tradeindia.com',   signupUrl:'https://www.tradeindia.com/add-listing/',  da:58, requiresCaptcha:false, requiresEmailOTP:true,  category:'B2B' },
      { name:'Sulekha',      url:'https://sulekha.com',      signupUrl:'https://business.sulekha.com/register',   da:62, requiresCaptcha:true,  requiresEmailOTP:true,  category:'Local' },
      { name:'Bizcommunity', url:'https://bizcommunity.com', signupUrl:'https://www.bizcommunity.com/Register/',  da:55, requiresCaptcha:false, requiresEmailOTP:true,  category:'Business' },
      { name:'Storeboard',   url:'https://storeboard.com',   signupUrl:'https://www.storeboard.com/register',     da:45, requiresCaptcha:false, requiresEmailOTP:false, category:'Business' },
      { name:'eLocal',       url:'https://elocal.com',       signupUrl:'https://www.elocal.com/add-business',     da:42, requiresCaptcha:false, requiresEmailOTP:false, category:'Local' },
      { name:'Spoke',        url:'https://spoke.com',        signupUrl:'https://www.spoke.com/register',          da:50, requiresCaptcha:false, requiresEmailOTP:true,  category:'Business' },
      { name:'Brownbook',    url:'https://brownbook.net',    signupUrl:'https://www.brownbook.net/add-business/', da:42, requiresCaptcha:true,  requiresEmailOTP:true,  category:'Business' },
    ].forEach(d => directories.add(d));
    console.log('✅ Directories seeded.');
  }

  if (profiles.getAll().length === 0) {
    [
      { name:'Medium',       signupUrl:'https://medium.com/m/signin',              da:96, requirements:'Google login' },
      { name:'Behance',      signupUrl:'https://www.behance.net/signup',           da:92, requirements:'Adobe account' },
      { name:'GitHub',       signupUrl:'https://github.com/signup',                da:98, requirements:'Email' },
      { name:'Vimeo',        signupUrl:'https://vimeo.com/join',                   da:96, requirements:'Email' },
      { name:'Issuu',        signupUrl:'https://issuu.com/signup',                 da:94, requirements:'Email' },
      { name:'Scribd',       signupUrl:'https://www.scribd.com/signup',            da:95, requirements:'Email' },
      { name:'Wakelet',      signupUrl:'https://wakelet.com/signup',               da:72, requirements:'Email' },
      { name:'Tumblr',       signupUrl:'https://www.tumblr.com/register',          da:77, requirements:'Email' },
      { name:'About.me',     signupUrl:'https://about.me/signup',                  da:72, requirements:'Email' },
      { name:'Gravatar',     signupUrl:'https://en.gravatar.com/connect/',         da:95, requirements:'WordPress account' },
      { name:'Pinterest',    signupUrl:'https://www.pinterest.com/join/',          da:95, requirements:'Email' },
      { name:'Flickr',       signupUrl:'https://identity.flickr.com/sign-up',     da:96, requirements:'Yahoo account' },
      { name:'Dribbble',     signupUrl:'https://dribbble.com/signup',              da:92, requirements:'Invite required' },
    ].forEach(p => profiles.add(p));
    console.log('✅ Profiles seeded (13).');
  }

  if (blogs.getAll().length === 0) {
    [
      { name:'WordPress.com', da:93, pa:78, spamScore:1,  signupUrl:'https://wordpress.com/start', submissionUrl:'https://wordpress.com/post/new' },
      { name:'Blogger',       da:94, pa:80, spamScore:1,  signupUrl:'https://www.blogger.com',     submissionUrl:'https://www.blogger.com/blog/post/create' },
      { name:'Substack',      da:92, pa:75, spamScore:2,  signupUrl:'https://substack.com',        submissionUrl:'https://substack.com/publish/post/new' },
      { name:'Wattpad',       da:92, pa:72, spamScore:3,  signupUrl:'https://www.wattpad.com',     submissionUrl:'https://www.wattpad.com/create/story' },
      { name:'HubPages',      da:88, pa:68, spamScore:4,  signupUrl:'https://hubpages.com',        submissionUrl:'https://hubpages.com/edit/new' },
      { name:'Medium',        da:96, pa:82, spamScore:1,  signupUrl:'https://medium.com',          submissionUrl:'https://medium.com/new-story' },
      { name:'Tumblr',        da:77, pa:65, spamScore:5,  signupUrl:'https://tumblr.com',          submissionUrl:'https://www.tumblr.com/new/text' },
    ].forEach(b => blogs.add(b));
    console.log('✅ Blogs seeded (7).');
  }
}

module.exports = { clients, directories, profiles, blogs, tasks, submissions, alerts, getStats, seedDefaultData, uid, nowIST, SS_DIR };
