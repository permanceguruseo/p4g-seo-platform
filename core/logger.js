// ─────────────────────────────────────────────────────────────────────────────
// LOGGER SERVICE
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function nowIST() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function writeLog(file, msg) {
  const line = `[${nowIST()}] ${msg}\n`;
  fs.appendFileSync(path.join(LOG_DIR, file), line);
}

const logger = {
  success: (msg) => {
    console.log(`\x1b[32m[OK]\x1b[0m ✅ ${msg}`);
    writeLog('success.log', msg);
  },
  error: (msg) => {
    console.log(`\x1b[31m[ERROR]\x1b[0m ❌ ${msg}`);
    writeLog('failed.log', msg);
  },
  info: (msg) => {
    console.log(`\x1b[36m[INFO]\x1b[0m ℹ️  ${msg}`);
  },
  warn: (msg) => {
    console.log(`\x1b[33m[WARN]\x1b[0m ⚠️  ${msg}`);
    writeLog('failed.log', 'WARN: ' + msg);
  },
  manual: (msg) => {
    console.log(`\x1b[43m\x1b[30m[MANUAL]\x1b[0m 🔔 ${msg}`);
    writeLog('manual-actions.log', msg);
  },
};

module.exports = logger;
