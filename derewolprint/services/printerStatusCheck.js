const { app, BrowserWindow, dialog } = require("electron");

function normalizePrinterName(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

async function getWebContents() {
  if (!app.isReady()) {
    await app.whenReady();
  }

  const window = BrowserWindow.getAllWindows().find(
    (win) => win && !win.isDestroyed(),
  );
  return window ? window.webContents : null;
}

async function listPrinters() {
  const webContents = await getWebContents();
  if (!webContents || typeof webContents.getPrinters !== "function") {
    return [];
  }
  return webContents.getPrinters();
}

function findPrinter(printerName, printers) {
  const normalizedName = normalizePrinterName(printerName);
  if (!normalizedName || !Array.isArray(printers)) return null;

  return printers.find((printer) => {
    const name = normalizePrinterName(printer.name);
    const displayName = normalizePrinterName(printer.displayName);
    return name === normalizedName || displayName === normalizedName;
  });
}

function formatStatusReason(status) {
  if (status === 0 || status === 1) {
    return { online: true, reason: "" };
  }

  if (status === 3) {
    return { online: false, reason: "Imprimante hors ligne" };
  }

  return { online: false, reason: "Imprimante en erreur" };
}

async function checkPrinterStatus(printerName) {
  const cleanName = typeof printerName === "string" ? printerName.trim() : "";
  if (!cleanName) {
    return {
      online: false,
      reason: "Aucune imprimante sélectionnée",
    };
  }

  const printers = await listPrinters();
  if (!printers.length) {
    return {
      online: false,
      reason: "Impossible de vérifier l'état de l'imprimante",
    };
  }

  const printer = findPrinter(cleanName, printers);
  if (!printer) {
    return {
      online: false,
      reason: "Imprimante introuvable",
    };
  }

  if (typeof printer.status !== "number") {
    return { online: true, reason: "" };
  }

  return formatStatusReason(printer.status);
}

async function guardPrint(printerName, printCallback) {
  const status = await checkPrinterStatus(printerName);
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
    await Promise.resolve(printCallback());
    return { online: true, reason: "" };
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
