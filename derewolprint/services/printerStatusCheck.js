/**
 * printerStatusCheck.js — Derewol
 * Vérifie l'état hardware de l'imprimante via WMI PowerShell
 * Fallback : Get-Printer si WMI échoue
 */

const { exec } = require("child_process");

const POWERSHELL_TIMEOUT_MS = 6000;
const LOG_PREFIX = "[PrinterStatus]";

// Imprimantes virtuelles — toujours considérées online, pas de check WMI
const VIRTUAL_PRINTERS = [
  "mp-pdf",
  "microsoft print to pdf",
  "onenote",
  "anydesk printer",
  "fax",
  "xps document writer",
];

function isVirtualPrinter(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return VIRTUAL_PRINTERS.some((v) => lower.includes(v));
}

function runPowerShell(command, timeoutMs = POWERSHELL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const proc = exec(
      `powershell -NoProfile -NonInteractive -Command "${command}"`,
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        }
      },
    );
    setTimeout(() => {
      try {
        proc.kill();
      } catch (_) {}
    }, timeoutMs + 500);
  });
}

async function listPrinterNames() {
  try {
    const { stdout } = await runPowerShell(
      "Get-WmiObject Win32_Printer | Select-Object -ExpandProperty Name",
    );
    const names = stdout
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    console.log(`${LOG_PREFIX} Imprimantes détectées WMI :`, names);
    return names;
  } catch (err) {
    console.warn(`${LOG_PREFIX} listPrinterNames WMI échoué :`, err.message);
    return [];
  }
}

async function checkViaWMI(printerName) {
  let cmd;
  let filterDesc;
  if (printerName) {
    const safe = printerName.replace(/'/g, "''");
    filterDesc = `Name='${safe}'`;
    cmd = `Get-WmiObject -Class Win32_Printer -Filter "Name='${safe}'" | Select-Object Name,PrinterStatus,WorkOffline,DetectedErrorState | ConvertTo-Json`;
  } else {
    filterDesc = "Default=True";
    cmd = `Get-WmiObject -Class Win32_Printer -Filter "Default=True" | Select-Object Name,PrinterStatus,WorkOffline,DetectedErrorState | ConvertTo-Json`;
  }

  const { stdout, stderr } = await runPowerShell(cmd);

  if (stderr) {
    console.warn(`${LOG_PREFIX} WMI stderr :`, stderr);
  }

  if (!stdout || stdout === "null") {
    console.warn(
      `${LOG_PREFIX} WMI : aucune imprimante trouvée avec le filtre :`,
      filterDesc,
    );
    return { online: false, status: null, name: null, method: "wmi" };
  }

  let printerData;
  try {
    printerData = JSON.parse(stdout);
  } catch (parseErr) {
    console.error(
      `${LOG_PREFIX} WMI JSON parse échoué :`,
      parseErr.message,
      "| stdout :",
      stdout,
    );
    throw new Error("WMI JSON parse failed");
  }

  const printer = Array.isArray(printerData) ? printerData[0] : printerData;
  const name = printer.Name ?? null;
  const printerStatus = printer.PrinterStatus ?? null;
  const workOffline = printer.WorkOffline ?? false;
  const detectedErrorState = printer.DetectedErrorState ?? null;

  console.log(
    `${LOG_PREFIX} WMI résultat → Name="${name}" PrinterStatus=${printerStatus} WorkOffline=${workOffline} DetectedErrorState=${detectedErrorState}`,
  );

  // PrinterStatus WMI — référence complète :
  // 1 = Other        → état ambigu, NE PAS considérer online seul
  // 2 = Unknown      → état inconnu
  // 3 = Idle/Ready   → prêt ✅
  // 4 = Printing     → en impression ✅
  // 5 = Warmup       → chauffe ✅
  // 6 = Stopped      → arrêté ❌
  // 7 = Offline      → hors ligne ❌
  const DEFINITE_ONLINE = new Set([3, 4, 5]);
  const DEFINITE_OFFLINE = new Set([6, 7]);

  let online;
  if (workOffline) {
    online = false;
  } else if (DEFINITE_ONLINE.has(printerStatus)) {
    online = true;
  } else if (DEFINITE_OFFLINE.has(printerStatus)) {
    online = false;
  } else {
    online = detectedErrorState === 0 || detectedErrorState === null;
  }

  console.log(
    `${LOG_PREFIX} Décision → WorkOffline=${workOffline} Status=${printerStatus} DetectedErrorState=${detectedErrorState} → online=${online}`,
  );

  return { online, status: printerStatus, name, method: "wmi" };
}

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

  if (!stdout || stdout === "null") {
    console.warn(`${LOG_PREFIX} Get-Printer : aucun résultat`);
    return { online: false, status: null, name: null, method: "get-printer" };
  }

  let printerData;
  try {
    printerData = JSON.parse(stdout);
  } catch {
    console.error(
      `${LOG_PREFIX} Get-Printer JSON parse échoué | stdout :`,
      stdout,
    );
    return { online: false, status: null, name: null, method: "get-printer" };
  }

  const printer = Array.isArray(printerData) ? printerData[0] : printerData;
  const name = printer.Name ?? null;
  const printerStatus = printer.PrinterStatus ?? null;

  console.log(
    `${LOG_PREFIX} Get-Printer résultat → Name="${name}" PrinterStatus="${printerStatus}"`,
  );

  const online = printerStatus === "Normal" || printerStatus === 0;
  return { online, status: printerStatus, name, method: "get-printer" };
}

async function checkPrinterStatus(printerName = null) {
  console.log(
    `${LOG_PREFIX} checkPrinterStatus() → printerName="${printerName ?? "default"}"`,
  );

  if (printerName && isVirtualPrinter(printerName)) {
    console.log(
      `${LOG_PREFIX} ✅ Imprimante virtuelle détectée → online=true (pas de check WMI)`,
    );
    return { online: true, status: 3, name: printerName, method: "virtual" };
  }

  try {
    const result = await checkViaWMI(printerName);
    console.log(
      `${LOG_PREFIX} ✅ WMI → online=${result.online} name="${result.name}"`,
    );
    return result;
  } catch (wmiErr) {
    console.warn(
      `${LOG_PREFIX} ⚠️ WMI échoué (${wmiErr.message}), fallback Get-Printer…`,
    );
  }

  try {
    const result = await checkViaGetPrinter(printerName);
    console.log(
      `${LOG_PREFIX} ✅ Get-Printer → online=${result.online} name="${result.name}"`,
    );
    return result;
  } catch (gpErr) {
    console.error(`${LOG_PREFIX} ❌ Get-Printer aussi échoué :`, gpErr.message);
  }

  console.error(
    `${LOG_PREFIX} ❌ Toutes les stratégies échouées → online=false`,
  );
  return {
    online: false,
    status: null,
    name: null,
    method: "failed",
    error: "All strategies failed",
  };
}

async function debugListPrinters() {
  return await listPrinterNames();
}

module.exports = { checkPrinterStatus, debugListPrinters };
