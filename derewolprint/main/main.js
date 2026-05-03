const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { exec, execSync } = require("child_process");
const {
  decryptFile,
  encryptFile,
  hashFile,
  secureDelete,
  validateDecryptedBuffer,
} = require("../services/crypto");

function execShell(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, { shell: true, ...options }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr });
    });
  });
}

const {
  supabase,
  getSignedUrlForOfficeViewer,
} = require("../services/supabase");
const { startPolling, stopPolling } = require("../services/polling");
const { log } = require("../services/logger");
const pdfToPrinter = require("pdf-to-printer");
const QRCode = require("qrcode");
const {
  getAvailablePrinters,
  getDefaultPrinter,
} = require("../services/printer");
const {
  loadConfig,
  saveConfig,
  clearConfig,
} = require("../services/printerConfig");

function parseVirtualPrinterArg(argv) {
  if (!Array.isArray(argv)) return null;
  const index = argv.findIndex(
    (arg) =>
      arg === "-vprint" ||
      arg.startsWith("-vprint:") ||
      arg.startsWith("-vprint=") ||
      arg === "--vprint",
  );
  if (index === -1) return null;

  const arg = argv[index];
  if (arg.includes(":") || arg.includes("=")) {
    const [, value] = arg.split(/[:=]/);
    return value?.trim() || "vprint test";
  }

  const next = argv[index + 1];
  if (typeof next === "string" && !next.startsWith("-")) {
    return next.trim();
  }

  return "vprint test";
}

const virtualPrinterName = parseVirtualPrinterArg(process.argv);

const {
  checkSubscription,
  activateCode,
  ensureTrialOrSubscription,
} = require("../services/subscription");

// ── Dossier téléchargements DerewolPrint ───────────────────
const DEREWOL_FILES_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getDerewolFilesDir() {
  const { app } = require("electron");
  const dir = path.join(app.getPath("downloads"), "DerewolFiles");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log("[DEREWOL FILES] Dossier créé :", dir);
  }
  return dir;
}

function cleanDerewolFilesDir() {
  try {
    const dir = getDerewolFilesDir();
    const files = fs.readdirSync(dir);
    let count = 0;
    for (const f of files) {
      const fp = path.join(dir, f);
      try {
        fs.unlinkSync(fp);
        count++;
      } catch (e) {
        console.warn("[DEREWOL FILES] Impossible de supprimer:", fp);
      }
    }
    if (count > 0)
      console.log(`[DEREWOL FILES] ${count} fichier(s) supprimé(s)`);
  } catch (e) {
    console.warn("[DEREWOL FILES] Erreur nettoyage:", e.message);
  }
}

// ── Détection mode production/développement ─────────────────────
let isDev = process.env.NODE_ENV === "development";

// ── Détection dynamique de toutes les imprimantes Windows ──
async function getInstalledPrinters() {
  return new Promise((resolve) => {
    const cmd =
      "powershell -NoProfile -NonInteractive -Command " +
      '"Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json"';
    require("child_process").exec(cmd, { windowsHide: true }, (err, stdout) => {
      if (err) {
        console.warn("[PRINTERS] Fallback liste vide:", err.message);
        const fallback = virtualPrinterName
          ? [{ name: virtualPrinterName }]
          : [];
        return resolve(fallback);
      }
      try {
        const raw = JSON.parse(stdout.trim());
        const list = Array.isArray(raw) ? raw : [raw];
        // Filter out null/undefined entries to prevent .toLowerCase() crashes
        const clean = list.filter((p) => p && typeof p === "string");
        const printers = clean.map((name) => ({ name }));
        // 🔥 Toujours ajouter Mp-Pdf comme imprimante virtuelle
        const mpPdfExists = printers.some((p) => p.name === "Mp-Pdf");
        if (!mpPdfExists) printers.push({ name: "Mp-Pdf" });

        if (virtualPrinterName) {
          const exists = printers.some((p) => p.name === virtualPrinterName);
          if (!exists) printers.push({ name: virtualPrinterName });
        }
        console.log(
          "[PRINTERS] Détectées:",
          printers.map((p) => p.name),
        );
        resolve(printers);
      } catch (e) {
        const fallback = virtualPrinterName
          ? [{ name: virtualPrinterName }]
          : [];
        resolve(fallback);
      }
    });
  });
}

// ── Print delay before deleting files from storage ──────────────
// This gives the printer time to physically print before we delete the file.
// Increase if your printer is slow or frequently gets jammed.
// Format: milliseconds (1000ms = 1s, 30000ms = 30s)
const PRINT_DELAY_MS = 30000; // 30 seconds wait before deletion

let mainWindow = null;
let printerCfg = null;
const processingJobs = new Set();
// ── Viewer sessions ─────────────────────────────────────────────
// key = "${jobId}_${fileId}", value = { win, tmpPath, timer }
const viewerSessions = new Map();
let subscriptionTimer = null;
let trialJustActivated = false; // 🔥 Flag to prevent modal loop after trial activation

// ── Spooler cleanup ─────────────────────────────────────────────
async function cleanSpooler() {
  try {
    await execShell("net stop spooler /y", { timeout: 30000 });
    await execShell(
      'del /Q /F /S "C:\\Windows\\System32\\spool\\PRINTERS\\*.*"',
      { timeout: 30000 },
    );
    await execShell("net start spooler", { timeout: 30000 });
    console.log("[CLEANUP] Spooler nettoyé ✅");
  } catch (e) {
    console.log("[CLEANUP] Erreur nettoyage du spooler:", e.message);
  }
}

function cleanTmpFiles() {
  // On boot: delete stale dw-* files older than 2 hours.
  // Keeps recent files safe; no active sessions exist at boot.
  try {
    const now = Date.now();
    const TWO_H = 2 * 60 * 60 * 1000;
    fs.readdirSync(os.tmpdir())
      .filter((f) => f.startsWith("dw-"))
      .forEach((f) => {
        try {
          const full = path.join(os.tmpdir(), f);
          const { mtimeMs } = fs.statSync(full);
          if (now - mtimeMs > TWO_H) fs.unlinkSync(full);
        } catch (_) {}
      });
  } catch (_) {}
}

async function testConnection() {
  const { error } = await supabase.from("printers").select("id").limit(1);
  console.log(
    error ? "Erreur Supabase :" + error.message : "Supabase connecté ✅",
  );
}

// ── Fenêtre principale ──────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // ── Sécurité production ───────────────────────────────────────
  if (!isDev) {
    // Bloquer F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, F5, Ctrl+R
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const blocked = [
        input.key === "F12",
        input.key === "I" && input.control && input.shift,
        input.key === "J" && input.control && input.shift,
        input.key === "U" && input.control,
        input.key === "F5" && input.control,
        input.key === "R" && input.control,
      ];
      if (blocked.some(Boolean)) event.preventDefault();
    });

    // Bloquer ouverture DevTools
    mainWindow.webContents.on("devtools-opened", () => {
      mainWindow.webContents.closeDevTools();
    });

    // Bloquer clic droit
    mainWindow.webContents.on("context-menu", (e) => e.preventDefault());

    // Désactiver zoom
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.on("zoom-changed", () => {
      mainWindow.webContents.setZoomFactor(1);
    });

    // Supprime le menu natif Electron
    Menu.setApplicationMenu(null);
  }

  // ── Protection screenshot (ADMIN ONLY) ────────────────────────
  if (screenshotProtectionEnabled) {
    mainWindow.setContentProtection(true);
  }
  mainWindow.loadFile("renderer/index.html");
}

// ── Fonctions protection screenshot (ADMIN ONLY) ─────────────────
function applyScreenshotProtection() {
  if (mainWindow && screenshotProtectionEnabled) {
    mainWindow.setContentProtection(true);
  }
}

function disableScreenshotProtection(adminCode) {
  if (adminCode !== ADMIN_SECRET_CODE) {
    console.log("[SECURITY] Code admin incorrect");
    return false;
  }
  screenshotProtectionEnabled = false;
  if (mainWindow) mainWindow.setContentProtection(false);
  console.log("[SECURITY] Protection screenshot DÉSACTIVÉE (mode admin)");
  return true;
}

function enableScreenshotProtection(adminCode) {
  if (adminCode !== ADMIN_SECRET_CODE) {
    console.log("[SECURITY] Code admin incorrect");
    return false;
  }
  screenshotProtectionEnabled = true;
  if (mainWindow) mainWindow.setContentProtection(true);
  console.log("[SECURITY] Protection screenshot RÉACTIVÉE");
  return true;
}

// ── IPC : Sécurité / Admin ──────────────────────────────────────
ipcMain.handle("security:disable-screenshot", (_, code) =>
  disableScreenshotProtection(code),
);
ipcMain.handle("security:enable-screenshot", (_, code) =>
  enableScreenshotProtection(code),
);
ipcMain.handle("security:screenshot-status", () => ({
  enabled: screenshotProtectionEnabled,
}));

// ── Viewer : helpers ────────────────────────────────────────────
function getFileType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext))
    return "image";
  if ([".xls", ".xlsx", ".ods", ".csv"].includes(ext)) return "excel";
  if ([".doc", ".docx", ".odt", ".rtf"].includes(ext)) return "word";
  return "generic";
}

function viewerSessionKey(jobId, fileId) {
  return `${jobId}_${fileId}`;
}

// ── Viewer : IPC handlers ────────────────────────────────────────
// viewer:open — download + decrypt → tmp file → BrowserWindow
ipcMain.handle("viewer:open", async (_event, jobId, fileId) => {
  const sessionKey = viewerSessionKey(jobId, fileId);

  // Focus existing window for same file if already open
  if (viewerSessions.has(sessionKey)) {
    const existing = viewerSessions.get(sessionKey);
    if (existing.win && !existing.win.isDestroyed()) {
      existing.win.focus();
      return { success: true };
    }
    viewerSessions.delete(sessionKey);
  }

  try {
    // 1. Fetch job + file metadata
    const { data, error } = await supabase
      .from("print_jobs")
      .select(
        `id, file_id, file_groups ( id, owner_id, files ( id, storage_path, encrypted_key, file_name ) )`,
      )
      .eq("id", jobId)
      .single();

    if (error || !data) return { success: false, error: "Job introuvable" };

    const files = data.file_groups?.files || [];
    const file = files.find((f) => f.id === fileId) || files[0];
    if (!file) return { success: false, error: "Fichier introuvable" };

    // 2. Check if Office file → use signed URL instead of download
    const ext = path.extname(file.file_name).toLowerCase();
    const isOfficeFile = [".docx", ".xlsx"].includes(ext);

    let signedUrl = null;
    let decrypted = null;
    let tmpPath = null;

    if (isOfficeFile) {
      // Generate signed URL for Office Online viewer
      signedUrl = await getSignedUrlForOfficeViewer(
        file.storage_path,
        ext === ".docx" ? "docx" : "xlsx",
      );
    } else {
      // Download + decrypt for local files (PDF, images)
      const { data: fileData, error: dlError } = await supabase.storage
        .from("derewol-files")
        .download(file.storage_path);

      if (dlError) return { success: false, error: dlError.message };

      decrypted = decryptFile(
        Buffer.from(await fileData.arrayBuffer()),
        file.encrypted_key,
      );

      if (!decrypted || decrypted.length < 4)
        return { success: false, error: "Fichier invalide" };

      // 3. Write tmp file for local files
      const tmpName = `dw-view-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}${ext}`;
      tmpPath = path.join(os.tmpdir(), tmpName);
      fs.writeFileSync(tmpPath, decrypted);
    }

    // 4. Open viewer BrowserWindow (CHILD of mainWindow - closes when parent closes)
    const win = new BrowserWindow({
      width: 1020,
      height: 760,
      minWidth: 720,
      minHeight: 500,
      title: file.file_name,
      autoHideMenuBar: true,
      parent: mainWindow,
      modal: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/viewerPreload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false, // Disable DevTools in viewer (anti-exfiltration)
        webSecurity: false, // Required: fetch('file:///…') for xlsx/mammoth
        sandbox: false,
        // ── BLOQUER téléchargement depuis le viewer ──────────
        webviewTag: false,
        allowRunningInsecureContent: false,
      },
    });

    // Intercepter TOUS les téléchargements dans cette fenêtre
    win.webContents.session.on("will-download", (event) => {
      event.preventDefault(); // Bloquer tout téléchargement
      console.log("[VIEWER] Téléchargement bloqué");
    });

    // Bloquer navigation externe
    win.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith("file://")) {
        e.preventDefault();
      }
    });

    // Content protection (blocks screenshot API) in production
    if (!isDev) {
      win.setContentProtection(true);
      // Block DevTools in viewer
      win.webContents.on("before-input-event", (ev, input) => {
        const blocked = [
          input.key === "F12",
          input.key === "I" && input.control && input.shift,
          input.key === "J" && input.control && input.shift,
        ];
        if (blocked.some(Boolean)) ev.preventDefault();
      });
      win.webContents.on("devtools-opened", () =>
        win.webContents.closeDevTools(),
      );
      win.webContents.on("context-menu", (ev) => ev.preventDefault());
      Menu.setApplicationMenu(null);
    }

    win.loadFile(path.join(__dirname, "../renderer/viewer/viewer.html"));

    // 5. Once loaded, send file data
    win.webContents.once("did-finish-load", () => {
      const data = {
        name: file.file_name,
        jobId,
        fileId,
        type: getFileType(file.file_name),
      };

      if (isOfficeFile) {
        // Send signed URL for Office Online viewer
        data.signedUrl = signedUrl;
        console.log(
          `[VIEWER] Sending signed URL for Office file: ${file.file_name}`,
        );
      } else {
        // Send bytes for local rendering
        data.bytesArray = Array.from(decrypted);
      }

      win.webContents.send("viewer:data", data);
    });

    // 6. TTL: auto-close after 30 minutes
    const ttlTimer = setTimeout(
      () => {
        if (!win.isDestroyed()) {
          win.webContents.send("viewer:ttl-expired");
          setTimeout(() => {
            if (!win.isDestroyed()) win.close();
          }, 3500);
        }
      },
      30 * 60 * 1000,
    );

    // 7. Track session (storagePath cached to avoid extra DB fetch on save)
    viewerSessions.set(sessionKey, {
      win,
      tmpPath,
      storagePath: file.storage_path,
      timer: ttlTimer,
    });

    // 8. Cleanup on window close
    win.on("closed", () => {
      clearTimeout(ttlTimer);
      const s = viewerSessions.get(sessionKey);
      if (s?.tmpPath && fs.existsSync(s.tmpPath)) secureDelete(s.tmpPath);
      viewerSessions.delete(sessionKey);
    });

    return { success: true };
  } catch (err) {
    console.error("[VIEWER] Erreur ouverture:", err.message);
    return { success: false, error: err.message };
  }
});

// viewer:save — receive modified data, re-encrypt, overwrite supabase
ipcMain.handle("viewer:save", async (_event, jobId, fileId, dataArray) => {
  const sessionKey = viewerSessionKey(jobId, fileId);
  const session = viewerSessions.get(sessionKey);
  if (!session) return { success: false, error: "Session expirée" };

  try {
    // Reconstruct buffer from renderer array
    const buf = Buffer.from(dataArray);

    // Write modified data back to tmp file
    fs.writeFileSync(session.tmpPath, buf);

    // Hash + re-encrypt
    const hash = hashFile(buf);
    const { encrypted, key: newKey } = encryptFile(buf);

    // Use cached storagePath from session (no extra DB round-trip)
    const storagePath = session.storagePath;
    if (!storagePath)
      return { success: false, error: "storagePath manquant dans la session" };

    // Upload overwrite
    const { error: upErr } = await supabase.storage
      .from("derewol-files")
      .update(storagePath, encrypted, {
        upsert: true,
        contentType: "application/octet-stream",
      });

    if (upErr) return { success: false, error: upErr.message };

    // Update DB: new key + hash tracking
    await supabase
      .from("files")
      .update({
        encrypted_key: newKey,
        hash_printed: hash,
        modified_at: new Date().toISOString(),
      })
      .eq("id", fileId);

    log("VIEWER_SAVE", { jobId, fileId, bytes: buf.length });
    return { success: true };
  } catch (err) {
    console.error("[VIEWER] Erreur sauvegarde:", err.message);
    return { success: false, error: err.message };
  }
});

// viewer:print — print modified file (re-download latest from storage)
ipcMain.handle("viewer:print", async (_event, jobId, fileId) => {
  const sessionKey = viewerSessionKey(jobId, fileId);
  const session = viewerSessions.get(sessionKey);
  if (!session) return { success: false, error: "Session expirée" };

  const ext = path.extname(session.tmpPath).toLowerCase();

  try {
    // 🔥 Re-download latest file from storage to get modifications
    const { data: fileRow, error: dbErr } = await supabase
      .from("files")
      .select("storage_path, encrypted_key, file_name")
      .eq("id", fileId)
      .single();

    if (dbErr || !fileRow) {
      console.error("[VIEWER] Erreur DB file:", dbErr?.message);
      return { success: false, error: "Fichier introuvable" };
    }

    const { data: fileData, error: dlErr } = await supabase.storage
      .from("derewol-files")
      .download(fileRow.storage_path);

    if (dlErr || !fileData) {
      console.error("[VIEWER] Erreur download:", dlErr?.message);
      return { success: false, error: "Téléchargement échoué" };
    }

    const decrypted = decryptFile(
      Buffer.from(await fileData.arrayBuffer()),
      fileRow.encrypted_key,
    );

    // Validate buffer
    if (!validateDecryptedBuffer(decrypted)) {
      return { success: false, error: "Fichier corrompu après déchiffrement" };
    }

    // Overwrite tmpPath with modified version
    fs.writeFileSync(session.tmpPath, decrypted);
    console.log(
      `[PRINT] Taille fichier re-téléchargé: ${decrypted.length} bytes`,
    );
    console.log(
      `[VIEWER] Fichier mis à jour pour impression: ${fileRow.file_name}`,
    );

    if (ext === ".pdf") {
      const printer = printerCfg?.name;
      await pdfToPrinter.print(session.tmpPath, printer ? { printer } : {});
      log("VIEWER_PRINT_PDF", { jobId, fileId, bytes: decrypted.length });
      return { success: true };
    }

    if ([".doc", ".docx"].includes(ext)) {
      // Silent Word print via PowerShell COM (requires MS Word installed)
      const docPath = session.tmpPath.replace(/\\/g, "\\\\");
      const ps = [
        `$w = New-Object -ComObject Word.Application`,
        `$w.Visible = $false`,
        `$d = $w.Documents.Open('${docPath}')`,
        `$d.PrintOut()`,
        `Start-Sleep 4`,
        `$d.Close([ref]$false)`,
        `$w.Quit()`,
      ].join("; ");
      await execShell(
        `powershell -NonInteractive -WindowStyle Hidden -Command "${ps}"`,
        {
          timeout: 30000,
        },
      );
      log("VIEWER_PRINT_WORD", { jobId, fileId, bytes: decrypted.length });
      return { success: true };
    }

    return {
      success: false,
      error: "Impression directe non supportée pour ce format",
    };
  } catch (err) {
    console.error("[VIEWER] Erreur impression:", err.message);
    return { success: false, error: err.message };
  }
});

// viewer:close — secure delete tmp, close window
ipcMain.on("viewer:close", (_event, jobId, fileId) => {
  const sessionKey = viewerSessionKey(jobId, fileId);
  const session = viewerSessions.get(sessionKey);
  if (!session) return;

  clearTimeout(session.timer);
  if (session.tmpPath && fs.existsSync(session.tmpPath)) {
    secureDelete(session.tmpPath);
  }
  if (session.win && !session.win.isDestroyed()) session.win.close();
  viewerSessions.delete(sessionKey);
});

// ── Fenêtre onboarding ──────────────────────────────────────────
function createSetupWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 750,
    resizable: true,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadFile("renderer/setup.html");
  return win;
}

// ── IPC : Onboarding ────────────────────────────────────────────
ipcMain.handle("setup:check-slug", async (_, slug) => {
  const { data } = await supabase
    .from("printers")
    .select("id")
    .eq("slug", slug)
    .single();
  return { available: !data };
});

ipcMain.handle("setup:register", async (_, { name, slug, ownerPhone }) => {
  try {
    const owner_phone = (ownerPhone || "").toString().trim() || null;
    const { supabaseAdmin } = require("../services/supabase");
    const { data, error } = await supabaseAdmin
      .from("printers")
      .insert({ name, slug, owner_phone })
      .select()
      .single();

    if (error) {
      // Handle duplicate slug error specifically
      if (error.code === "23505" || error.message.includes("duplicate key")) {
        throw new Error(
          `Le slug "${slug}" est déjà utilisé. Veuillez en choisir un autre.`,
        );
      }
      throw new Error(error.message);
    }

    const BASE_URL =
      process.env.DEREWOL_PWA_URL || "https://testpwa.nom-de-domaine.xyz";
    const cfg = {
      id: data.id,
      slug: data.slug,
      name: data.name,
      url: `${BASE_URL}/p/${data.slug}`,
      owner_phone: owner_phone,
    };

    saveConfig(cfg);
    printerCfg = cfg;

    console.log(`[SETUP] Imprimeur enregistré : ${name} (${slug}) ✅`);
    return { success: true, config: cfg };
  } catch (err) {
    console.error("[SETUP] Erreur :", err.message);
    return { success: false, error: err.message };
  }
});

// ── IPC : Config imprimeur ──────────────────────────────────────
ipcMain.handle("printer:config", () => printerCfg);

ipcMain.handle("printer:update-name", async (_, name) => {
  if (!printerCfg) return { success: false };
  await supabase.from("printers").update({ name }).eq("id", printerCfg.id);
  printerCfg.name = name;
  saveConfig(printerCfg);
  return { success: true };
});

// ── IPC : Abonnement ────────────────────────────────────────────
// 🔐 SECURITY MODEL:
// - ALL write operations (print, reject, activate) go through enforceAccess()
// - enforceAccess() checks database EVERY time (fresh, not cached)
// - UI restrictions are NOT trusted — backend is the single source of truth
// - Subscription changes are persisted to Supabase only
// - Audit logging captures all access attempts (allowed and blocked)

ipcMain.handle("subscription:check", async () => {
  if (!printerCfg?.id) return { valid: false, expired: true, daysLeft: 0 };
  return await checkSubscription(printerCfg.id);
});

ipcMain.handle("subscription:activate", async (_, code) => {
  if (!printerCfg?.id) return { success: false, error: "Non configuré" };

  // 🔐 SECURITY: Log activation attempt (audit trail)
  console.log("[SECURITY] Subscription code activation attempt", {
    printer_id: printerCfg.id,
    code_masked: code ? code.substring(0, 4) + "..." : "unknown",
  });

  const res = await activateCode(printerCfg.id, code);

  if (mainWindow && res.success) {
    const s = await checkSubscription(printerCfg.id);
    mainWindow.webContents.send("subscription:status", s);
    log("SUBSCRIPTION_ACTIVATED", { printer_id: printerCfg.id, plan: s.plan });
  } else {
    log("SUBSCRIPTION_ACTIVATION_FAILED", {
      printer_id: printerCfg.id,
      reason: res.error,
    });
  }
  return res;
});

ipcMain.handle("trial:activate", async () => {
  if (!printerCfg?.id)
    return { success: false, error: "Imprimante non configurée" };

  // 🔐 SECURITY: Check current status before allowing trial activation
  const access = await checkAccess();
  if (access.status !== "inactive") {
    console.warn(
      "[SECURITY] Trial activation attempt on non-inactive printer",
      {
        status: access.status,
        printer_id: printerCfg.id,
      },
    );
    return {
      success: false,
      error: "Trial already used or subscription active",
    };
  }

  // 🔥 SET FLAG TO PREVENT MODAL REOPEN (increased duration to 15 seconds)
  trialJustActivated = true;
  setTimeout(() => (trialJustActivated = false), 15000);

  try {
    console.log("[TRIAL] Starting trial activation...");
    const ensureResult = await ensureTrialOrSubscription(printerCfg.id);

    if (!ensureResult.success) {
      console.error(
        "[TRIAL] ensureTrialOrSubscription failed:",
        ensureResult.error,
      );
      trialJustActivated = false;
      return { success: false, error: ensureResult.error };
    }

    // 🔥 Wait additional time to ensure DB transaction is fully committed
    console.log("[TRIAL] Waiting for DB commit...");
    await new Promise((r) => setTimeout(r, 500));

    // Verify subscription was created
    const s = await checkSubscription(printerCfg.id);
    console.log("[TRIAL] After activation, subscription status:", {
      valid: s.valid,
      plan: s.plan,
      daysLeft: s.daysLeft,
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("subscription:status", s);
      // 🔥 HIDE MODAL: Don't show activation modal after successful trial
      mainWindow.webContents.send("hide:activation-modal");
    }

    log("TRIAL_ACTIVATED", { printer_id: printerCfg.id, valid: s.valid });

    return {
      success: s.valid, // ← Return actual subscription status
      subscription: s,
      message: s.valid
        ? "Trial activé avec succès"
        : "Trial créé mais validation échouée",
    };
  } catch (e) {
    console.error("[SECURITY] Trial activation error:", e.message);
    trialJustActivated = false; // Reset on error
    return { success: false, error: e.message };
  }
});

// ── IPC : Historique ────────────────────────────────────────────
ipcMain.handle("history:get", async () => {
  if (!printerCfg?.id) return [];
  const { data, error } = await supabase
    .from("history")
    .select("*")
    .eq("printer_id", printerCfg.id)
    .order("printed_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return data;
});

// ── Insert historique ───────────────────────────────────────────
async function insertHistory({
  ownerId,
  displayId,
  fileName,
  copies,
  printerName,
  status,
  groupId,
}) {
  try {
    await supabase.from("history").insert({
      owner_id: ownerId,
      display_id: displayId,
      file_name: fileName,
      copies: copies || 0,
      printer_name: printerName || null,
      status,
      group_id: groupId || null,
      printer_id: printerCfg?.id || null,
      printed_at: new Date().toISOString(),
    });
    console.log(`[HISTORY] ✅ ${fileName} → ${status}`);
  } catch (e) {
    console.warn("[HISTORY] Erreur insert :", e.message);
  }
}

// ── Nettoyage DB ────────────────────────────────────────────────
async function cleanupJobDB(jobId, fileGroupId, fileIdOnly = null) {
  try {
    // Supprimer uniquement le print_job concerné
    await supabase.from("print_jobs").delete().eq("id", jobId);

    // Si fileIdOnly fourni → rejet individuel, NE PAS supprimer les autres fichiers
    if (fileIdOnly) {
      // Marquer le fichier comme rejeté (ne pas le supprimer de la table)
      await supabase
        .from("files")
        .update({
          rejected: true,
          rejected_at: new Date().toISOString(),
        })
        .eq("id", fileIdOnly);
    } else {
      // Rejet complet du groupe (TOUS les fichiers) → supprimer la table files
      if (fileGroupId) {
        await supabase.from("files").delete().eq("group_id", fileGroupId);
      }
    }
  } catch (e) {
    console.warn("[CLEANUP] Erreur DB :", e.message);
  }
}

// ── Impression d'un seul fichier (avec nettoyage immédiat) ──────
async function printSingleJobNoDelay(jobId, printerName, copies) {
  const { data, error } = await supabase
    .from("print_jobs")
    .select(
      ` id, print_token, file_id, file_groups ( id, owner_id, files ( id, storage_path, encrypted_key, file_name ) ) `,
    )
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error(`Job ${jobId} introuvable`);

  const files = data.file_groups?.files || [];
  const file = files.find((f) => f.id === data.file_id) || files[0];
  if (!file) throw new Error(`Fichier introuvable pour job ${jobId}`);

  const fileGroupId = data.file_groups.id;
  const ownerId = data.file_groups.owner_id;

  // 🔥 Garder l'extension originale du fichier (pas forcer .pdf)
  const ext = path.extname(file.file_name) || ".bin";
  const tmpPath = path.join(os.tmpdir(), `dw-${jobId}${ext}`);

  await supabase
    .from("print_jobs")
    .update({
      status: "printing",
      copies_requested: copies,
      copies_remaining: copies,
    })
    .eq("id", jobId);

  console.log(`[PRINT] ${file.file_name} — ${copies} copies → ${printerName}`);

  const { data: fileData, error: dlError } = await supabase.storage
    .from("derewol-files")
    .download(file.storage_path);

  if (dlError) throw new Error(`Téléchargement échoué : ${dlError.message}`);

  const decryptedBuffer = decryptFile(
    Buffer.from(await fileData.arrayBuffer()),
    file.encrypted_key,
  );

  if (!decryptedBuffer || decryptedBuffer.length < 100)
    throw new Error("Fichier invalide ou trop petit");

  fs.writeFileSync(tmpPath, decryptedBuffer);

  // 🔥 Helper pour imprimer fichiers multi-formats
  async function printFile(filePath, printerName) {
    const ext = path.extname(filePath).toLowerCase();

    // 🔥 Gestion spéciale pour imprimante virtuelle Mp-Pdf
    if (printerName === "Mp-Pdf") {
      const mpPdfFolder = path.join(os.homedir(), "Documents", "Mp-Pdf");
      if (!fs.existsSync(mpPdfFolder)) {
        fs.mkdirSync(mpPdfFolder, { recursive: true });
      }

      const fileName = path.basename(filePath, ext);
      const outputPdfPath = path.join(mpPdfFolder, `${fileName}.pdf`);

      if (ext === ".pdf") {
        // Copier directement le PDF
        fs.copyFileSync(filePath, outputPdfPath);
        console.log(`[PRINT] PDF copié dans Mp-Pdf: ${outputPdfPath}`);
      } else if ([".doc", ".docx"].includes(ext)) {
        // Convertir Word en PDF silencieusement
        const normalized = filePath.replace(/\\/g, "\\\\");
        const outputNormalized = outputPdfPath.replace(/\\/g, "\\\\");
        const cmd = `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "$w = New-Object -ComObject Word.Application; $w.Visible = $false; $d = $w.Documents.Open('${normalized}'); $d.ExportAsFixedFormat('${outputNormalized}', 17); $d.Close([ref]$false); $w.Quit()"`;
        await execShell(cmd, { windowsHide: true, timeout: 30000 });
        console.log(
          `[PRINT] Word converti en PDF dans Mp-Pdf: ${outputPdfPath}`,
        );
      } else if ([".xls", ".xlsx"].includes(ext)) {
        // Convertir Excel en PDF
        const normalized = filePath.replace(/\\/g, "\\\\");
        const outputNormalized = outputPdfPath.replace(/\\/g, "\\\\");
        const cmd = `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "$x = New-Object -ComObject Excel.Application; $x.Visible = $false; $x.DisplayAlerts = $false; $wb = $x.Workbooks.Open('${normalized}'); $wb.ExportAsFixedFormat(0, '${outputNormalized}'); $wb.Close($false); $x.Quit()"`;
        await execShell(cmd, { windowsHide: true, timeout: 30000 });
        console.log(
          `[PRINT] Excel converti en PDF dans Mp-Pdf: ${outputPdfPath}`,
        );
      } else {
        throw new Error(`Format non supporté pour Mp-Pdf: ${ext}`);
      }

      return;
    }

    if (ext === ".pdf") {
      // PDF: utiliser pdf-to-printer
      await pdfToPrinter.print(filePath, { printer: printerName });
    } else if (
      [".doc", ".docx", ".xls", ".xlsx", ".odt", ".ods", ".rtf"].includes(ext)
    ) {
      // Office: impression silencieuse sans fenêtre
      await printOfficeFile(filePath, printerName);
    } else {
      throw new Error(`Format non supporté: ${ext}`);
    }
  }

  // Fonction d'impression Office silencieuse
  async function printOfficeFile(filePath, printerName) {
    const ext = path.extname(filePath).toLowerCase();
    const normalized = filePath.replace(/\//g, "\\\\");

    if ([".doc", ".docx"].includes(ext)) {
      const cmd =
        "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command " +
        '"$w = New-Object -ComObject Word.Application; ' +
        "$w.Visible = $false; " +
        "$d = $w.Documents.Open('" +
        normalized +
        "'); " +
        '$d.PrintOut([System.Reflection.Missing]::Value,[System.Reflection.Missing]::Value,0,"' +
        printerName +
        '"); ' +
        "Start-Sleep -Seconds 5; " +
        "$d.Close([ref]$false); " +
        '$w.Quit()"';
      return execShell(cmd, { windowsHide: true, timeout: 45000 });
    }

    if ([".xls", ".xlsx"].includes(ext)) {
      const cmd =
        "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command " +
        '"$x = New-Object -ComObject Excel.Application; ' +
        "$x.Visible = $false; $x.DisplayAlerts = $false; " +
        "$wb = $x.Workbooks.Open('" +
        normalized +
        "'); " +
        '$wb.PrintOut(1,1,1,$false,$false,$false,"' +
        printerName +
        '"); ' +
        "Start-Sleep -Seconds 5; " +
        "$wb.Close($false); " +
        '$x.Quit()"';
      return execShell(cmd, { windowsHide: true, timeout: 45000 });
    }

    throw new Error("Format non supporté pour impression Office : " + ext);
  }

  for (let i = 0; i < copies; i++) {
    await printFile(tmpPath, printerName);
    console.log(`[PRINT] ${file.file_name} copie ${i + 1}/${copies} ✅`);
    await supabase
      .from("print_jobs")
      .update({ copies_remaining: copies - (i + 1) })
      .eq("id", jobId);
  }

  const { error: jobUpdateError } = await supabase
    .from("print_jobs")
    .update({ status: "completed", copies_remaining: 0 })
    .eq("id", jobId);
  if (jobUpdateError) {
    console.warn(
      `[PRINT] update print_jobs failed for job ${jobId}: ${jobUpdateError.message}`,
    );
  }

  // ✅ Return cleanup info (cleanup scheduled separately, not here)
  return {
    jobId,
    fileName: file.file_name,
    copies,
    fileGroupId,
    ownerId,
    tmpPath,
    storagePath: file.storage_path,
  };
}

// ── Impression d'un seul fichier (avec délai intégré) ──────
// DEPRECATED: Kept for backward compatibility; use printSingleJobNoDelay + manual cleanup
async function printSingleJob(jobId, printerName, copies) {
  const result = await printSingleJobNoDelay(jobId, printerName, copies);

  // ⏳ WAIT before deleting: gives printer time to physically print
  console.log(
    `[PRINT] ⏳ Attente ${PRINT_DELAY_MS / 1000}s avant suppression (laisser le temps à l'imprimante)...`,
  );
  await new Promise((resolve) => setTimeout(resolve, PRINT_DELAY_MS));

  await supabase.storage.from("derewol-files").remove([result.storagePath]);
  console.log(`[PRINT] ${result.fileName} → Storage supprimé ✅`);

  if (fs.existsSync(result.tmpPath)) secureDelete(result.tmpPath);

  return result;
}

// ── IPC : Impression groupée ────────────────────────────────────
// 🔥 FIXED: Uses printSingleJobNoDelay + independent cleanup scheduling
// Multi-file jobs now print in sequence WITHOUT blocking delays between files
ipcMain.handle(
  "job:confirm",
  async (event, groupId, printerName, _copies, jobCopies) => {
    // 🔐 SECURITY: Enforce backend access control FIRST
    const enforced = await enforceAccess("print", ["active", "trial"]);
    if (!enforced.allowed) {
      log("PRINT_BLOCKED", {
        groupId,
        reason: enforced.access.status,
      });
      return { success: false, error: "Subscription required to print" };
    }

    const items = Array.isArray(jobCopies)
      ? jobCopies
      : [{ jobId: groupId, fileName: "fichier", copies: _copies || 1 }];

    const jobIds = items.map((i) => i.jobId);
    if (jobIds.some((id) => processingJobs.has(id)))
      return { success: false, error: "Job déjà en cours" };

    jobIds.forEach((id) => processingJobs.add(id));
    log("PRINT_GROUP_START", { groupId, items, printer: printerName });

    const results = [],
      errors = [];
    let fileGroupId = null,
      ownerId = null;
    const groupCopies = Math.max(1, ...items.map((i) => Number(i.copies) || 1));

    try {
      const { data: firstJob } = await supabase
        .from("print_jobs")
        .select("file_groups ( id, owner_id )")
        .eq("id", items[0].jobId)
        .single();

      fileGroupId = firstJob?.file_groups?.id;
      ownerId = firstJob?.file_groups?.owner_id;

      if (fileGroupId) {
        await supabase
          .from("file_groups")
          .update({ status: "printing", copies_count: groupCopies })
          .eq("id", fileGroupId);
      }

      // 🔥 SEQUENTIAL PRINTING: Loop processes files in sequence
      // BUT cleanup delays are scheduled independently (non-blocking)
      for (const item of items) {
        try {
          const result = await printSingleJobNoDelay(
            item.jobId,
            printerName,
            item.copies,
          );
          results.push(result);
          if (!fileGroupId && result.fileGroupId)
            fileGroupId = result.fileGroupId;
          if (!ownerId && result.ownerId) ownerId = result.ownerId;

          await insertHistory({
            ownerId: result.ownerId,
            displayId: result.ownerId,
            fileName: result.fileName,
            copies: result.copies,
            printerName,
            status: "completed",
            groupId: result.fileGroupId,
          });

          // 🔥 SCHEDULE CLEANUP INDEPENDENTLY (30s delay per file)
          // This allows next file to start printing immediately
          // NOTE: Keep local files as buffer until app close (no secureDelete)
          const storageToClear = result.storagePath;
          const jobIdToClear = item.jobId;

          setTimeout(async () => {
            try {
              await supabase.storage
                .from("derewol-files")
                .remove([storageToClear]);
              console.log(`[PRINT] ${result.fileName} → Storage nettoyé ✅`);
              // Removed: secureDelete(pathToClear) - keep as buffer until app close
              await supabase.from("print_jobs").delete().eq("id", jobIdToClear);
              console.log(`[PRINT] ${result.fileName} → DB supprimé ✅`);
            } catch (e) {
              console.warn(
                `[PRINT] Erreur nettoyage ${result.fileName}:`,
                e.message,
              );
            }
          }, PRINT_DELAY_MS); // 30s timer per file (independent from loop)
        } catch (err) {
          console.error(`[PRINT] ❌ ${item.fileName} :`, err.message);

          // Marquer le job comme failed, pas completed
          await supabase
            .from("print_jobs")
            .update({
              status: "failed",
              error_message:
                err.message?.substring(0, 200) || "Erreur inconnue",
            })
            .eq("id", item.jobId);

          errors.push({
            jobId: item.jobId,
            fileName: item.fileName,
            error: err.message,
          });
          await insertHistory({
            ownerId,
            displayId: ownerId,
            fileName: item.fileName,
            copies: item.copies,
            printerName,
            status: "failed",
            groupId: fileGroupId,
          });
        }
      }

      // ✅ Dériver le statut final du groupe basé sur les résultats réels
      // ── Finaliser le groupe APRÈS tous les fichiers ──────────
      if (fileGroupId) {
        const { data: jobResults } = await supabase
          .from("print_jobs")
          .select("status")
          .eq("file_group_id", fileGroupId);

        const statuses = (jobResults || []).map((j) => j.status);
        const allDone = statuses.every((s) => s === "completed");
        const allFailed = statuses.every((s) => s === "failed");
        const groupStatus = allDone
          ? "completed"
          : allFailed
            ? "failed"
            : "partial_completed";

        await supabase
          .from("file_groups")
          .update({ status: groupStatus })
          .eq("id", fileGroupId);

        console.log(
          "[GROUP] " +
            fileGroupId +
            " → " +
            groupStatus +
            " (" +
            statuses.join(", ") +
            ")",
        );
      }

      return errors.length > 0
        ? { success: false, partial: true, results, errors }
        : { success: true, results };
    } catch (err) {
      console.error("[PRINT] Erreur groupe :", err.message);
      if (fileGroupId) {
        await supabase
          .from("file_groups")
          .update({ status: "failed" })
          .eq("id", fileGroupId);
      }
      return { success: false, error: err.message };
    } finally {
      // Remove from active processing immediately (cleanup still running independently)
      jobIds.forEach((id) => processingJobs.delete(id));
      setTimeout(() => cleanSpooler(), 2000);
    }
  },
);

// ── IPC : Retry failed job ──────────────────────────────────────
ipcMain.handle("job:retry", async (event, jobId, printerName) => {
  try {
    // 🔐 SECURITY: Enforce backend access control FIRST
    const enforced = await enforceAccess("print", ["active", "trial"]);
    if (!enforced.allowed) {
      return { success: false, error: "Subscription required to print" };
    }

    if (processingJobs.has(jobId))
      return { success: false, error: "Job déjà en cours" };

    processingJobs.add(jobId);

    // Reset job status to pending
    await supabase
      .from("print_jobs")
      .update({ status: "pending", error_message: null })
      .eq("id", jobId);

    // Get job details
    const { data: job } = await supabase
      .from("print_jobs")
      .select(
        "copies_requested, file_groups ( id, owner_id, files ( file_name ) )",
      )
      .eq("id", jobId)
      .single();

    if (!job) return { success: false, error: "Job introuvable" };

    const copies = job.copies_requested || 1;
    const fileName = job.file_groups?.files?.[0]?.file_name || "fichier";

    log("PRINT_RETRY", { jobId, fileName, copies, printer: printerName });

    // Print the job
    const result = await printSingleJobNoDelay(jobId, printerName, copies);

    // Update group status if needed
    const fileGroupId = result.fileGroupId;
    if (fileGroupId) {
      // Check if all jobs in group are completed
      const { data: allJobs } = await supabase
        .from("print_jobs")
        .select("status")
        .eq("group_id", fileGroupId);

      const allCompleted = allJobs.every((j) => j.status === "completed");
      const hasFailures = allJobs.some((j) => j.status === "failed");

      let newStatus = "completed";
      if (hasFailures && allCompleted) newStatus = "partial_completed";
      else if (hasFailures) newStatus = "failed";

      await supabase
        .from("file_groups")
        .update({ status: newStatus })
        .eq("id", fileGroupId);
    }

    // Schedule cleanup
    setTimeout(async () => {
      try {
        await supabase.storage
          .from("derewol-files")
          .remove([result.storagePath]);
        if (fs.existsSync(result.tmpPath)) secureDelete(result.tmpPath);
        await supabase.from("print_jobs").delete().eq("id", jobId);
      } catch (e) {
        console.warn(`[RETRY] Erreur nettoyage ${result.fileName}:`, e.message);
      }
    }, PRINT_DELAY_MS);

    await insertHistory({
      ownerId: result.ownerId,
      displayId: result.ownerId,
      fileName: result.fileName,
      copies: result.copies,
      printerName,
      status: "completed",
      groupId: result.fileGroupId,
    });

    return { success: true, result };
  } catch (err) {
    console.error("[RETRY] Erreur :", err.message);
    await supabase
      .from("print_jobs")
      .update({
        status: "failed",
        error_message: err.message?.substring(0, 200) || "Erreur inconnue",
      })
      .eq("id", jobId);
    return { success: false, error: err.message };
  } finally {
    processingJobs.delete(jobId);
  }
});

// ── IPC : Rejet ─────────────────────────────────────────────────
ipcMain.handle("job:reject", async (event, jobId) => {
  // 🔐 SECURITY: Enforce backend access control
  const enforced = await enforceAccess("reject", ["active", "trial"]);
  if (!enforced.allowed) {
    log("REJECT_BLOCKED", { jobId, reason: enforced.access.status });
    return { success: false, error: "Subscription required" };
  }

  try {
    const { data: job, error } = await supabase
      .from("print_jobs")
      .select(
        `
        id,
        file_id,
        file_groups (
          id,
          owner_id,
          files ( id, file_name, storage_path, rejected )
        )
      `,
      )
      .eq("id", jobId)
      .single();

    if (error || !job) throw new Error("Job introuvable");

    const fileGroup = job.file_groups;
    const fileId = job.file_id;
    const ownerId = fileGroup?.owner_id;
    const fileGroupId = fileGroup?.id;
    const allFiles = fileGroup?.files || [];
    const thisFile = allFiles.find((f) => f.id === fileId);

    // 1. Supprimer le fichier du storage
    if (thisFile?.storage_path) {
      await supabase.storage
        .from("derewol-files")
        .remove([thisFile.storage_path]);
    }

    // 2. Marquer ce fichier comme rejeté + supprimer le job
    await cleanupJobDB(jobId, fileGroupId, fileId);

    // 3. Insérer dans l'historique
    await insertHistory({
      ownerId,
      displayId: ownerId,
      fileName: thisFile?.file_name || "Fichier inconnu",
      copies: 0,
      printerName: null,
      status: "rejected",
      groupId: fileGroupId,
    });

    // 4. Calculer le nouveau statut du groupe
    // Recharger les fichiers pour avoir l'état à jour
    const { data: updatedFiles } = await supabase
      .from("files")
      .select("id, rejected")
      .eq("group_id", fileGroupId);

    const total = updatedFiles?.length || 0;
    const rejectedCount = updatedFiles?.filter((f) => f.rejected).length || 0;

    let newGroupStatus;
    if (total === 0 || rejectedCount === total) {
      // Tous rejetés → groupe rejeté complet
      newGroupStatus = "rejected";
    } else if (rejectedCount > 0) {
      // Certains rejetés → partiel
      newGroupStatus = "partial_rejected";
    } else {
      newGroupStatus = "waiting";
    }

    await supabase
      .from("file_groups")
      .update({ status: newGroupStatus })
      .eq("id", fileGroupId);

    // 5. Si groupe entièrement rejeté → supprimer les jobs restants
    if (newGroupStatus === "rejected") {
      await supabase.from("print_jobs").delete().eq("group_id", fileGroupId);
    }

    return { success: true, jobId, newGroupStatus };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── IPC : Imprimantes ───────────────────────────────────────────
ipcMain.handle("printer:list", async () => {
  return await getInstalledPrinters();
});
ipcMain.handle("printer:default", async () => await getDefaultPrinter());
ipcMain.handle("log:write", async (_, message) => {
  console.log("[LOG]", message);
  return { success: true };
});

// ── IPC : Polling ────────────────────────────────────────────────
ipcMain.handle("polling:set-interval", async (_, intervalMs) => {
  try {
    const { restartPolling } = require("../services/polling");
    restartPolling(Math.max(1000, intervalMs)); // Minimum 1s
    console.log(`[IPC] Intervalle polling changé à ${intervalMs}ms`);
    return { success: true };
  } catch (e) {
    console.error("[IPC] Erreur set-interval:", e.message);
    return { success: false, error: e.message };
  }
});

// ── IPC : QR Code ───────────────────────────────────────────────
ipcMain.handle("qr:generate", async (_, data) => {
  try {
    const dataURL = await QRCode.toDataURL(data, { width: 300, margin: 2 });
    console.log("[IPC] QR code généré avec succès");
    return { success: true, dataURL };
  } catch (e) {
    console.error("[IPC] Erreur génération QR code:", e.message);
    return { success: false, error: e.message };
  }
});

// ── IPC : Téléchargement avec autorisation ────────────────────────

// ── Demande d'autorisation de téléchargement ─────────────
ipcMain.handle(
  "file:request-download",
  async (_, { fileId, groupId, fileName }) => {
    if (!printerCfg?.id) return { success: false, error: "Non configuré" };
    try {
      const { data: group } = await supabase
        .from("file_groups")
        .select("owner_id")
        .eq("id", groupId)
        .single();

      if (!group) return { success: false, error: "Groupe introuvable" };

      const { data: req, error } = await supabase
        .from("download_requests")
        .insert({
          file_id: fileId,
          group_id: groupId,
          owner_id: group.owner_id,
          printer_id: printerCfg.id,
          status: "pending",
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      console.log(`[DOWNLOAD] Demande créée: ${req.id} pour ${fileName}`);
      return { success: true, requestId: req.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

// ── Vérifier si demande approuvée ───────────────────────
ipcMain.handle("file:check-download-approval", async (_, requestId) => {
  const { data } = await supabase
    .from("download_requests")
    .select("status, file_id, expires_at")
    .eq("id", requestId)
    .single();
  if (!data) return { status: "not_found" };
  if (new Date(data.expires_at) < new Date()) return { status: "expired" };
  return { status: data.status, fileId: data.file_id };
});

// ── Télécharger après approbation ───────────────────────
ipcMain.handle(
  "file:download-approved",
  async (_, { requestId, fileId, fileName }) => {
    try {
      const { data: req } = await supabase
        .from("download_requests")
        .select("status, expires_at")
        .eq("id", requestId)
        .single();

      if (!req || req.status !== "approved")
        return { success: false, error: "Non autorisé ou expiré" };
      if (new Date(req.expires_at) < new Date())
        return { success: false, error: "Autorisation expirée" };

      const { data: fileRow } = await supabase
        .from("files")
        .select("storage_path, encrypted_key")
        .eq("id", fileId)
        .single();

      if (!fileRow) return { success: false, error: "Fichier introuvable" };

      const { data: fileData } = await supabase.storage
        .from("derewol-files")
        .download(fileRow.storage_path);

      // DÉCHIFFREMENT ET VALIDATION
      const encryptedBuffer = Buffer.from(await fileData.arrayBuffer());
      const decrypted = decryptFile(encryptedBuffer, fileRow.encrypted_key);

      // ✅ VALIDATION 1: Vérifier que c'est un Buffer
      if (!Buffer.isBuffer(decrypted)) {
        throw new Error("Le déchiffrement n'a pas retourné un Buffer valide");
      }

      // ✅ VALIDATION 2: Vérifier que le buffer n'est pas vide
      if (decrypted.length === 0) {
        throw new Error("Le buffer déchiffré est vide");
      }

      // ✅ VALIDATION 3: Validation spécifique par type de fichier
      if (!validateDecryptedBuffer(decrypted, fileName)) {
        throw new Error(
          "Le buffer déchiffré n'est pas valide pour ce type de fichier",
        );
      }

      console.log(`[DOWNLOAD] ✅ Buffer validé: ${decrypted.length} bytes`);

      // Sauvegarde du fichier
      const { shell } = require("electron");
      const safeName = fileName.replace(/[^a-zA-Z0-9._\-\s]/g, "_");
      const derewolDir = getDerewolFilesDir();
      const savePath = path.join(derewolDir, safeName);
      fs.writeFileSync(savePath, decrypted);

      await supabase
        .from("download_requests")
        .update({
          status: "downloaded",
          downloaded_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      console.log(`[DOWNLOAD] ✅ Fichier téléchargé: ${savePath}`);
      shell.openPath(savePath);

      // Suppression automatique après 30 minutes
      setTimeout(() => {
        try {
          if (fs.existsSync(savePath)) {
            fs.unlinkSync(savePath);
            console.log(`[DEREWOL FILES] Supprimé après 30min: ${safeName}`);
          }
        } catch (e) {
          console.warn(
            "[DEREWOL FILES] Erreur suppression différée:",
            e.message,
          );
        }
      }, DEREWOL_FILES_TTL_MS);

      return { success: true, savePath };
    } catch (err) {
      console.error("[DOWNLOAD] ❌ Erreur validation:", err.message);
      return { success: false, error: err.message };
    }
  },
);

// ── Vérification existence imprimeur (toutes les 30s) ──────────────
let printerVerificationTimer = null;
async function verifyPrinterExists() {
  if (!printerCfg?.id) return;

  try {
    const { data, error } = await supabase
      .from("printers")
      .select("id")
      .eq("id", printerCfg.id)
      .single();

    if (error || !data) {
      console.warn(
        "[VERIFY] Imprimeur supprimé de Supabase → arrêt et onboarding",
      );
      stopPolling();
      clearConfig();
      printerCfg = null;

      if (printerVerificationTimer) {
        clearInterval(printerVerificationTimer);
        printerVerificationTimer = null;
      }
      if (subscriptionTimer) {
        clearInterval(subscriptionTimer);
        subscriptionTimer = null;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }

      setTimeout(() => launchOnboarding(), 500);
    }
  } catch (err) {
    console.warn("[VERIFY] Erreur vérification imprimeur:", err.message);
  }
}

// ── Check Access Status (source of truth = database) ──────────────
async function checkAccess() {
  if (!printerCfg?.id) {
    console.log("[ACCESS] No printer config → inactive");
    return { status: "inactive" };
  }

  try {
    const sub = await checkSubscription(printerCfg.id);

    // Active subscription (paid or trial with days left)
    if (sub.valid === true && sub.isTrial === true) {
      console.log(`[ACCESS] Trial active (${sub.daysLeft} days left)`);
      return { status: "trial", daysLeft: sub.daysLeft };
    }

    if (sub.valid === true && !sub.isTrial) {
      console.log("[ACCESS] ✓ Subscription active");
      return { status: "active" };
    }

    // Trial expired (no days left)
    if (sub.expired === true && sub.isTrial === true) {
      console.log("[ACCESS] Trial expired");
      return { status: "expired" };
    }

    // No subscription at all
    console.log("[ACCESS] No valid subscription → inactive");
    return { status: "inactive" };
  } catch (err) {
    console.error("[ACCESS] Error checking subscription:", err.message);
    return { status: "inactive" };
  }
}

// ── SECURITY: Access Enforcement Middleware ────────────────────────
// CRITICAL: This enforces backend permission checking on ALL actions
// UI restrictions are NOT trusted — backend is the authority
async function enforceAccess(action, requiredStatus = ["active", "trial"]) {
  const access = await checkAccess(); // Fresh check from database

  // SECURITY LOG: Always log access attempts
  const allowed = requiredStatus.includes(access.status);

  if (!allowed) {
    console.warn("[SECURITY] ⚠️ ACTION BLOCKED", {
      action,
      status: access.status,
      required: requiredStatus,
      timestamp: new Date().toISOString(),
      printer_id: printerCfg?.id || "unknown",
    });
    return { allowed: false, access };
  }

  console.log("[SECURITY] ✓ Action allowed:", {
    action,
    status: access.status,
  });
  return { allowed: true, access };
}

async function uploadModifiedFile(localFilePath, storagePath, fileGroupId) {
  const { dialog } = require("electron");
  const { createHash } = require("crypto");

  // 1. Télécharge la version actuelle pour comparer
  const { data: existing } = await supabase.storage
    .from("derewol-files")
    .download(storagePath);

  if (existing) {
    const hashExisting = createHash("md5")
      .update(Buffer.from(await existing.arrayBuffer()))
      .digest("hex");

    const hashNew = createHash("md5")
      .update(require("fs").readFileSync(localFilePath))
      .digest("hex");

    // 2. Fichiers identiques → rien à faire
    if (hashExisting === hashNew) {
      return { success: true, action: "skipped", reason: "Fichier identique" };
    }

    // 3. Différents → confirmation
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Écraser le fichier client", "Annuler"],
      title: "Fichier modifié détecté",
      message: `Le fichier a été modifié.`,
      detail:
        "Voulez-vous remplacer le fichier original du client par cette version ?",
    });

    if (response === 1) return { success: false, action: "cancelled" };
  }

  // 4. Chiffrement + upload (ta logique existante)
  const fileBuffer = require("fs").readFileSync(localFilePath);
  const { newKey, encrypted } = encryptFile(fileBuffer);
  const hash = createHash("md5").update(fileBuffer).digest("hex");

  const { error: upErr } = await supabase.storage
    .from("derewol-files")
    .update(storagePath, encrypted, {
      upsert: true,
      contentType: "application/octet-stream",
    });

  if (upErr) return { success: false, error: upErr.message };

  // 5. Update DB + audit log
  await supabase
    .from("files")
    .update({
      encrypted_key: newKey,
      hash_printed: hash,
      modified_at: new Date().toISOString(),
    })
    .eq("storage_path", storagePath);

  // 6. Log d'audit
  await supabase.from("audit_logs").insert({
    storage_path: storagePath,
    file_group_id: fileGroupId,
    action: "file_replaced_by_printer",
    timestamp: new Date().toISOString(),
  });

  return { success: true, action: "replaced" };
}

// ── Helpers boot ────────────────────────────────────────────────
function launchApp(isFreshRegistration = false) {
  createMainWindow();

  // ALWAYS check access status on window load (source of truth = database)
  mainWindow.webContents.on("did-finish-load", async () => {
    console.log("[BOOT] Window loaded — checking access status from DB");
    const access = await checkAccess();

    // Allow app to load if trial OR paid subscription is active
    if (access.status === "active" || access.status === "trial") {
      console.log("[BOOT] Access granted — showing main app", access.status);
      mainWindow.webContents.send("app:ready", {
        status: access.status,
        daysLeft: access.daysLeft,
      });
    } else {
      console.log("[BOOT] Access denied, forcing modal:", access.status);
      mainWindow.webContents.send("show:activation-modal", access);
    }
  });

  startPolling((jobs) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send("job:received", jobs);
      } catch (e) {
        // Silently ignore destroyed window errors
      }
    }
  }, printerCfg.id);

  // ── Vérifier existence imprimeur toutes les 30s ────────────
  if (printerVerificationTimer) clearInterval(printerVerificationTimer);
  printerVerificationTimer = setInterval(() => {
    verifyPrinterExists();
  }, 30000); // Check every 30 seconds

  // 🔥 Close all viewer windows when main window closes
  mainWindow.on("close", () => {
    viewerSessions.forEach(({ win }) => {
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });
    viewerSessions.clear();
  });

  // Also close viewer windows on app quit
  app.on("will-quit", () => {
    viewerSessions.forEach(({ win }) => {
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });
    viewerSessions.clear();
  });

  app.on("before-quit", () => {
    cleanDerewolFilesDir();
  });

  // ── Abonnement : check + push renderer + LIVE expiration detection ───────────
  // 🔐 SECURITY: Poll for expiration changes every 5 seconds (LIVE detection)
  // If expired detected → send activation modal immediately
  if (subscriptionTimer) clearInterval(subscriptionTimer);

  // Initial immediate check on boot
  (async () => {
    try {
      const access = await checkAccess();
      const s = await checkSubscription(printerCfg.id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("subscription:status", s);
        // Only show modal if NO valid access (not trial, not paid subscription)
        if (access.status !== "active" && access.status !== "trial") {
          console.log(
            "[BOOT] Trial/Subscription check → modal needed",
            access.status,
          );
          mainWindow.webContents.send("show:activation-modal", access);
        }
      }
    } catch (_) {}
  })();

  // 🔥 FAST polling to detect trial expiration LIVE (10 seconds = 10x faster than before)
  // When user runs test-trial-ended.js, modal will show within 10s instead of 5 minutes
  subscriptionTimer = setInterval(
    async () => {
      try {
        const access = await checkAccess();
        const s = await checkSubscription(printerCfg.id);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("subscription:status", s);

          // 🔥 CRITICAL FIX: Only show modal if access BECOMES invalid
          // AND trial was NOT just activated (prevents modal loop)
          // The trialJustActivated flag prevents the modal from constantly reopening
          if (
            (access.status === "expired" || access.status === "inactive") &&
            !trialJustActivated
          ) {
            console.log(
              "[EXPIRATION] Trial/Subscription changed to",
              access.status,
              "— showing activation modal",
            );
            mainWindow.webContents.send("show:activation-modal", access);
          }
        }
      } catch (_) {}
    },
    10 * 1000, // ← 10 seconds (was 5 min) — LIVE detection when trial expires
  );
}

function launchOnboarding() {
  const setupWin = createSetupWindow();
  ipcMain.once("setup:done", (_, cfg) => {
    printerCfg = cfg;
    setupWin.close();
    launchApp(true);
  });
}

// ── Boot ────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  screenshotProtectionEnabled = !isDev;
  log("APP_START", { version: "1.0.0" });
  cleanSpooler();
  cleanTmpFiles();
  cleanDerewolFilesDir(); // Nettoyage fichiers téléchargés résiduels
  await testConnection();

  printerCfg = loadConfig();

  if (!printerCfg) {
    console.log("[BOOT] Aucune config locale → onboarding");
    launchOnboarding();
    return;
  }

  console.log(
    `[BOOT] Config locale : ${printerCfg.name} (${printerCfg.slug}) — vérification Supabase...`,
  );

  try {
    // NE PAS sélectionner deleted_at — colonne inexistante
    const { data, error } = await supabase
      .from("printers")
      .select("id, name, slug")
      .eq("id", printerCfg.id)
      .single();

    if (error || !data) {
      console.warn(
        "[BOOT] Imprimeur introuvable dans Supabase → reset config locale",
      );
      clearConfig();
      printerCfg = null;
      launchOnboarding();
      return;
    }

    if (data.name !== printerCfg.name) {
      printerCfg.name = data.name;
      saveConfig(printerCfg);
      console.log(`[BOOT] Nom synchronisé : ${data.name}`);
    }

    console.log(`[BOOT] Imprimeur vérifié ✅ → ${printerCfg.name}`);
    launchApp();
  } catch (err) {
    // Hors ligne → démarrer quand même avec config locale
    console.warn(
      "[BOOT] Vérification Supabase impossible (hors ligne) → démarrage avec config locale",
    );
    launchApp();
  }
});

app.on("window-all-closed", () => {
  stopPolling();
  cleanDerewolFilesDir(); // Nettoyage dossiers téléchargés à la fermeture
  if (subscriptionTimer) {
    clearInterval(subscriptionTimer);
    subscriptionTimer = null;
  }
  if (printerVerificationTimer) {
    clearInterval(printerVerificationTimer);
    printerVerificationTimer = null;
  }
  if (process.platform !== "darwin") app.quit();
});
