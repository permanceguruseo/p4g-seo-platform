// ─────────────────────────────────────────────────────────────────────────────
// TASK QUEUE — Bot coordination and manual action handling
// ─────────────────────────────────────────────────────────────────────────────

const { EventEmitter } = require('events');
const db               = require('./database');
const notify           = require('./notification');
const logger           = require('./logger');

const botEvents  = new EventEmitter();
const sseClients = new Set();

let currentStatus = {
  status:     'idle',
  currentBot: null,
  currentJob: null,
  client:     null,
  website:    null,
  progress:   0,
  total:      0,
};

// ─── SSE Broadcast ────────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(msg); } catch { sseClients.delete(res); }
  });
}

function addSSEClient(res) { sseClients.add(res); }
function removeSSEClient(res) { sseClients.delete(res); }

// ─── Status Updates ───────────────────────────────────────────────────────────
function updateStatus(updates) {
  currentStatus = { ...currentStatus, ...updates };
  broadcast({ type: 'STATUS', status: currentStatus });
}

function getStatus() { return currentStatus; }

// ─── Manual Action — pauses bot until user responds ──────────────────────────
async function requireManualAction({ client, website, issue, botType, taskId }) {
  logger.manual(`Manual needed: ${client} → ${website} — ${issue}`);

  // Create alert in DB
  const alert = db.alerts.add({
    client, website, issue, botType, taskId,
    alertId: db.uid(),
  });

  // Update task status
  if (taskId) db.tasks.update(taskId, { status: 'Waiting Manual Action' });

  // Update current status
  updateStatus({ status: 'paused', currentJob: `Waiting: ${issue}` });

  // Broadcast alert to dashboard
  broadcast({ type: 'ALERT', alert });

  // Send push notification to phone
  await notify.sendAlert({
    client,
    website,
    issue,
    alertId: alert.id,
    botType,
  });

  // Wait for user action
  return new Promise(resolve => {
    botEvents.once(`action:${alert.id}`, action => {
      logger.info(`Action received: "${action}" for ${website}`);
      if (taskId) {
        db.tasks.update(taskId, {
          status: action === 'stop' ? 'Failed' : 'Running',
          notes:  `User action: ${action}`,
        });
      }
      updateStatus({ status: action === 'stop' ? 'stopped' : 'running' });
      resolve(action);
    });
  });
}

// ─── Resolve Alert ────────────────────────────────────────────────────────────
function resolveAlert(alertId, action) {
  const alert = db.alerts.resolve(alertId, action);
  if (!alert) return false;

  botEvents.emit(`action:${alertId}`, action);

  if (action === 'stop') {
    updateStatus({ status: 'stopped' });
    botEvents.emit('bot:stop');
  } else if (action === 'done' || action === 'skip') {
    updateStatus({ status: 'running' });
  }

  broadcast({ type: 'ACTION_TAKEN', alertId, action });
  return true;
}

// ─── Add task to queue ────────────────────────────────────────────────────────
function addTask({ clientId, botType, website, websiteId, priority = 5 }) {
  const client = db.clients.getById(clientId);
  if (!client) return null;

  return db.tasks.add({
    clientId,
    clientName: client.name,
    botType,
    website,
    websiteId,
    priority,
    status: 'Pending',
  });
}

// ─── Process next task ────────────────────────────────────────────────────────
function getNextTask() {
  const pending = db.tasks.getPending();
  if (pending.length === 0) return null;
  // Sort by priority
  return pending.sort((a, b) => (b.priority || 5) - (a.priority || 5))[0];
}

module.exports = {
  addSSEClient, removeSSEClient, broadcast,
  updateStatus, getStatus,
  requireManualAction, resolveAlert,
  addTask, getNextTask,
  botEvents,
};
