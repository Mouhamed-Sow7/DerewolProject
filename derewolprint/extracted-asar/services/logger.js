const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), 'DerewolLogs');
const LOG_FILE = path.join(LOG_DIR, `derewol-${new Date().toISOString().slice(0,10)}.log`);

// Crée le dossier logs si inexistant
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

function formatLog(level, action, details = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    action,
    ...details
  }) + '\n';
}

function log(action, details = {}) {
  const line = formatLog('INFO', action, details);
  console.log(`[LOG] ${action}`, details);
  fs.appendFileSync(LOG_FILE, line);
}

function logError(action, error, details = {}) {
  const line = formatLog('ERROR', action, { error: error.message, ...details });
  console.error(`[ERROR] ${action}`, error.message);
  fs.appendFileSync(LOG_FILE, line);
}

module.exports = { log, logError, LOG_FILE };
