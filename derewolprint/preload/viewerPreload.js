const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("viewer", {
  onData: (cb) => ipcRenderer.on("viewer:data", (_, d) => cb(d)),
  onTTLExpired: (cb) => ipcRenderer.on("viewer:ttl-expired", () => cb()),
  save: (jobId, fileId, dataArray) =>
    ipcRenderer.invoke("viewer:save", jobId, fileId, dataArray),
  print: (jobId, fileId) => ipcRenderer.invoke("viewer:print", jobId, fileId),
  ready: () => ipcRenderer.send("viewer:ready"),
  close: (jobId, fileId) => ipcRenderer.send("viewer:close", jobId, fileId),
  onConverting: (cb) => ipcRenderer.on("viewer:converting", () => cb()),
  onError: (cb) => ipcRenderer.on("viewer:error", (_e, msg) => cb(msg)),
});
