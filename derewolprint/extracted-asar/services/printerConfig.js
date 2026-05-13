// services/printerConfig.js
// ⚠️ Ne pas appeler app.getPath() au niveau module
// → utiliser une fonction lazy qui résout le chemin à la demande

const path = require('path');
const fs   = require('fs');

function getConfigPath() {
  // Chargé seulement quand appelé — app est prêt à ce moment
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'derewol-config.json');
}

function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch(e) {
    console.warn('[CONFIG] Erreur lecture :', e.message);
  }
  return null;
}

function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch(e) {
    console.warn('[CONFIG] Erreur écriture :', e.message);
  }
}

function clearConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } catch(e) {}
}

module.exports = { loadConfig, saveConfig, clearConfig };