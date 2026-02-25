const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const { decryptFile, secureDelete } = require('../services/crypto');
const supabase = require('../services/supabase');
const { startPolling } = require('../services/polling');
const { log, logError } = require('../services/logger');
const pdfToPrinter = require('pdf-to-printer');
const { getAvailablePrinters, getDefaultPrinter } = require('../services/printer');

let mainWindow = null;
const processingJobs = new Set();

function cleanSpooler() {
  try {
    execSync('net stop spooler /y', { stdio: 'ignore' });
    execSync('del /Q /F /S "C:\\Windows\\System32\\spool\\PRINTERS\\*.*"', { shell: true, stdio: 'ignore' });
    execSync('net start spooler', { stdio: 'ignore' });
    console.log('[CLEANUP] Spooler nettoyé ✅');
  } catch(e) { console.log('[CLEANUP] Spooler déjà propre'); }
}

function cleanTmpFiles() {
  try {
    fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('dw-'))
      .forEach(f => { try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch(e) {} });
  } catch(e) {}
}

async function testConnection() {
  const { error } = await supabase.from('print_jobs').select('*').limit(1);
  console.log(error ? 'Erreur Supabase :' + error.message : 'Supabase connecté ✅');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    minWidth: 900, maxWidth: 1600, minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.setContentProtection(true);
  mainWindow.loadFile('renderer/index.html');
}

// ── Impression d'un seul fichier ──────────────────────────────
// ⚠️ Ne touche PAS à file_groups.status — géré par job:confirm
async function printSingleJob(jobId, printerName, copies) {
  const tmpPath = path.join(os.tmpdir(), `dw-${jobId}.pdf`);

  // Récupère job
  const { data, error } = await supabase
    .from('print_jobs')
    .select(`
      id, print_token,
      file_groups (
        id, owner_id,
        files ( storage_path, encrypted_key, file_name )
      )
    `)
    .eq('id', jobId).single();

  if (error || !data) throw new Error(`Job ${jobId} introuvable`);

  const file = data.file_groups?.files?.[0];
  if (!file) throw new Error(`Fichier introuvable pour job ${jobId}`);

  const fileGroupId = data.file_groups.id;

  // Notify client → printing (print_job seulement)
  await supabase.from('print_jobs')
    .update({ status: 'printing', copies_requested: copies, copies_remaining: copies })
    .eq('id', jobId);

  console.log(`[PRINT] ${file.file_name} — ${copies} copies → ${printerName}`);

  // Télécharge
  const { data: fileData, error: dlError } = await supabase
    .storage.from('derewol-files').download(file.storage_path);

  if (dlError) throw new Error(`Téléchargement échoué : ${dlError.message}`);

  const decryptedBuffer = decryptFile(
    Buffer.from(await fileData.arrayBuffer()),
    file.encrypted_key
  );

  if (!decryptedBuffer || decryptedBuffer.length < 100)
    throw new Error('Fichier invalide ou trop petit');

  // Imprime
  fs.writeFileSync(tmpPath, decryptedBuffer);

  for (let i = 0; i < copies; i++) {
    await pdfToPrinter.print(tmpPath, { printer: printerName });
    console.log(`[PRINT] ${file.file_name} copie ${i + 1}/${copies} ✅`);
    await supabase.from('print_jobs')
      .update({ copies_remaining: copies - (i + 1) })
      .eq('id', jobId);
  }

  // print_job → completed (mais PAS file_groups ici)
  await supabase.from('print_jobs')
    .update({ status: 'completed', copies_remaining: 0 })
    .eq('id', jobId);

  // Supprime Storage
  await supabase.storage.from('derewol-files').remove([file.storage_path]);
  console.log(`[PRINT] ${file.file_name} → Storage supprimé ✅`);

  // Nettoyage tmp
  if (fs.existsSync(tmpPath)) secureDelete(tmpPath);

  return { jobId, fileName: file.file_name, copies, fileGroupId };
}

// ── IPC : Impression groupée ──────────────────────────────────
// jobCopies = [{ jobId, fileName, copies }, ...]
ipcMain.handle('job:confirm', async (event, groupId, printerName, _copies, jobCopies) => {

  const items = Array.isArray(jobCopies)
    ? jobCopies
    : [{ jobId: groupId, fileName: 'fichier', copies: _copies || 1 }];

  const jobIds = items.map(i => i.jobId);

  if (jobIds.some(id => processingJobs.has(id)))
    return { success: false, error: 'Job déjà en cours' };

  jobIds.forEach(id => processingJobs.add(id));
  log('PRINT_GROUP_START', { groupId, items, printer: printerName });
  console.log(`[PRINT] Groupe — ${items.length} fichier(s) → ${printerName}`);

  const results = [];
  const errors = [];
  let fileGroupId = null;

  try {
    // ── 1. Notify client → printing AVANT de commencer ───────
    // Récupère le fileGroupId depuis le premier job
    const { data: firstJob } = await supabase
      .from('print_jobs')
      .select('file_groups ( id )')
      .eq('id', items[0].jobId)
      .single();

    fileGroupId = firstJob?.file_groups?.id;

    if (fileGroupId) {
      await supabase.from('file_groups')
        .update({ status: 'printing' })
        .eq('id', fileGroupId);
      console.log('[PRINT] file_group → printing ✅');
    }

    // ── 2. Imprime chaque fichier séquentiellement ────────────
    for (const item of items) {
      try {
        const result = await printSingleJob(item.jobId, printerName, item.copies);
        results.push(result);
        // Récupère fileGroupId si pas encore set
        if (!fileGroupId && result.fileGroupId) fileGroupId = result.fileGroupId;
      } catch (err) {
        console.error(`[PRINT] ❌ ${item.fileName} :`, err.message);
        errors.push({ jobId: item.jobId, fileName: item.fileName, error: err.message });
        await supabase.from('print_jobs')
          .update({ status: 'completed' }).eq('id', item.jobId);
      }
    }

    // ── 3. Notify client → completed UNE SEULE FOIS ──────────
    if (fileGroupId) {
      await supabase.from('file_groups')
        .update({ status: 'completed' })
        .eq('id', fileGroupId);
      console.log('[PRINT] file_group → completed ✅');
    }

    log('PRINT_GROUP_DONE', { groupId, results, errors });

    return errors.length > 0
      ? { success: false, partial: true, results, errors }
      : { success: true, results };

  } catch (err) {
    console.error('[PRINT] Erreur groupe :', err.message);

    // Fallback — marque completed pour éviter boucle infinie
    if (fileGroupId) {
      await supabase.from('file_groups')
        .update({ status: 'completed' })
        .eq('id', fileGroupId);
    }

    return { success: false, error: err.message };

  } finally {
    jobIds.forEach(id => processingJobs.delete(id));
    setTimeout(() => cleanSpooler(), 2000);
  }
});

// ── IPC : Rejet ───────────────────────────────────────────────
ipcMain.handle('job:reject', async (event, jobId) => {
  console.log('[REJECT] Job rejeté :', jobId);
  log('JOB_REJECTED', { jobId });
  try {
    const { data: job, error } = await supabase
      .from('print_jobs')
      .select(`id, file_groups ( id, files ( storage_path ) )`)
      .eq('id', jobId).single();

    if (error || !job) throw new Error('Job introuvable');

    const storagePath = job.file_groups?.files?.[0]?.storage_path;
    if (storagePath) {
      await supabase.storage.from('derewol-files').remove([storagePath]);
      console.log('[REJECT] Storage supprimé ✅');
    }

    await supabase.from('print_jobs').update({ status: 'rejected' }).eq('id', jobId);
    await supabase.from('file_groups').update({ status: 'rejected' }).eq('id', job.file_groups?.id);

    return { success: true, jobId };
  } catch (err) {
    console.error('[REJECT] Erreur :', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('printer:list', async () => {
  const printers = await getAvailablePrinters();
  console.log('[PRINTER] Imprimantes :', printers.map(p => p.name));
  return printers;
});

ipcMain.handle('printer:default', async () => await getDefaultPrinter());

ipcMain.handle('log:write', async (event, message) => {
  console.log('[LOG]', new Date().toISOString(), message);
  return { success: true };
});

app.whenReady().then(() => {
  log('APP_START', { version: '1.0.0' });
  cleanSpooler();
  cleanTmpFiles();
  testConnection();
  createWindow();

  startPolling((jobs) => {
    console.log('[POLLING] Jobs trouvés :', jobs.length);
    if (mainWindow) mainWindow.webContents.send('job:received', jobs);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});