// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION SERVICE — Web Push + Siren
// ─────────────────────────────────────────────────────────────────────────────

const webpush = require('web-push');
const fs      = require('fs');
const path    = require('path');
const logger  = require('./logger');

const SUB_FILE     = path.join(__dirname, '..', 'data', 'push-subscriptions.json');
const VAPID_PUBLIC  = 'BCRyBZ3YSr9r8n2rr5KSrUDZvUd2pcFq_F3cRlfzU0pzTCJU3tAbcPxNi6v9c3vpzIo2D5-HBlyhtuhCASQ06BM';
const VAPID_PRIVATE = 'oRYzBeJ2tl8tX70poJemHtejqljcBWcnniddlDzOTdM';

webpush.setVapidDetails('mailto:permanceguruseo@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

function loadSubscriptions() {
  try {
    if (fs.existsSync(SUB_FILE)) return JSON.parse(fs.readFileSync(SUB_FILE, 'utf8'));
  } catch { /* ignore */ }
  return [];
}

function saveSubscriptions(subs) {
  fs.writeFileSync(SUB_FILE, JSON.stringify(subs, null, 2));
}

function addSubscription(sub) {
  const subs = loadSubscriptions();
  if (!subs.find(s => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    saveSubscriptions(subs);
    logger.success('Push subscription saved!');
  }
  return subs.length;
}

async function sendToAll(payload) {
  const subs = loadSubscriptions();
  const dead = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) dead.push(sub.endpoint);
      else logger.warn('Push failed: ' + e.message);
    }
  }

  if (dead.length > 0) {
    saveSubscriptions(subs.filter(s => !dead.includes(s.endpoint)));
  }
}

async function sendAlert({ client, website, issue, alertId, botType }) {
  const payload = {
    title:   '🚨 Manual Action Required',
    body:    `Client: ${client}\nSite: ${website}\nIssue: ${issue}`,
    tag:     alertId,
    alertId, client, website, issue, botType,
    url:     '/?page=alerts',
  };
  await sendToAll(payload);
  logger.manual(`Alert sent: ${client} → ${website} — ${issue}`);
}

module.exports = {
  VAPID_PUBLIC,
  addSubscription,
  sendToAll,
  sendAlert,
  loadSubscriptions,
};
