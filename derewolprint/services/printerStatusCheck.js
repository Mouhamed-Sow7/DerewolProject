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
    // Obtenir les détails complets du statut (timeout augmenté à 6 secondes)
    const statusCmd = `powershell -command "Get-WmiObject Win32_Printer | Where-Object { $_.Name -eq '${cleanName}' } | Select-Object PrinterStatus, DetectedErrorState, WorkOffline | ConvertTo-Json"`;
    let statusRaw;
    try {
      statusRaw = execSync(statusCmd, { timeout: 6000 }).toString().trim();
    } catch (cmdErr) {
      console.warn(
        "[printerStatusCheck] Première tentative échouée, fallback...",
      );
      // Fallback: tentative plus simple
      const simpleCmd = `powershell -command "Get-Printer -Name '${cleanName}' -ErrorAction Stop | Select-Object -ExpandProperty PrinterStatus"`;
      try {
        const simpleResult = execSync(simpleCmd, { timeout: 6000 })
          .toString()
          .trim();
        // PrinterStatus: 0=Idle, 1=Processing, 3=Error
        const statusCode = parseInt(simpleResult);
        if (statusCode === 3) {
          return { online: false, reason: "Imprimante en erreur" };
        }
        return { online: true, reason: "OK" };
      } catch {
        throw cmdErr; // Re-throw original error
      }
    }

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
    console.warn("[printerStatusCheck] Erreur vérification:", e.message);
    return { online: false, reason: "Erreur vérification" };
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
