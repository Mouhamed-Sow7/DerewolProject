/**
 * printerStatusCheck.js — Derewol
 * Vérifie l'état hardware de l'imprimante via WMI PowerShell
 * Fallback : Get-Printer si WMI échoue
 */

const { exec } = require("child_process");

const POWERSHELL_TIMEOUT_MS = 6000;
const LOG_PREFIX = "[PrinterStatus]";

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
  let filter = "";
  if (printerName) {
    const safe = printerName.replace(/'/g, "''");
    filter = ` WHERE Name='${safe}'`;
  } else {
    filter = " WHERE Default=True";
  }

  const cmd = `Get-WmiObject Win32_Printer${filter} | Select-Object Name,PrinterStatus,WorkOffline | ConvertTo-Json`;
  const { stdout, stderr } = await runPowerShell(cmd);

  if (stderr) {
    console.warn(`${LOG_PREFIX} WMI stderr :`, stderr);
  }

  if (!stdout || stdout === "null") {
    console.warn(
      `${LOG_PREFIX} WMI : aucune imprimante trouvée avec le filtre :`,
      filter,
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

  console.log(
    `${LOG_PREFIX} WMI résultat → Name="${name}" PrinterStatus=${printerStatus} WorkOffline=${workOffline}`,
  );

  const statusOk =
    printerStatus !== null && printerStatus >= 3 && printerStatus <= 5;
  const online = statusOk && !workOffline;

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
