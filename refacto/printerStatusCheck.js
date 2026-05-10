/**
 * printerStatusCheck.js — Derewol
 * Vérifie l'état hardware de l'imprimante via WMI PowerShell
 * Fallback : Get-Printer si WMI échoue
 */

const { exec } = require('child_process');

// ─── Config ───────────────────────────────────────────────────────────────────
const POWERSHELL_TIMEOUT_MS = 6000;
const WMI_STATUS_READY      = 3;   // PrinterStatus=3 → Idle/Ready
const LOG_PREFIX            = '[PrinterStatus]';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Exécute une commande PowerShell et retourne stdout/stderr
 * @param {string} command
 * @param {number} timeoutMs
 * @returns {Promise<{stdout:string, stderr:string}>}
 */
function runPowerShell(command, timeoutMs = POWERSHELL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = exec(
      `powershell -NoProfile -NonInteractive -Command "${command}"`,
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          // timeout ou crash
          reject(error);
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        }
      }
    );
    // Sécurité : tuer si jamais le timeout ne fire pas
    setTimeout(() => {
      try { proc.kill(); } catch (_) {}
    }, timeoutMs + 500);
  });
}

/**
 * Récupère le premier nom d'imprimante installée sur le système
 * Utile pour debug quand on ne connaît pas le nom exact
 * @returns {Promise<string[]>}
 */
async function listPrinterNames() {
  try {
    const { stdout } = await runPowerShell(
      'Get-WmiObject Win32_Printer | Select-Object -ExpandProperty Name'
    );
    const names = stdout.split('\n').map(n => n.trim()).filter(Boolean);
    console.log(`${LOG_PREFIX} Imprimantes détectées WMI :`, names);
    return names;
  } catch (err) {
    console.warn(`${LOG_PREFIX} listPrinterNames WMI échoué :`, err.message);
    return [];
  }
}

/**
 * Stratégie 1 : WMI Win32_Printer — vrai état hardware
 * PrinterStatus : 3 = Ready, 4 = Printing, 5 = Warmup,
 *                 1 = Other, 2 = Unknown, 6+ = Error
 * @param {string|null} printerName  null = imprimante par défaut
 * @returns {Promise<{online:boolean, status:number|null, name:string|null, method:'wmi'}>}
 */
async function checkViaWMI(printerName) {
  let filter = '';
  if (printerName) {
    // Echapper les guillemets simples dans le nom
    const safe = printerName.replace(/'/g, "''");
    filter = ` WHERE Name='${safe}'`;
  } else {
    filter = ' WHERE Default=True';
  }

  const cmd = `Get-WmiObject Win32_Printer${filter} | Select-Object Name,PrinterStatus,WorkOffline | ConvertTo-Json`;

  const { stdout, stderr } = await runPowerShell(cmd);

  if (stderr) {
    console.warn(`${LOG_PREFIX} WMI stderr :`, stderr);
  }

  if (!stdout || stdout === 'null') {
    console.warn(`${LOG_PREFIX} WMI : aucune imprimante trouvée avec le filtre :`, filter);
    return { online: false, status: null, name: null, method: 'wmi' };
  }

  let printerData;
  try {
    printerData = JSON.parse(stdout);
  } catch (parseErr) {
    console.error(`${LOG_PREFIX} WMI JSON parse échoué :`, parseErr.message, '| stdout :', stdout);
    throw new Error('WMI JSON parse failed');
  }

  // PowerShell peut retourner un objet ou un tableau
  const printer = Array.isArray(printerData) ? printerData[0] : printerData;

  const name          = printer.Name         ?? null;
  const printerStatus = printer.PrinterStatus ?? null;
  const workOffline   = printer.WorkOffline   ?? false;

  console.log(`${LOG_PREFIX} WMI résultat → Name="${name}" PrinterStatus=${printerStatus} WorkOffline=${workOffline}`);

  // En ligne si : status Ready/Printing/Warmup (3,4,5) ET pas en mode hors-ligne
  const statusOk = printerStatus !== null && printerStatus >= 3 && printerStatus <= 5;
  const online   = statusOk && !workOffline;

  return { online, status: printerStatus, name, method: 'wmi' };
}

/**
 * Stratégie 2 : Get-Printer (fallback si WMI indisponible)
 * PrinterStatus : "Normal", "Error", "Offline", etc.
 * @param {string|null} printerName
 * @returns {Promise<{online:boolean, status:string|null, name:string|null, method:'get-printer'}>}
 */
async function checkViaGetPrinter(printerName) {
  let cmd;
  if (printerName) {
    const safe = printerName.replace(/'/g, "''");
    cmd = `Get-Printer -Name '${safe}' | Select-Object Name,PrinterStatus | ConvertTo-Json`;
  } else {
    cmd = `Get-Printer | Where-Object {$_.IsDefault -eq $true} | Select-Object Name,PrinterStatus | ConvertTo-Json`;
  }

  const { stdout, stderr } = await runPowerShell(cmd);

  if (stderr) {
    console.warn(`${LOG_PREFIX} Get-Printer stderr :`, stderr);
  }

  if (!stdout || stdout === 'null') {
    console.warn(`${LOG_PREFIX} Get-Printer : aucun résultat`);
    return { online: false, status: null, name: null, method: 'get-printer' };
  }

  let printerData;
  try {
    printerData = JSON.parse(stdout);
  } catch {
    console.error(`${LOG_PREFIX} Get-Printer JSON parse échoué | stdout :`, stdout);
    return { online: false, status: null, name: null, method: 'get-printer' };
  }

  const printer       = Array.isArray(printerData) ? printerData[0] : printerData;
  const name          = printer.Name          ?? null;
  const printerStatus = printer.PrinterStatus ?? null;

  console.log(`${LOG_PREFIX} Get-Printer résultat → Name="${name}" PrinterStatus="${printerStatus}"`);

  // "Normal" = 0 dans l'enum Get-Printer
  const online = printerStatus === 'Normal' || printerStatus === 0;

  return { online, status: printerStatus, name, method: 'get-printer' };
}

// ─── API publique ──────────────────────────────────────────────────────────────

/**
 * Vérifie l'état de l'imprimante avec fallback automatique
 * @param {string|null} printerName  Nom exact WMI. null = par défaut.
 * @returns {Promise<{online:boolean, status:any, name:string|null, method:string, error?:string}>}
 */
async function checkPrinterStatus(printerName = null) {
  console.log(`${LOG_PREFIX} checkPrinterStatus() → printerName="${printerName ?? 'default'}"`);

  // Stratégie 1 : WMI
  try {
    const result = await checkViaWMI(printerName);
    console.log(`${LOG_PREFIX} ✅ WMI → online=${result.online} name="${result.name}"`);
    return result;
  } catch (wmiErr) {
    console.warn(`${LOG_PREFIX} ⚠️ WMI échoué (${wmiErr.message}), fallback Get-Printer…`);
  }

  // Stratégie 2 : Get-Printer
  try {
    const result = await checkViaGetPrinter(printerName);
    console.log(`${LOG_PREFIX} ✅ Get-Printer → online=${result.online} name="${result.name}"`);
    return result;
  } catch (gpErr) {
    console.error(`${LOG_PREFIX} ❌ Get-Printer aussi échoué :`, gpErr.message);
  }

  // Fallback total : hors ligne pour éviter un faux "vert"
  console.error(`${LOG_PREFIX} ❌ Toutes les stratégies échouées → online=false`);
  return { online: false, status: null, name: null, method: 'failed', error: 'All strategies failed' };
}

/**
 * Helper de debug : liste tous les noms WMI
 * Utile pour trouver le nom exact à passer à checkPrinterStatus()
 */
async function debugListPrinters() {
  const names = await listPrinterNames();
  return names;
}

module.exports = { checkPrinterStatus, debugListPrinters };
