const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('derewol', {
  // Jobs impression
  onJobReceived: (callback) => ipcRenderer.on('job:received', (_, job) => callback(job)),
  confirmPrint: (jobId) => ipcRenderer.invoke('job:confirm', jobId),
  rejectJob: (jobId) => ipcRenderer.invoke('job:reject', jobId),

  // les Logs
  sendLog: (message) => ipcRenderer.invoke('log:write', message),
});