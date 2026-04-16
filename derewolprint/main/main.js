const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execSync } = require("child_process");
const {
  decryptFile,
  encryptFile,
  hashFile,
  secureDelete,
} = require("../services/crypto");
const supabase = require("../services/supabase");
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
const {
  checkSubscription,
  activateCode,
  ensureTrialOrSubscription,
} = require("../services/subscription");

// ── Détection mode production/développement ─────────────────────
let isDev = process.env.NODE_ENV === "development";

// ── Protection screenshot (ADMIN ONLY - secret code required) ──
let screenshotProtectionEnabled = false; // sera mis à jour dans whenReady
const ADMIN_SECRET_CODE = "DEREWOL2026ADMIN"; // Secret code to disable protection

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
function cleanSpooler() {
  try {
    execSync("net stop spooler /y", { stdio: "ignore" });
    execSync('del /Q /F /S "C:\\Windows\\System32\\spool\\PRINTERS\\*.*"', {
      shell: true,
      stdio: "ignore",
    });
    execSync("net start spooler", { stdio: "ignore" });
    console.log("[CLEANUP] Spooler nettoyé ✅");
  } catch (e) {
    console.log("[CLEANUP] Spooler déjà propre");
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

    // 2. Download + decrypt
    const { data: fileData, error: dlError } = await supabase.storage
      .from("derewol-files")
      .download(file.storage_path);

    if (dlError) return { success: false, error: dlError.message };

    const decrypted = decryptFile(
      Buffer.from(await fileData.arrayBuffer()),
      file.encrypted_key,
    );

    if (!decrypted || decrypted.length < 4)
      return { success: false, error: "Fichier invalide" };

    // 3. Write tmp file (path only sent to viewer, never the buffer itself)
    const ext = path.extname(file.file_name) || ".bin";
    const tmpName = `dw-view-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}${ext}`;
    const tmpPath = path.join(os.tmpdir(), tmpName);
    fs.writeFileSync(tmpPath, decrypted);

    // 4. Open viewer BrowserWindow
    const win = new BrowserWindow({
      width: 1020,
      height: 760,
      minWidth: 720,
      minHeight: 500,
      title: file.file_name,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/viewerPreload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false, // Disable DevTools in viewer (anti-exfiltration)
        webSecurity: false, // Required: fetch('file:///…') for xlsx/mammoth
        sandbox: false,
      },
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

    // 5. Once loaded, send metadata (path only — no buffer in IPC)
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("viewer:data", {
        path: tmpPath,
        name: file.file_name,
        jobId,
        fileId,
        type: getFileType(file.file_name),
      });
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

// viewer:print — print original file from tmp path
ipcMain.handle("viewer:print", async (_event, jobId, fileId) => {
  const sessionKey = viewerSessionKey(jobId, fileId);
  const session = viewerSessions.get(sessionKey);
  if (!session) return { success: false, error: "Session expirée" };

  const ext = path.extname(session.tmpPath).toLowerCase();

  try {
    if (ext === ".pdf") {
      const printer = printerCfg?.name;
      await pdfToPrinter.print(session.tmpPath, printer ? { printer } : {});
      log("VIEWER_PRINT_PDF", { jobId, fileId });
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
      execSync(
        `powershell -NonInteractive -WindowStyle Hidden -Command "${ps}"`,
        {
          timeout: 30000,
          stdio: "ignore",
        },
      );
      log("VIEWER_PRINT_WORD", { jobId, fileId });
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
    const { data, error } = await supabase
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

  // 🔥 SET FLAG TO PREVENT MODAL REOPEN
  trialJustActivated = true;
  setTimeout(() => (trialJustActivated = false), 5000);

  try {
    await ensureTrialOrSubscription(printerCfg.id);
    if (mainWindow) {
      const s = await checkSubscription(printerCfg.id);
      mainWindow.webContents.send("subscription:status", s);
      // 🔥 HIDE MODAL: Don't show activation modal after successful trial
      mainWindow.webContents.send("hide:activation-modal");
    }
    log("TRIAL_ACTIVATED", { printer_id: printerCfg.id });
    return { success: true };
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

// ── Impression d'un seul fichier ────────────────────────────────
async function printSingleJob(jobId, printerName, copies) {
  const tmpPath = path.join(os.tmpdir(), `dw-${jobId}.pdf`);

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

  for (let i = 0; i < copies; i++) {
    await pdfToPrinter.print(tmpPath, { printer: printerName });
    console.log(`[PRINT] ${file.file_name} copie ${i + 1}/${copies} ✅`);
    await supabase
      .from("print_jobs")
      .update({ copies_remaining: copies - (i + 1) })
      .eq("id", jobId);
  }

  await supabase
    .from("print_jobs")
    .update({ status: "completed", copies_remaining: 0 })
    .eq("id", jobId);

  // ⏳ WAIT before deleting: gives printer time to physically print
  console.log(
    `[PRINT] ⏳ Attente ${PRINT_DELAY_MS / 1000}s avant suppression (laisser le temps à l'imprimante)...`,
  );
  await new Promise((resolve) => setTimeout(resolve, PRINT_DELAY_MS));

  await supabase.storage.from("derewol-files").remove([file.storage_path]);
  console.log(`[PRINT] ${file.file_name} → Storage supprimé ✅`);

  if (fs.existsSync(tmpPath)) secureDelete(tmpPath);

  return { jobId, fileName: file.file_name, copies, fileGroupId, ownerId };
}

// ── IPC : Impression groupée ────────────────────────────────────
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

      for (const item of items) {
        try {
          const result = await printSingleJob(
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
          await cleanupJobDB(item.jobId, result.fileGroupId);
        } catch (err) {
          console.error(`[PRINT] ❌ ${item.fileName} :`, err.message);
          errors.push({
            jobId: item.jobId,
            fileName: item.fileName,
            error: err.message,
          });
          // Mark job as failed in DB — do NOT delete it, do NOT delete storage
          await supabase
            .from("print_jobs")
            .update({ status: "failed" })
            .eq("id", item.jobId);
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

      if (fileGroupId) {
        await supabase
          .from("file_groups")
          .update({ status: "completed" })
          .eq("id", fileGroupId);
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
      jobIds.forEach((id) => processingJobs.delete(id));
      setTimeout(() => cleanSpooler(), 2000);
    }
  },
);

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
ipcMain.handle("printer:list", async () => await getAvailablePrinters());
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

// ── Helpers boot ────────────────────────────────────────────────
function launchApp(isFreshRegistration = false) {
  createMainWindow();

  // ALWAYS check access status on window load (source of truth = database)
  mainWindow.webContents.on("did-finish-load", async () => {
    console.log("[BOOT] Window loaded — checking access status from DB");
    const access = await checkAccess();

    if (access.status !== "active") {
      console.log("[BOOT] Access denied, forcing modal:", access.status);
      mainWindow.webContents.send("show:activation-modal", access);
    } else {
      console.log("[BOOT] Access granted — showing main app");
      mainWindow.webContents.send("app:ready", { status: "active" });
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
        // If expired or inactive, show modal
        if (access.status === "expired" || access.status === "inactive") {
          mainWindow.webContents.send("show:activation-modal", access);
        }
      }
    } catch (_) {}
  })();

  // Fast polling every 5 seconds to detect expiration changes LIVE
  subscriptionTimer = setInterval(
    async () => {
      try {
        const access = await checkAccess();
        const s = await checkSubscription(printerCfg.id);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("subscription:status", s);

          // 🔥 CRITICAL: If expired status detected → show modal immediately
          // BUT: Skip if trial was just activated (prevent loop)
          if (access.status === "expired" && !trialJustActivated) {
            console.log(
              "[EXPIRATION] Trial/Subscription expired — showing activation modal",
            );
            mainWindow.webContents.send("show:activation-modal", access);
          }
        }
      } catch (_) {}
    },
    5000, // ← 5 seconds for LIVE expiration detection
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
