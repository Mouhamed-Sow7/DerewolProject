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
  "mp pdf",
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

async function checkViaPowerShell(printerName) {
  const safe = printerName ? printerName.replace(/'/g, "''") : null;
  const cmd = printerName
    ? `Get-Printer -Name '${safe}' | Select-Object Name,PrinterStatus,WorkOffline | ConvertTo-Json`
    : `Get-Printer | Where-Object {$_.IsDefault -eq $true} | Select-Object Name,PrinterStatus,WorkOffline | ConvertTo-Json`;

  const { stdout, stderr } = await runPowerShell(cmd);

  if (stderr) {
    console.warn(`${LOG_PREFIX} Get-Printer stderr :`, stderr);
  }

  if (!stdout || stdout === "null") {
    throw new Error(
      `Get-Printer: no result for ${printerName ?? "default printer"}`,
    );
  }

  let printerData;
  try {
    printerData = JSON.parse(stdout);
  } catch (parseErr) {
    console.error(
      `${LOG_PREFIX} Get-Printer JSON parse échoué :`,
      parseErr.message,
      "| stdout :",
      stdout,
    );
    throw new Error("Get-Printer JSON parse failed");
  }

  const data = Array.isArray(printerData) ? printerData[0] : printerData;
  const name = data?.Name ?? null;
  const status = Number(data?.PrinterStatus ?? -1);
  const workOffline = data?.WorkOffline === true;

  if (!data || !name) {
    throw new Error(
      `Get-Printer: no result for ${printerName ?? "default printer"}`,
    );
  }

  let dotState;
  let online;

  if (workOffline) {
    dotState = "offline";
    online = false;
  } else if (status === 0) {
    dotState = "online";
    online = true;
  } else if (status === -1) {
    dotState = "offline";
    online = false;
  } else {
    dotState = "warning";
    online = false;
  }

  console.log(
    `${LOG_PREFIX} Get-Printer → Name="${name}" Status=${status} WorkOffline=${workOffline} → dotState=${dotState}`,
  );

  return {
    online,
    status,
    name,
    method: "get-printer",
    dotState,
  };
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
    return {
      online: true,
      status: 3,
      name: printerName,
      method: "virtual",
      dotState: "online",
    };
  }

  try {
    const result = await checkViaPowerShell(printerName);
    return result;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Get-Printer échoué → ${err.message}`);
    return {
      online: false,
      status: -1,
      name: printerName,
      method: "error",
      error: err.message,
      dotState: "offline",
    };
  }
}

async function debugListPrinters() {
  return await listPrinterNames();
}

module.exports = { checkPrinterStatus, debugListPrinters };
