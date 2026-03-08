const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('derewol', {
  // ── Setup onboarding ──────────────────────────────────────
  checkSlug:       (slug)          => ipcRenderer.invoke('setup:check-slug', slug),
  registerPrinter: (data)          => ipcRenderer.invoke('setup:register', data),
  setupDone:       (config)        => ipcRenderer.send('setup:done', config),

  // ── App principale ────────────────────────────────────────
  getPrinterConfig: ()             => ipcRenderer.invoke('printer:config'),
  updatePrinterName:(name)         => ipcRenderer.invoke('printer:update-name', name),

  // ── Jobs impression ───────────────────────────────────────
  onJobReceived:   (callback)      => ipcRenderer.on('job:received', (_, jobs) => callback(jobs)),
  confirmPrint:    (groupId, printerName, copies, jobCopies) =>
                     ipcRenderer.invoke('job:confirm', groupId, printerName, copies, jobCopies),
  rejectJob:       (jobId)         => ipcRenderer.invoke('job:reject', jobId),

  // ── Utilitaires ───────────────────────────────────────────
  sendLog:          (message)      => ipcRenderer.invoke('log:write', message),
  getPrinters:      ()             => ipcRenderer.invoke('printer:list'),
  getDefaultPrinter:()             => ipcRenderer.invoke('printer:default'),
  getHistory:       ()             => ipcRenderer.invoke('history:get'),
});