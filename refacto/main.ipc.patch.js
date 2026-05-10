/**
 * main.js — EXTRAIT IPC à intégrer
 * Coller dans ton main.js après les imports existants
 *
 * Dépendances à ajouter en haut de main.js :
 *   const { analyzeDocumentForPrint, analyzeExcel } = require('./services/aiPrintAnalyzer');
 *   const { extractTextFromImage, checkOCRCredits, makeSupabaseCreditDeductor } = require('./services/ocrModule');
 *   const { checkPrinterStatus, debugListPrinters } = require('./services/printerStatusCheck');
 */

// ─── IPC : Analyse IA avant impression ────────────────────────────────────────

ipcMain.handle('ai:analyze-document', async (_event, { filePath }) => {
  console.log('[Main] ai:analyze-document :', filePath);
  try {
    // Récupérer la clé API déchiffrée depuis ton système AES existant
    const apiKey = await getDecryptedAnthropicKey();  // adapter selon ton implémentation
    const result = await analyzeDocumentForPrint(filePath, apiKey);
    return { success: true, data: result };
  } catch (err) {
    console.error('[Main] ai:analyze-document échoué :', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ai:analyze-excel', async (_event, { filePath }) => {
  console.log('[Main] ai:analyze-excel :', filePath);
  try {
    const apiKey = await getDecryptedAnthropicKey();
    const result = await analyzeExcel(filePath, apiKey);
    return { success: true, data: result };
  } catch (err) {
    console.error('[Main] ai:analyze-excel échoué :', err.message);
    return { success: false, error: err.message };
  }
});

// ─── IPC : OCR ────────────────────────────────────────────────────────────────

ipcMain.handle('ocr:check-credits', async (_event, { userId }) => {
  console.log('[Main] ocr:check-credits userId:', userId);
  try {
    const result = await checkOCRCredits(supabase, userId);  // supabase = ton client global
    return { success: true, ...result };
  } catch (err) {
    return { success: false, credits: 0, canUseOCR: false, error: err.message };
  }
});

ipcMain.handle('ocr:extract-text', async (_event, { filePath, language, userId }) => {
  console.log('[Main] ocr:extract-text :', filePath, 'lang:', language, 'userId:', userId);
  try {
    const apiKey         = await getDecryptedAnthropicKey();
    const creditDeductor = makeSupabaseCreditDeductor(supabase);

    const result = await extractTextFromImage({
      filePath,
      anthropicApiKey: apiKey,
      language:        language ?? 'fr',
      userId,
      onCreditDeduct:  creditDeductor,
    });

    return { success: true, data: result };
  } catch (err) {
    console.error('[Main] ocr:extract-text échoué :', err.message);
    return { success: false, error: err.message };
  }
});

// ─── IPC : Printer status (mise à jour) ───────────────────────────────────────

ipcMain.handle('printer:check-status', async () => {
  console.log('[Main] printer:check-status');
  try {
    // Passe le nom de l'imprimante stocké en config, ou null pour l'imprimante par défaut
    const printerName = store?.get('printerName') ?? null;  // adapter selon ton store (electron-store)
    const result      = await checkPrinterStatus(printerName);
    return result;
  } catch (err) {
    console.error('[Main] printer:check-status échoué :', err.message);
    return { online: false, status: null, name: null, method: 'ipc-error', error: err.message };
  }
});

// ─── IPC : Debug — liste noms WMI (désactiver en prod) ────────────────────────

ipcMain.handle('printer:debug-list', async () => {
  const names = await debugListPrinters();
  console.log('[Main] printer:debug-list :', names);
  return names;
});

// ─── Preload additions à ajouter dans contextBridge ───────────────────────────
/*
analyzeDocument:   (filePath)                    => ipcRenderer.invoke('ai:analyze-document',  { filePath }),
analyzeExcel:      (filePath)                    => ipcRenderer.invoke('ai:analyze-excel',     { filePath }),
checkOCRCredits:   (userId)                      => ipcRenderer.invoke('ocr:check-credits',    { userId }),
extractText:       (filePath, language, userId)  => ipcRenderer.invoke('ocr:extract-text',     { filePath, language, userId }),
debugListPrinters: ()                            => ipcRenderer.invoke('printer:debug-list'),
*/
