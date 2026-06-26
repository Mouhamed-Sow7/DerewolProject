const { _electron: electron } = require('playwright');

(async () => {
  const app = await electron.launch({
    executablePath: 'd:\\workspace\\Derewol\\derewolprint\\node_modules\\electron\\dist\\electron.exe',
    args: ['d:\\workspace\\Derewol\\derewolprint\\main\\main.js']
  });

  // Attendre que la fenêtre soit prête
  await new Promise(r => setTimeout(r, 3000));

  const page = await app.firstWindow();
  if (page) {
    // Prendre une capture d'écran
    await page.screenshot({ path: 'C:\\Users\\Binta\\AppData\\Local\\Temp\\derewol-screenshot.png' });
    console.log('Screenshot saved to: C:\\Users\\Binta\\AppData\\Local\\Temp\\derewol-screenshot.png');
  }

  await app.close();
})();
