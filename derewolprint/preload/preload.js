const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("derewol", {
  // ── Setup onboarding ──────────────────────────────────────
  checkSlug: (slug) => ipcRenderer.invoke("setup:check-slug", slug),
  registerPrinter: (data) => ipcRenderer.invoke("setup:register", data),
  setupDone: (config) => ipcRenderer.send("setup:done", config),

  // ── App principale ────────────────────────────────────────
  getPrinterConfig: () => ipcRenderer.invoke("printer:config"),
  updatePrinterName: (name) => ipcRenderer.invoke("printer:update-name", name),

  // ── Jobs impression ───────────────────────────────────────
  onJobReceived: (callback) =>
    ipcRenderer.on("job:received", (_, jobs) => callback(jobs)),
  confirmPrint: (groupId, printerName, copies, jobCopies) =>
    ipcRenderer.invoke("job:confirm", groupId, printerName, copies, jobCopies),
  rejectJob: (jobId) => ipcRenderer.invoke("job:reject", jobId),

  // ── Utilitaires ───────────────────────────────────────────
  sendLog: (message) => ipcRenderer.invoke("log:write", message),
  setPollingInterval: (intervalMs) =>
    ipcRenderer.invoke("polling:set-interval", intervalMs),
  getPrinters: () => ipcRenderer.invoke("printer:list"),
  getDefaultPrinter: () => ipcRenderer.invoke("printer:default"),
  getHistory: () => ipcRenderer.invoke("history:get"),

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

  // ── QR code (Main process, works offline) ──────────────────────
  generateQR: async (data) => ipcRenderer.invoke("qr:generate", data),

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
});
