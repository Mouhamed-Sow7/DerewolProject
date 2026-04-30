const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("viewer", {
  // Main → viewer: file data (path only, never buffer)
  onData: (cb) => ipcRenderer.once("viewer:data", (_, d) => cb(d)),

  // Main → viewer: TTL expired signal
  onTTLExpired: (cb) => ipcRenderer.on("viewer:ttl-expired", () => cb()),

  // viewer → Main: save modified file (image/excel only)
  // dataArray = Array of uint8 numbers (not Buffer, to avoid IPC buffer warning)
  save: (jobId, fileId, dataArray) =>
    ipcRenderer.invoke("viewer:save", jobId, fileId, dataArray),

  // viewer → Main: print original file from tmp
  print: (jobId, fileId) => ipcRenderer.invoke("viewer:print", jobId, fileId),

  ready: () => ipcRenderer.send("viewer:ready"),

  // viewer → Main: close and delete tmp (fire-and-forget)
  close: (jobId, fileId) => ipcRenderer.send("viewer:close", jobId, fileId),
});
