const {app , BrowserWindow} = require('electron');

const path = require('path');

function createWindow(){
const win = new BrowserWindow({
    width:1200,
    height:800,
    webPreferences:{
        preload:path.join(__dirname,'../preload/preload.js'),
        //jamais d'access au systeme avec:
        nodeIntegration:false,
        // empeche renderer utiliser node.js
        contextIsolation:true
        // separation 👉 window navigateur
// 👉 APIs preload
    }
});
win.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);

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