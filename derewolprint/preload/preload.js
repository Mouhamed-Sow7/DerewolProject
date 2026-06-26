const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("derewol", {
  // ── Setup onboarding ──────────────────────────────────────
  checkSlug: (slug) => ipcRenderer.invoke("setup:check-slug", slug),
  registerPrinter: (data) => ipcRenderer.invoke("setup:register", data),
  setupDone: (config) => ipcRenderer.send("setup:done", config),

  // ── App principale ────────────────────────────────────────
  getPrinterConfig: () => ipcRenderer.invoke("printer:config"),
  updatePrinterName: (name) => ipcRenderer.invoke("printer:update-name", name),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // ── Jobs impression ───────────────────────────────────────
  onJobReceived: (callback) =>
    ipcRenderer.on("job:received", (_, jobs) => callback(jobs)),
  confirmPrint: (groupId, printerName, copies, jobCopies) =>
    ipcRenderer.invoke("job:confirm", groupId, printerName, copies, jobCopies),
  rejectJob: (jobId) => ipcRenderer.invoke("job:reject", jobId),
  retryJob: (jobId, printerName) =>
    ipcRenderer.invoke("job:retry", jobId, printerName),

  // ── Utilitaires ───────────────────────────────────────────
  sendLog: (message) => ipcRenderer.invoke("log:write", message),
  setPollingInterval: (intervalMs) =>
    ipcRenderer.invoke("polling:set-interval", intervalMs),
  getPrinters: () => ipcRenderer.invoke("printer:list"),
  getDefaultPrinter: () => ipcRenderer.invoke("printer:default"),
  isDev: () => process.env.NODE_ENV === "development",
  checkPrinterStatus: async (printerName) => {
    try {
      const result = await ipcRenderer.invoke(
        "printer:check-status",
        printerName ?? null,
      );
      if (!result || typeof result.online !== "boolean") {
        return {
          online: false,
          status: null,
          name: null,
          method: "invalid-response",
        };
      }
      return result;
    } catch (err) {
      return {
        online: false,
        status: null,
        name: null,
        method: "ipc-error",
        error: err.message,
      };
    }
  },
  debugListPrinters: () => ipcRenderer.invoke("printer:debug-list"),
  simulatePrinterOffline: () => ipcRenderer.invoke("printer:simulate-offline"),
  getHistory: () => ipcRenderer.invoke("history:get"),
  setPrintOptions: (opts) => ipcRenderer.invoke("print:set-options", opts),
  getPdfPages: (fileId) => ipcRenderer.invoke("pdf:get-pages", fileId),
  getPdfOrientation: (fileId) =>
    ipcRenderer.invoke("pdf:get-orientation", { fileId }),

  // ── Fusion modal ────────────────────────────────────────────
  getFusionPreview: (fileId) =>
    ipcRenderer.invoke("fusion:get-preview", fileId),

  // ── Abonnement ─────────────────────────────────────────────
  subscriptionCheck: () => ipcRenderer.invoke("subscription:check"),
  subscriptionActivate: (code) =>
    ipcRenderer.invoke("subscription:activate", code),
  submitSubscriptionCode: (code) =>
    ipcRenderer.invoke("subscription:activate", code),
  activateTrial: () => ipcRenderer.invoke("trial:activate"),
  onSubscriptionStatus: (callback) =>
    ipcRenderer.on("subscription:status", (_, data) => callback(data)),
  onShowActivationModal: (callback) =>
    ipcRenderer.on("show:activation-modal", (_, data) => callback(data)),
  onHideActivationModal: (callback) =>
    ipcRenderer.on("hide:activation-modal", () => {
      console.log("[PRELOAD] hide:activation-modal event received");
      callback();
    }),
  onAppReady: (callback) =>
    ipcRenderer.on("app:ready", (_, data) => callback(data)),
  onOfflineWarning: (callback) =>
    ipcRenderer.on("app:offline-warning", (_, message) => callback(message)),
  onRevokedWarning: (callback) =>
    ipcRenderer.on("app:revoked-warning", (_, message) => callback(message)),
  onAppOnline: (callback) =>
    ipcRenderer.on("app:online", (_, data) => callback(data)),
  onJobsNew: (callback) =>
    ipcRenderer.on("jobs:new", (_, data) => callback(data)),
  onJobsUpdated: (callback) =>
    ipcRenderer.on("jobs:updated", (_, data) => callback(data)),
  onJobsNewGroup: (callback) =>
    ipcRenderer.on("jobs:new-group", (_, data) => callback(data)),
  onJobOrientationAnalyzed: (callback) =>
    ipcRenderer.on("jobs:orientation-analyzed", (_, data) => callback(data)),
  requestJobRefresh: () => ipcRenderer.invoke("job:poll-now"),
  onAICreditsUpdated: (callback) =>
    ipcRenderer.on("ai:credits-updated", () => callback()),

  // ── QR code (Main process, works offline) ──────────────────────
  generateQR: async (data) => ipcRenderer.invoke("qr:generate", data),
  onUpdateAvailable: (cb) =>
    ipcRenderer.on("update:available", (_, d) => cb(d)),
  onUpdateDownloaded: (cb) =>
    ipcRenderer.on("update:downloaded", (_, d) => cb(d)),
  onUpdateProgress: (cb) => ipcRenderer.on("update:progress", (_, d) => cb(d)),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateError: (cb) => ipcRenderer.on("update:error", (_, d) => cb(d)),
  startUpdateDownload: () => ipcRenderer.invoke("update:start-download"),
  installUpdateNow: () => ipcRenderer.invoke("update:install-now"),
  checkForUpdateNow: () => ipcRenderer.invoke("update:check-now"),

  // ── Derewol AI ────────────────────────────────────────────
  aiCheckCredits: (printerId) =>
    ipcRenderer.invoke("ai:checkCredits", { printerId }),
  aiAnalyzeDocument: (filePath, printerId) =>
    ipcRenderer.invoke("ai:analyzeDocument", { filePath, printerId }),
  aiAnalyzeExcel: (filePath, printerId) =>
    ipcRenderer.invoke("ai:analyzeExcel", { filePath, printerId }),
  aiOcrDocument: (filePath, printerId) =>
    ipcRenderer.invoke("ai:ocrDocument", { filePath, printerId }),
  aiAddCredits: (printerId, credits, amountXof, paymentRef) =>
    ipcRenderer.invoke("ai:addCredits", { printerId, credits, amountXof, paymentRef }),
  aiApplySuggestions: (filePath, suggestions) =>
    ipcRenderer.invoke("ai:applySuggestions", { filePath, suggestions }),
  aiApplyExcelFull: (filePath) =>
    ipcRenderer.invoke("ai:applyExcelFull", { filePath }),
  aiImproveOcrText: (text, docType, improvements, printerId) =>
    ipcRenderer.invoke("ai:improveOcrText", { text, docType, improvements, printerId }),

  // ── Download authorization ────────────────────────────────────
  requestFileDownload: (data) =>
    ipcRenderer.invoke("file:request-download", data),
  checkDownloadApproval: (id) =>
    ipcRenderer.invoke("file:check-download-approval", id),
  downloadApprovedFile: (data) =>
    ipcRenderer.invoke("file:download-approved", data),
  manualUpload: (payload) => ipcRenderer.invoke("file:manual-upload", payload),
  getSignedUrl: (fileId) =>
    ipcRenderer.invoke("file:get-signed-url", fileId).then((r) => {
      if (!r.success) throw new Error(r.error);
      return r.url;
    }),
  fusionGenerate: (payload) => ipcRenderer.invoke("fusion:generate", payload),
  onUploadSuccess: (cb) =>
    ipcRenderer.on("file:upload-success", (_, d) => cb(d)),
  onUploadFallback: (cb) =>
    ipcRenderer.on("file:upload-fallback", (_, d) => cb(d)),
  // ── Viewer sécurisé ────────────────────────────────────────
  viewerOpen: (jobId, fileId) =>
    ipcRenderer.invoke("viewer:open", jobId, fileId),

  // ── Sécurité / Admin ───────────────────────────────────────
  securityDisableScreenshot: (code) =>
    ipcRenderer.invoke("security:disable-screenshot", code),
  securityEnableScreenshot: (code) =>
    ipcRenderer.invoke("security:enable-screenshot", code),
  securityScreenshotStatus: () =>
    ipcRenderer.invoke("security:screenshot-status"),

  // ── Recovery ──────────────────────────────────────────────
  recovery: {
    request: (emailOrPhone) =>
      ipcRenderer.invoke("recovery:request", emailOrPhone),
    verify: (data) => ipcRenderer.invoke("recovery:verify", data),
  },
  app: {
    relaunch: () => ipcRenderer.invoke("app:relaunch"),
  },
  dev: {
    logout: () => ipcRenderer.invoke("dev:logout"),
  },
});

contextBridge.exposeInMainWorld("electronAPI", {
  onUpdateAvailable: (cb) =>
    ipcRenderer.on("update:available", (_, d) => cb(d)),
  onUpdateDownloaded: (cb) =>
    ipcRenderer.on("update:downloaded", (_, d) => cb(d)),
  onUpdateProgress: (cb) => ipcRenderer.on("update:progress", (_, d) => cb(d)),
  installUpdate: () => ipcRenderer.invoke("update:install"),
});
