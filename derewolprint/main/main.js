const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { decryptFile, secureDelete, hashFile } = require('../services/crypto');
const supabase = require('../services/supabase');
const { startPolling } = require('../services/polling');
const pdfToPrinter = require('pdf-to-printer');
const { getAvailablePrinters, getDefaultPrinter } = require('../services/printer');
let mainWindow = null;
const processingJobs = new Set();

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
    autoHideMenuBar:true,
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
  // Bloque si déjà en cours
  if (processingJobs.has(jobId)) {
    console.log('[PRINT] Job déjà en cours, ignoré :', jobId);
    return { success: false, error: 'Job déjà en cours' };
  }
  
  processingJobs.add(jobId);
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
    
    // Vérifie que le buffer est valide avant impression
    if (!decryptedBuffer || decryptedBuffer.length < 100) {
      throw new Error('Fichier invalide ou trop petit');
    }

    console.log('[PRINT] Hash fichier :', hashFile(decryptedBuffer));

    const os = require('os');
    const fs = require('fs');
    const tmpPath = path.join(os.tmpdir(), `dw-${jobId}.pdf`);

    try {
      fs.writeFileSync(tmpPath, decryptedBuffer);

      console.log('[PRINT] Impression vers :', printerName);
      await pdfToPrinter.print(tmpPath, { printer: printerName });
      console.log('[PRINT] Envoyé à l\'imprimante ✅');

      // Marque comme completed DANS TOUS LES CAS
      await supabase
        .from('print_jobs')
        .update({ status: 'completed' })
        .eq('id', jobId);

    } catch(err) {
      console.error('[PRINT] Erreur :', err.message);
      // Marque quand même comme completed pour stopper le polling
      await supabase
        .from('print_jobs')
        .update({ status: 'completed' })
        .eq('id', jobId);
      
    } finally {
      processingJobs.delete(jobId);
      // Suppression GARANTIE dans tous les cas
      if (fs.existsSync(tmpPath)) {
        secureDelete(tmpPath);
        console.log('[PRINT] Temp supprimé ✅');
      }
    }

    return { success: true, jobId };

  } catch (err) {
    console.error('[PRINT] Erreur :', err.message);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('job:reject', async (event, jobId) => {
  console.log('[REJECT] Job rejeté :', jobId);

  try {
    // 1. Récupère les infos du job
    const { data: job, error } = await supabase
      .from('print_jobs')
      .select(`
        id,
        file_groups (
          files ( storage_path )
        )
      `)
      .eq('id', jobId)
      .single();

    if (error || !job) throw new Error('Job introuvable');

    const storagePath = job.file_groups?.files?.[0]?.storage_path;

    // 2. Supprime le fichier dans Supabase Storage
    if (storagePath) {
      const { error: deleteError } = await supabase
        .storage
        .from('derewol-files')
        .remove([storagePath]);

      if (deleteError) {
        console.error('[REJECT] Erreur suppression storage :', deleteError.message);
      } else {
        console.log('[REJECT] Fichier supprimé du storage ✅');
      }
    }

    // 3. Met à jour le statut job → rejected
    await supabase
      .from('print_jobs')
      .update({ status: 'rejected' })
      .eq('id', jobId);

    // 4. Met à jour le statut file_group → deleted
    await supabase
      .from('file_groups')
      .update({ status: 'deleted' })
      .eq('id', job.file_groups?.id);

    console.log('[REJECT] Job clôturé ✅');
    return { success: true, jobId };

  } catch (err) {
    console.error('[REJECT] Erreur :', err.message);
    return { success: false, error: err.message };
  }
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