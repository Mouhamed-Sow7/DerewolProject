/**
 * preload.js — EXTRAIT : section checkPrinterStatus
 * Coller dans ton contextBridge.exposeInMainWorld('derewol', { … })
 *
 * RÈGLE : ne retourne JAMAIS null — toujours { online: boolean }
 */

// Dans ton exposeInMainWorld :
checkPrinterStatus: async () => {
  try {
    const result = await ipcRenderer.invoke('printer:check-status');
    // Garantir la forme { online: boolean }
    if (!result || typeof result.online !== 'boolean') {
      console.warn('[preload] printer:check-status réponse invalide :', result);
      return { online: false, status: null, name: null, method: 'invalid-response' };
    }
    return result;
  } catch (err) {
    console.error('[preload] checkPrinterStatus IPC error :', err.message);
    return { online: false, status: null, name: null, method: 'ipc-error', error: err.message };
  }
},
