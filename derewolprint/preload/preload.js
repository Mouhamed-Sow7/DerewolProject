const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('derewol', {
  // Jobs impression
  onJobReceived: (callback) => ipcRenderer.on('job:received', (_, job) => callback(job)),
  confirmPrint: (jobId, printerName) => ipcRenderer.invoke('job:confirm', jobId, printerName),
  rejectJob: (jobId) => ipcRenderer.invoke('job:reject', jobId),

  // les Logs
  sendLog: (message) => ipcRenderer.invoke('log:write', message),
  getPrinters: () => ipcRenderer.invoke('printer:list'),
  getDefaultPrinter: () => ipcRenderer.invoke('printer:default'),
});