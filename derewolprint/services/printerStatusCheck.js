const { execSync } = require("child_process");
const { dialog } = require("electron");

function checkPrinterStatus(printerName) {
  const cleanName = typeof printerName === "string" ? printerName.trim() : "";
  if (!cleanName) {
    return {
      online: false,
      reason: "Aucune imprimante sélectionnée",
    };
  }

  try {
    // Vérifier si l'imprimante existe et son état WorkOffline
    const workOfflineCmd = `powershell -command "Get-WmiObject Win32_Printer | Where-Object { $_.Name -eq '${cleanName}' } | Select-Object -ExpandProperty WorkOffline"`;
    const workOfflineResult = execSync(workOfflineCmd, { timeout: 3000 })
      .toString()
      .trim();

    // Obtenir les détails complets du statut
    const statusCmd = `powershell -command "Get-WmiObject Win32_Printer | Where-Object { $_.Name -eq '${cleanName}' } | Select-Object PrinterStatus, DetectedErrorState, WorkOffline | ConvertTo-Json"`;
    const statusRaw = execSync(statusCmd, { timeout: 3000 }).toString().trim();

    if (!statusRaw) {
      return { online: false, reason: "Imprimante introuvable" };
    }

    const status = JSON.parse(statusRaw);

    if (status.WorkOffline === true) {
      return { online: false, reason: "Imprimante hors ligne" };
    }

    if (status.PrinterStatus === 3) {
      return { online: false, reason: "Imprimante en erreur" };
    }

    if (status.DetectedErrorState !== 0) {
      return { online: false, reason: "Imprimante en erreur" };
    }

    return { online: true, reason: "OK" };
  } catch (e) {
    console.warn("[printerStatusCheck] Erreur WMI:", e.message);
    return { online: false, reason: "Impossible de vérifier l'imprimante" };
  }
}

function guardPrint(printerName, printCallback) {
  const status = checkPrinterStatus(printerName);
  if (!status.online) {
    try {
      dialog.showErrorBox("Impression bloquée", status.reason);
    } catch (err) {
      console.warn(
        "[printerStatusCheck] Impossible d'afficher le message d'erreur :",
        err.message,
      );
    }
    return status;
  }

  try {
    return printCallback();
  } catch (err) {
    const errorMessage = err?.message || "Erreur pendant l'impression";
    try {
      dialog.showErrorBox("Erreur d'impression", errorMessage);
    } catch {
      // ignore dialog failure
    }
    return { online: false, reason: errorMessage };
  }
}

module.exports = {
  checkPrinterStatus,
  guardPrint,
};
