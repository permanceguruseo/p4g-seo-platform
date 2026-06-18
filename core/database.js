// ─────────────────────────────────────────────────────────────────────────────
// DATABASE SERVICE — JSON Files
// All data stored in /data/ folder as JSON
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Generic JSON DB ──────────────────────────────────────────────────────────
function loadDB(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* ignore */ }
  return [];
}

function saveDB(name, data) {
  const file = path.join(DATA_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ─── CLIENTS ──────────────────────────────────────────────────────────────────
const clients = {
  getAll:    ()     => loadDB('clients'),
  getById:   (id)   => loadDB('clients').find(c => c.id === id),
  add:       (data) => {
    const all    = loadDB('clients');
    const client = { id: uid(), createdAt: nowIST(), status: 'active', ...data };
    all.push(client);
    saveDB('clients', all);
    return client;
  },
  update: (id, data) => {
    const all = loadDB('clients');
    const idx = all.findIndex(c => c.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data, updatedAt: nowIST() };
    saveDB('clients', all);
    return all[idx];
  },
  delete: (id) => {
    const all = loadDB('clients').filter(c => c.id !== id);
    saveDB('clients', all);
    return true;
  },
  duplicate: (id) => {
    const original = loadDB('clients').find(c => c.id === id);
    if (!original) return null;
    return clients.add({ ...original, id: undefined, name: original.name + ' (Copy)', createdAt: undefined });
  },
};

// ─── DIRECTORIES ──────────────────────────────────────────────────────────────
const directories = {
  getAll:    ()     => loadDB('directories'),
  getActive: ()     => loadDB('directories').filter(d => d.active !== false),
  getById:   (id)   => loadDB('directories').find(d => d.id === id),
  add: (data) => {
    const all = loadDB('directories');
    const dir = { id: uid(), createdAt: nowIST(), active: true, ...data };
    all.push(dir);
    saveDB('directories', all);
    return dir;
  },
  update: (id, data) => {
    const all = loadDB('directories');
    const idx = all.findIndex(d => d.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data, updatedAt: nowIST() };
    saveDB('directories', all);
    return all[idx];
  },
  delete: (id) => {
    saveDB('directories', loadDB('directories').filter(d => d.id !== id));
    return true;
  },
};

// ─── PROFILES ─────────────────────────────────────────────────────────────────
const profiles = {
  getAll:    ()     => loadDB('profiles'),
  getActive: ()     => loadDB('profiles').filter(p => p.active !== false),
  add: (data) => {
    const all     = loadDB('profiles');
    const profile = { id: uid(), createdAt: nowIST(), active: true, ...data };
    all.push(profile);
    saveDB('profiles', all);
    return profile;
  },
  update: (id, data) => {
    const all = loadDB('profiles');
    const idx = all.findIndex(p => p.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data };
    saveDB('profiles', all);
    return all[idx];
  },
  delete: (id) => {
    saveDB('profiles', loadDB('profiles').filter(p => p.id !== id));
    return true;
  },
};

// ─── BLOGS ────────────────────────────────────────────────────────────────────
const blogs = {
  getAll:    ()   => loadDB('blogs'),
  getActive: ()   => loadDB('blogs').filter(b => b.active !== false),
  add: (data) => {
    const all  = loadDB('blogs');
    const blog = { id: uid(), createdAt: nowIST(), active: true, ...data };
    all.push(blog);
    saveDB('blogs', all);
    return blog;
  },
  update: (id, data) => {
    const all = loadDB('blogs');
    const idx = all.findIndex(b => b.id === id);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], ...data };
    saveDB('blogs', all);
    return all[idx];
  },
  delete: (id) => {
    saveDB('blogs', loadDB('blogs').filter(b => b.id !== id));
    return true;
  },
};

// ─── TASK QUEUE ───────────────────────────────────────────────────────────────
const tasks = {
  getAll:     ()       => loadDB('tasks'),
  getPending: ()       => loadDB('tasks').filter(t => t.status === 'Pending'),
  getRunning: ()       => loadDB('tasks').filter(t => t.status === 'Running'),
  getByClient:(clientId) => loadDB('tasks').filter(t => t.clientId === clientId),
  add: (data) => {
    const all  = loadDB('tasks');
    const task = {
      id:          uid(),
      createdAt:   nowIST(),
      status:      'Pending',
      startedAt:   null,
      completedAt: null,
      notes:       '',
      ...data,
    };
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
  delete: (id) => {
    saveDB('tasks', loadDB('tasks').filter(t => t.id !== id));
    return true;
  },
  clearCompleted: () => {
    saveDB('tasks', loadDB('tasks').filter(t => t.status !== 'Completed'));
    return true;
  },
};

// ─── SUBMISSION TRACKER ───────────────────────────────────────────────────────
const submissions = {
  getAll:     ()         => loadDB('submissions'),
  getByClient:(clientId) => loadDB('submissions').filter(s => s.clientId === clientId),
  getToday:   ()         => {
    const today = new Date().toLocaleDateString('en-IN');
    return loadDB('submissions').filter(s => s.date?.startsWith(today));
  },
  add: (data) => {
    const all = loadDB('submissions');
    const sub = {
      id:         uid(),
      date:       nowIST(),
      status:     'Completed',
      screenshot: '',
      notes:      '',
      ...data,
    };
    all.unshift(sub);
    saveDB('submissions', all);
    return sub;
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

// ─── ALERTS ───────────────────────────────────────────────────────────────────
const alerts = {
  getAll:     ()  => loadDB('alerts'),
  getPending: ()  => loadDB('alerts').filter(a => a.status === 'pending'),
  add: (data) => {
    const all   = loadDB('alerts');
    const alert = {
      id:        uid(),
      createdAt: nowIST(),
      status:    'pending',
      action:    null,
      ...data,
    };
    all.unshift(alert);
    saveDB('alerts', all);
    return alert;
  },
  resolve: (id, action) => {
    const all = loadDB('alerts');
    const idx = all.findIndex(a => a.id === id);
    if (idx === -1) return null;
    all[idx].status     = 'resolved';
    all[idx].action     = action;
    all[idx].resolvedAt = nowIST();
    saveDB('alerts', all);
    return all[idx];
  },
};

// ─── STATS ────────────────────────────────────────────────────────────────────
function getStats() {
  const allClients     = clients.getAll();
  const allTasks       = tasks.getAll();
  const todaySubs      = submissions.getToday();
  const pendingAlerts  = alerts.getPending();

  return {
    totalClients:      allClients.length,
    activeClients:     allClients.filter(c => c.status === 'active').length,
    totalTasks:        allTasks.length,
    pendingTasks:      allTasks.filter(t => t.status === 'Pending').length,
    runningTasks:      allTasks.filter(t => t.status === 'Running').length,
    completedTasks:    allTasks.filter(t => t.status === 'Completed').length,
    failedTasks:       allTasks.filter(t => t.status === 'Failed').length,
    pendingAlerts:     pendingAlerts.length,
    todayDirectories:  todaySubs.filter(s => s.botType === 'directory').length,
    todayProfiles:     todaySubs.filter(s => s.botType === 'profile').length,
    todayBlogs:        todaySubs.filter(s => s.botType === 'blog').length,
    todayGuestPosts:   todaySubs.filter(s => s.botType === 'guest').length,
    todayBacklinks:    todaySubs.length,
  };
}

// ─── Seed default data ────────────────────────────────────────────────────────
function seedDefaultData() {
  // Seed directories if empty
  if (directories.getAll().length === 0) {
    const defaultDirs = [
      { name:'TradeIndia',    url:'https://tradeindia.com',    signupUrl:'https://www.tradeindia.com/add-listing/',   da:58, requiresCaptcha:false, requiresEmailOTP:true,  active:true, category:'B2B' },
      { name:'Sulekha',       url:'https://sulekha.com',       signupUrl:'https://business.sulekha.com/register',    da:62, requiresCaptcha:true,  requiresEmailOTP:true,  active:true, category:'Local' },
      { name:'Bizcommunity',  url:'https://bizcommunity.com',  signupUrl:'https://www.bizcommunity.com/Register/',   da:55, requiresCaptcha:false, requiresEmailOTP:true,  active:true, category:'Business' },
      { name:'Storeboard',    url:'https://storeboard.com',    signupUrl:'https://www.storeboard.com/register',      da:45, requiresCaptcha:false, requiresEmailOTP:false, active:true, category:'Business' },
      { name:'eLocal',        url:'https://elocal.com',        signupUrl:'https://www.elocal.com/add-business',      da:42, requiresCaptcha:false, requiresEmailOTP:false, active:true, category:'Local' },
      { name:'Spoke',         url:'https://spoke.com',         signupUrl:'https://www.spoke.com/register',           da:50, requiresCaptcha:false, requiresEmailOTP:true,  active:true, category:'Business' },
      { name:'Brownbook',     url:'https://brownbook.net',     signupUrl:'https://www.brownbook.net/add-business/',  da:42, requiresCaptcha:true,  requiresEmailOTP:true,  active:true, category:'Business' },
    ];
    defaultDirs.forEach(d => directories.add(d));
    console.log('✅ Default directories seeded.');
  }

  // Seed profiles if empty
  if (profiles.getAll().length === 0) {
    const defaultProfiles = [
      { name:'Medium',    signupUrl:'https://medium.com/m/signin',         da:96, active:true },
      { name:'Behance',   signupUrl:'https://www.behance.net/signup',      da:92, active:true },
      { name:'GitHub',    signupUrl:'https://github.com/signup',           da:98, active:true },
      { name:'Tumblr',    signupUrl:'https://www.tumblr.com/register',     da:77, active:true },
      { name:'Pinterest', signupUrl:'https://www.pinterest.com/join/',     da:95, active:true },
      { name:'About.me',  signupUrl:'https://about.me/signup',             da:72, active:true },
      { name:'Gravatar',  signupUrl:'https://en.gravatar.com/connect/',    da:95, active:true },
    ];
    defaultProfiles.forEach(p => profiles.add(p));
    console.log('✅ Default profiles seeded.');
  }

  // Seed blogs if empty
  if (blogs.getAll().length === 0) {
    const defaultBlogs = [
      { name:'WordPress.com', da:93, signupUrl:'https://wordpress.com/start', active:true },
      { name:'Blogger',       da:94, signupUrl:'https://www.blogger.com',     active:true },
      { name:'Substack',      da:92, signupUrl:'https://substack.com',        active:true },
      { name:'Wattpad',       da:92, signupUrl:'https://www.wattpad.com',     active:true },
      { name:'HubPages',      da:88, signupUrl:'https://hubpages.com',        active:true },
    ];
    defaultBlogs.forEach(b => blogs.add(b));
    console.log('✅ Default blogs seeded.');
  }
}

module.exports = {
  clients, directories, profiles, blogs,
  tasks, submissions, alerts,
  getStats, seedDefaultData,
  uid, nowIST,
};
