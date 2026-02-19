const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { decryptFile, secureDelete, hashFile } = require('../services/crypto');
const supabase = require('../services/supabase');
const { startPolling } = require('../services/polling');
const pdfToPrinter = require('pdf-to-printer');
const { getAvailablePrinters, getDefaultPrinter } = require('../services/printer');
let mainWindow = null;

// ── Connexion Supabase ─────────────────────────────────────────
async function testConnection() {
  const { data, error } = await supabase.from('print_jobs').select('*').limit(1);
  if (error) {
    console.log('Erreur Supabase :', error.message);
  } else {
    console.log('Supabase connecté ✅ — print_jobs accessible');
  }
}

// ── Fenêtre principale ─────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.loadFile('renderer/index.html');
}

// ── IPC Handlers ───────────────────────────────────────────────
ipcMain.handle('job:confirm', async (event, jobId, printerName) => {
  console.log('[PRINT] Job confirmé :', jobId);

  try {
    const { data: job, error } = await supabase
      .from('print_jobs')
      .select(`
        id, print_token,
        file_groups (
          owner_id,
          files ( storage_path, encrypted_key, file_name )
        )
      `)
      .eq('id', jobId)
      .single();

    if (error || !job) throw new Error('Job introuvable');

    const file = job.file_groups?.files?.[0];
    console.log('[DEBUG] Fichier :', file);
    if (!file) throw new Error('Fichier introuvable');

    const { data: fileData, error: downloadError } = await supabase
      .storage
      .from('derewol-files')
      .download(file.storage_path);

    if (downloadError) throw new Error('Téléchargement échoué : ' + JSON.stringify(downloadError));

    const arrayBuffer = await fileData.arrayBuffer();
    const encryptedBuffer = Buffer.from(arrayBuffer);

    const decryptedBuffer = decryptFile(encryptedBuffer, file.encrypted_key);
    console.log('[PRINT] Hash fichier :', hashFile(decryptedBuffer));

    const os = require('os');
    const fs = require('fs');
    const tmpPath = path.join(os.tmpdir(), `dw-${jobId}.pdf`);

    try {
      fs.writeFileSync(tmpPath, decryptedBuffer);

      console.log('[PRINT] Impression vers :', printerName);
      await pdfToPrinter.print(tmpPath, { printer: printerName });
      console.log('[PRINT] Envoyé à l\'imprimante ✅');
    } finally {
      // Suppression GARANTIE même si impression échoue
      if (fs.existsSync(tmpPath)) {
        secureDelete(tmpPath);
        console.log('[PRINT] Fichier temporaire supprimé ✅');
      }
    }

    await supabase
      .from('print_jobs')
      .update({ status: 'completed' })
      .eq('id', jobId);

    return { success: true, jobId };

  } catch (err) {
    console.error('[PRINT] Erreur :', err.message);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('job:reject', async (event, jobId) => {
  console.log('[PRINT] Job rejeté :', jobId);
  // Bloc 6 : suppression sécurisée
  return { success: true, jobId };
});

ipcMain.handle('log:write', async (event, message) => {
  console.log('[LOG]', new Date().toISOString(), message);
  return { success: true };
});

// ── Boot ───────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Nettoyage spooler au démarrage
  const { execSync } = require('child_process');
  try {
    execSync('net stop spooler', { stdio: 'ignore' });
    execSync('del /Q /F "C:\\Windows\\System32\\spool\\PRINTERS\\*"', { stdio: 'ignore' });
    execSync('net start spooler', { stdio: 'ignore' });
    console.log('[CLEANUP] Spooler nettoyé ✅');
  } catch(e) {
    console.log('[CLEANUP] Spooler déjà propre');
  }

  testConnection();
  createWindow();

  // Nettoyage au démarrage — supprime anciens fichiers temporaires Derewol
  try {
    const tmpDir = require('os').tmpdir();
    const fs = require('fs');
    const pth = require('path');
    fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('dw-'))
      .forEach(f => {
        try {
          fs.unlinkSync(pth.join(tmpDir, f));
          console.log('[CLEANUP] Supprimé :', f);
        } catch (e) {
          console.warn('[CLEANUP] Impossible de supprimer :', f, e.message);
        }
      });
  } catch (e) {
    console.warn('[CLEANUP] Erreur lors du nettoyage tmp :', e.message);
  }

  startPolling((jobs) => {
    console.log('[POLLING] Jobs trouvés :', jobs.length);
    if (mainWindow && jobs.length > 0) {
      mainWindow.webContents.send('job:received', jobs);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('printer:list', async () => {
  const printers = await getAvailablePrinters();
  console.log('[PRINTER] Imprimantes détectées :', printers.map(p => p.name));
  return printers;
});

ipcMain.handle('printer:default', async () => {
  const printer = await getDefaultPrinter();
  console.log('[PRINTER] Imprimante par défaut :', printer?.name);
  return printer;
});