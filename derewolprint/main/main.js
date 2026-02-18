const {app , BrowserWindow} = require('electron');

const path = require('path');

const supabase = require('../services/supabase');
const { startPolling } = require('../services/polling');

async function testConnection() {
  const { data, error } = await supabase.from('print_jobs').select('*').limit(1);
  if (error) {
    console.log('Erreur Supabase :', error.message);
  } else {
    console.log('Supabase connecté ✅ — print_jobs accessible');
  }
}
let mainWindow = null;


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
    //   
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(() => {
  testConnection();
  createWindow();

  startPolling((jobs) => {
    console.log('[POLLING] Jobs trouvés :', jobs.length);
    if (mainWindow && jobs.length > 0) {
      mainWindow.webContents.send('job:received', jobs);
    }
  });
});

const { ipcMain } = require('electron');

ipcMain.handle('job:confirm', async (event, jobId) => {
  console.log('Job confirmé :', jobId);
  // Plus tard → déchiffrement + impression
  return { success: true, jobId };
});

ipcMain.handle('job:reject', async (event, jobId) => {
  console.log('Job rejeté :', jobId);
  // Plus tard → suppression fichier
  return { success: true, jobId };
});

ipcMain.handle('log:write', async (event, message) => {
  console.log('[LOG]', new Date().toISOString(), message);
  return { success: true };
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});