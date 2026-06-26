const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const { exec, execSync } = require("child_process");
const {
  decryptFile,
  encryptFile,
  hashFile,
  secureDelete,
  validateDecryptedBuffer,
} = require("../services/crypto");
const SpoolerGuard = require("../lib/spoolerGuard.js");

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
  uploadTempPreview, // NOUVEAU
  cleanupTempPreview, // NOUVEAU
} = require("../services/supabase");
const { requestRecovery, verifyRecovery } = require("../services/recovery");
const { startPolling, stopPolling } = require("../services/polling");
const { log } = require("../services/logger");
const pdfToPrinter = require("pdf-to-printer");
const QRCode = require("qrcode");
const ExcelJS = require("exceljs");
const pdfCache = require("../services/pdfCache");
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
  analyzeDocument,
  analyzeExcel,
  ocrDocument,
  checkAICredits,
  addAICredits,
  improveOcrText,
} = require("../services/aiPrintAnalyzer");
const {
  extractTextFromImage,
  checkOCRCredits,
  makeSupabaseCreditDeductor,
} = require("../services/ocrModule");
const {
  checkPrinterStatus,
  debugListPrinters,
} = require("../services/printerStatusCheck");

function getPdfPageCount(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const str = buf.toString("binary");
    const matches = str.match(/\/Count\s+(\d+)/g);
    if (!matches) return null;
    const counts = matches.map((m) => parseInt(m.match(/\d+/)[0]));
    return Math.max(...counts);
  } catch {
    return null;
  }
}

async function getDecryptedAnthropicKey() {
  // 1. Variables d'environnement (dev)
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // 2. Fallback hardcodé (production embarquée)
  // ⚠️  IMPORTANT : Remplacer la valeur par votre vraie clé API
  if (process.env.ANTHROPIC_API_KEY_PROD) {
    console.warn("[MAIN] Utilisation de la clé Anthropic embarquée");
    return process.env.ANTHROPIC_API_KEY_PROD;
  }

  throw new Error(
    "ANTHROPIC_API_KEY manquante — configurez process.env.ANTHROPIC_API_KEY ou process.env.ANTHROPIC_API_KEY_PROD",
  );
}

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

async function forceDeleteWhenReleased(
  filePath,
  maxRetries = 24,
  intervalMs = 5000,
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      fs.writeFileSync(filePath, Buffer.alloc(fs.statSync(filePath).size)); // overwrite with zeros
      fs.unlinkSync(filePath);
      console.log("[SECURE DELETE] ✅ Deleted:", filePath);
      return true;
    } catch (err) {
      console.log(
        `[SECURE DELETE] Retry ${i + 1}/${maxRetries} — file locked:`,
        path.basename(filePath),
      );
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  console.error("[SECURE DELETE] ❌ FAILED after max retries:", filePath);
  return false;
}

async function cleanDerewolFilesDir() {
  try {
    const dir = getDerewolFilesDir();
    const files = fs.readdirSync(dir);
    let count = 0;
    for (const f of files) {
      const fp = path.join(dir, f);
      try {
        stopFileWatcher(fp);

        // Delete Excel lock file if it exists
        const lockFile = path.join(path.dirname(fp), "~$" + path.basename(fp));
        if (fs.existsSync(lockFile)) {
          try {
            fs.unlinkSync(lockFile);
            console.log("[SECURE DELETE] Deleted Excel lock file:", lockFile);
          } catch (lockErr) {
            console.warn(
              "[SECURE DELETE] Could not delete lock file:",
              lockFile,
            );
          }
        }

        // Use secure deletion with retries
        const deleted = await forceDeleteWhenReleased(fp);
        if (deleted) count++;
      } catch (e) {
        console.warn("[DEREWOL FILES] Impossible de supprimer:", fp);
      }
    }
    if (count > 0)
      console.log(
        `[DEREWOL FILES] ${count} fichier(s) supprimé(s) de manière sécurisée`,
      );
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
let isOfflineApp = false;
let lastActiveTabGlobal = "jobs"; // ─ Sauvegarde onglet actif côté main (résiste aux reload)
let isBooting = false; // Empêche le handler did-finish-load de se relancer pendant le boot
let hasReloadedAfterReconnect = false; // Empêche les reloads répétés après reconnexion
const processingJobs = new Set();
const spoolerGuard = new SpoolerGuard();

// ── Vérifier la connectivité réseau dynamiquement ──────────────────────────────
async function testConnectivity() {
  try {
    await fetch("https://www.google.com/favicon.ico", {
      signal: AbortSignal.timeout(3000),
      mode: "no-cors",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retourne le nom Windows exact de l'imprimante configurée.
 * Cherche dans les champs possibles de la config locale.
 * Retourne null si introuvable → WMI utilisera l'imprimante par défaut.
 */
function getPrinterWindowsName() {
  const candidates = [
    printerCfg?.windows_name,
    printerCfg?.printer_name,
    printerCfg?.display_name,
  ];

  const found = candidates.find(
    (value) => value && typeof value === "string" && value.trim().length > 0,
  );

  if (found) {
    console.log("[Main] getPrinterWindowsName() →", found.trim());
    return found.trim();
  }

  console.warn(
    "[Main] getPrinterWindowsName() → aucun nom trouvé, fallback imprimante par défaut",
  );
  return null;
}

// ── Viewer sessions ─────────────────────────────────────────────
// key = "${jobId}_${fileId}", value = { win, tmpPath, timer }
const viewerSessions = new Map();
// ── File watchers for automatic re-upload ───────────────────────
// key = filePath, value = { watcher, debounceTimer, fileId, storagePath, groupId }
const fileWatchers = new Map();
let subscriptionChannel = null;
let subscriptionPollingTimer = null; // ⏱️ Mini-polling de sécurité toutes les 60s
let trialJustActivated = false; // 🔥 Flag to prevent modal loop after trial activation

async function cleanupSubscriptionChannel() {
  if (!subscriptionChannel) return;
  try {
    // Utiliser unsubscribe() au lieu de removeChannel() pour éviter l'erreur "close is not a function"
    await subscriptionChannel.unsubscribe().catch(() => {});
    console.log("[SUB] Realtime subscription channel unsubscribed");
  } catch (err) {
    console.warn(
      "[SUB] Unable to cleanup realtime subscription channel:",
      err.message,
    );
  }
  subscriptionChannel = null;

  // Arrêter le mini-polling
  if (subscriptionPollingTimer) {
    clearInterval(subscriptionPollingTimer);
    subscriptionPollingTimer = null;
    console.log("[SUB] Subscription polling stopped");
  }
}

// ── Démarrer le mini-polling de sécurité (toutes les 60s) ─────
function startSubscriptionPolling() {
  if (subscriptionPollingTimer) {
    clearInterval(subscriptionPollingTimer);
  }

  subscriptionPollingTimer = setInterval(async () => {
    console.log("[SUB POLL] Vérification subscription...");
    if (isOfflineApp || !printerCfg?.id) {
      console.log("[SUB POLL] Skip — offline ou pas de config:", {
        isOfflineApp,
        printerId: printerCfg?.id,
      });
      return;
    }

    try {
      // Vérifier que la subscription existe toujours et est active
      const sub = await checkSubscription(printerCfg.id);
      console.log("[SUB POLL] Résultat checkSubscription:", {
        status: sub?.status,
        valid: sub?.valid,
      });

      if (!sub || sub.status !== "active") {
        console.warn(
          "[SUB] ⚠️ Mini-polling: Subscription n'existe plus ou inactive",
          {
            status: sub?.status || "deleted",
            valid: sub?.valid,
          },
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log("[SUB POLL] Envoi modal activation via polling");
          mainWindow.webContents.send("show:activation-modal", {
            status: sub?.status || "deleted",
            isRenewal: true,
          });
        } else {
          console.warn(
            "[SUB POLL] Impossible d'envoyer modal — mainWindow null ou détruit",
          );
        }
      }
    } catch (err) {
      console.error("[SUB] Mini-polling error:", err.message);
    }
  }, 60000); // Vérification toutes les 60 secondes
}

async function subscribeToSubscriptionChanges() {
  console.log("[SUB] Tentative souscription Realtime, printerCfg:", {
    id: printerCfg?.id,
    name: printerCfg?.name,
  });
  if (!printerCfg?.id) {
    console.warn(
      "[SUB] Skip souscription — printerCfg.id manquant, retry dans 1s",
    );
    setTimeout(() => {
      subscribeToSubscriptionChanges().catch((err) => {
        console.warn("[SUB] Retry failed:", err.message);
      });
    }, 1000);
    return;
  }
  await cleanupSubscriptionChannel();

  const channel = supabase.channel(`sub-watch-${printerCfg.id}`);
  console.log("[SUB] Canal créé:", `sub-watch-${printerCfg.id}`);

  // ── Écouter les UPDATE de subscription ──
  channel.on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "subscriptions",
      filter: `printer_id=eq.${printerCfg.id}`,
    },
    (payload) => {
      console.log("[SUB REALTIME] Événement UPDATE reçu:", payload);
      const status = payload?.new?.status;
      const expiresAt = payload?.new?.expires_at;
      const now = new Date();
      const isExpired =
        status !== "active" || (expiresAt && new Date(expiresAt) <= now);

      console.log("[SUB] Realtime UPDATE payload:", {
        status,
        expiresAt,
        isExpired,
      });

      if (isExpired && mainWindow && !mainWindow.isDestroyed()) {
        console.log("[SUB REALTIME] Envoi app:subscription-expired via UPDATE");
        mainWindow.webContents.send("app:subscription-expired");
      } else if (isExpired) {
        console.warn(
          "[SUB REALTIME] Impossible d'envoyer expiration — mainWindow null ou détruit",
        );
      }
    },
  );

  // ── Écouter les DELETE de subscription (suppression = accès révoqué) ──
  channel.on(
    "postgres_changes",
    {
      event: "DELETE",
      schema: "public",
      table: "subscriptions",
      filter: `printer_id=eq.${printerCfg.id}`,
    },
    (payload) => {
      console.log("[SUB REALTIME] DELETE détecté:", payload);
      console.warn(
        "[SUB] 🚨 Ligne subscription supprimée → accès révoqué immédiatement",
      );

      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log(
          "[SUB REALTIME] Envoi app:access-denied et modal via DELETE",
        );
        // Notifier l'app que l'accès a été supprimé
        mainWindow.webContents.send("app:access-denied", "deleted");

        // Afficher le modal d'activation avec status "deleted"
        mainWindow.webContents.send("show:activation-modal", {
          status: "deleted",
          isRenewal: true,
        });
      } else {
        console.warn(
          "[SUB REALTIME] Impossible d'envoyer modal — mainWindow null ou détruit",
        );
      }
    },
  );

  await channel.subscribe();
  subscriptionChannel = channel;
  console.log(
    "[SUB] Realtime subscription channel created for printer:",
    printerCfg.id,
  );

  // Démarrer le mini-polling de sécurité
  startSubscriptionPolling();
  console.log("[SUB] Mini-polling démarré (60s)");
}

function stopFileWatcher(filePath) {
  const entry = fileWatchers.get(filePath);
  if (!entry) return;

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  try {
    entry.watcher.close();
  } catch (_) {}
  fileWatchers.delete(filePath);
  console.log(`[WATCHER] Stopped for ${filePath}`);
}

function startFileWatcher(filePath, fileId, storagePath, groupId, mainWindow) {
  if (fileWatchers.has(filePath)) {
    stopFileWatcher(filePath);
  }

  const watcher = fs.watch(filePath, { persistent: false }, (eventType) => {
    if (eventType !== "change") return;

    const existing = fileWatchers.get(filePath);
    if (!existing) return;

    if (existing.debounceTimer) {
      clearTimeout(existing.debounceTimer);
    }

    existing.debounceTimer = setTimeout(() => {
      autoUpload(filePath, fileId, storagePath, groupId, mainWindow).catch(
        (err) => {
          console.error("[WATCHER] autoUpload error:", err.message);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("file:upload-fallback", {
              fileId,
              error: err.message,
            });
          }
        },
      );
    }, 2000);
  });

  watcher.on("error", (err) => {
    stopFileWatcher(filePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("file:upload-fallback", {
        fileId,
        error: err.message,
      });
    }
  });

  fileWatchers.set(filePath, {
    watcher,
    debounceTimer: null,
    fileId,
    storagePath,
    groupId,
  });
}

async function autoUpload(filePath, fileId, storagePath, groupId, mainWindow) {
  try {
    const buffer = fs.readFileSync(filePath);

    const { data: fileData } = await supabase
      .from("files")
      .select("encrypted_key")
      .eq("id", fileId)
      .single();

    const existingKey = fileData?.encrypted_key;
    const isPlaceholder =
      !existingKey || existingKey === "encrypted_key_placeholder";

    let encrypted, keyToSave;

    if (isPlaceholder) {
      // Pas de clé valide → générer une nouvelle clé et la sauvegarder
      const result = encryptFile(buffer);
      encrypted = result.encrypted;
      keyToSave = result.key;
      console.log("[WATCHER] Nouvelle clé AES générée pour fileId:", fileId);
    } else {
      // Clé existante → chiffrer avec la même clé (cohérence)
      const result = encryptFile(buffer, existingKey);
      encrypted = result.encrypted;
      keyToSave = null; // pas besoin de mettre à jour la clé
    }

    console.log(
      "[WATCHER] Chiffrement effectué — buffer original:",
      buffer.length,
      "bytes, encrypted:",
      encrypted.length,
      "bytes (overhead attendu: +28)",
    );

    console.log("[WATCHER] storagePath:", storagePath);
    console.log(
      "[WATCHER] Upload buffer size:",
      encrypted.length,
      "— original:",
      buffer.length,
    );

    const { error: uploadError, data: uploadData } = await supabase.storage
      .from("derewol-files")
      .upload(storagePath, encrypted, {
        upsert: true,
        contentType: "application/octet-stream",
      });

    console.log("[WATCHER] Upload result:", uploadData, uploadError?.message);

    if (uploadError) {
      console.error("[WATCHER] Upload failed:", uploadError.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("file:upload-fallback", {
          fileId,
          error: uploadError.message,
        });
      }
      return;
    }

    if (keyToSave) {
      const { error: keyUpdateError } = await supabase
        .from("files")
        .update({
          encrypted_key: keyToSave,
          modified_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      if (keyUpdateError) {
        console.warn(
          "[WATCHER] ⚠️ encrypted_key update échoué:",
          keyUpdateError.message,
        );
      } else {
        console.log(
          "[WATCHER] ✅ encrypted_key sauvegardée pour fileId:",
          fileId,
        );
      }
    }

    // ✅ FIX : Plus besoin de mettre à jour encrypted_key, elle reste la même
    const { error: dbError } = await supabase
      .from("files")
      .update({
        modified_at: new Date().toISOString(),
      })
      .eq("id", fileId);

    if (dbError) {
      console.error("[WATCHER] ❌ DB update failed:", dbError.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("file:upload-fallback", {
          fileId,
          error: "DB sync failed",
        });
      }
      return;
    }

    console.log(
      `[WATCHER] ✅ DB updated — same key preserved for ${fileId}: ${fileData.encrypted_key?.substring(0, 8)}...`,
    );

    await supabase
      .from("file_groups")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", groupId);

    try {
      await supabase.from("notifications").insert({
        type: "file_updated",
        file_id: fileId,
        group_id: groupId,
        message: "Votre fichier a été mis à jour par l'imprimeur",
        read: false,
        created_at: new Date().toISOString(),
      });
    } catch (notifyErr) {
      console.warn("[WATCHER] Notification insert failed:", notifyErr.message);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("file:upload-success", { fileId });
    }
    console.log(`[WATCHER] ✅ Auto-upload success for ${fileId}`);
  } catch (err) {
    console.error("[WATCHER] Auto-upload error:", err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("file:upload-fallback", {
        fileId,
        error: err.message,
      });
    }
  }
}

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

// ── Conversion Office → PDF pour viewer ────────────────────────
async function convertOfficeToPdfForViewer(inputPath, outputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  // Utiliser des slashes simples pour PowerShell
  const normalized = inputPath.replace(/\\/g, "/");
  const outputNormalized = outputPath.replace(/\\/g, "/");

  let cmd;
  if ([".doc", ".docx"].includes(ext)) {
    cmd =
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command ` +
      `"$w = New-Object -ComObject Word.Application; ` +
      `$w.Visible = $false; ` +
      `$d = $w.Documents.Open('${normalized}'); ` +
      `$d.ExportAsFixedFormat('${outputNormalized}', 17); ` +
      `$d.Close([ref]$false); ` +
      `$w.Quit()"`;
  } else if ([".xls", ".xlsx"].includes(ext)) {
    cmd =
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command ` +
      `"$x = New-Object -ComObject Excel.Application; ` +
      `$x.Visible = $false; $x.DisplayAlerts = $false; ` +
      `$wb = $x.Workbooks.Open('${normalized}'); ` +
      `foreach ($ws in $wb.Worksheets) { $ws.PageSetup.Orientation = 2; $ws.PageSetup.Zoom = $false; $ws.PageSetup.FitToPagesWide = 1; $ws.PageSetup.FitToPagesTall = 0 }; ` +
      `$wb.ExportAsFixedFormat(0, '${outputNormalized}'); ` +
      `$wb.Close($false); ` +
      `$x.Quit()"`;
  } else {
    throw new Error(`Format non supporté pour aperçu: ${ext}`);
  }

  console.log(`[OFFICE→PDF] Conversion ${ext} → PDF...`);
  await execShell(cmd, { windowsHide: true, timeout: 60000 });

  // Vérifier que le fichier existe et n'est pas vide
  if (!fs.existsSync(outputPath)) {
    throw new Error("Conversion PDF échouée — fichier non généré");
  }

  const size = fs.statSync(outputPath).size;
  console.log(`[OFFICE→PDF] ✅ PDF généré — taille: ${size} bytes`);

  if (size < 1000) {
    throw new Error(
      `PDF converti trop petit (${size} bytes) — conversion échouée`,
    );
  }
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

// ── IPC : Derewol AI ────────────────────────────────────────────
// Vérifier les crédits IA du printer
ipcMain.handle("ai:checkCredits", async (event, { printerId }) => {
  try {
    const data = await checkAICredits(printerId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Analyser un document PDF ou image
ipcMain.handle("ai:analyzeDocument", async (event, { filePath, printerId }) => {
  try {
    const data = await analyzeDocument(filePath, printerId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Analyser un fichier Excel
ipcMain.handle("ai:analyzeExcel", async (event, { filePath, printerId }) => {
  try {
    const data = await analyzeExcel(filePath, printerId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// OCR sur une image ou scan
ipcMain.handle("ai:ocrDocument", async (event, { filePath, printerId }) => {
  try {
    const data = await ocrDocument(filePath, printerId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Ajouter des crédits achetés
ipcMain.handle(
  "ai:addCredits",
  async (event, { printerId, credits, amountXof, paymentRef }) => {
    try {
      const data = await addAICredits(
        printerId,
        credits,
        amountXof,
        paymentRef,
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

// Handler pour ouvrir le sélecteur de fichier
ipcMain.handle("dialog:openFile", async (event, { filters }) => {
  const { dialog } = require("electron");
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters,
  });
  return result;
});

ipcMain.handle("file:getSize", async (_event, { filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: "Fichier introuvable" };
    }
    const size = fs.statSync(filePath).size;
    return { success: true, size };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("file:saveToAIFolder", async (_event, { tempFilePath }) => {
  try {
    if (!tempFilePath || !fs.existsSync(tempFilePath)) {
      return { success: false, error: "Fichier introuvable" };
    }
    const targetDir = path.join(app.getPath("documents"), "derewol-ai-files");
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, path.basename(tempFilePath));
    fs.copyFileSync(tempFilePath, targetPath);
    return { success: true, savedPath: targetPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("print:set-options", (_event, opts) => {
  global._filesPrintOptions = { ...global._filesPrintOptions, ...opts };
});

// Apply AI suggestions to an Excel file (creates a temp copy, does not modify original)
ipcMain.handle(
  "ai:applySuggestions",
  async (_event, { filePath, suggestions }) => {
    try {
      if (!filePath || !fs.existsSync(filePath))
        return { success: false, error: "Fichier introuvable" };

      const ext = path.extname(filePath).toLowerCase();
      if (![".xlsx", ".xls"].includes(ext))
        return {
          success: false,
          error:
            "Format non supporté — seul Excel (.xlsx/.xls) est pris en charge",
        };

      const derewolDir = getDerewolFilesDir();
      const base = path.basename(filePath, ext);
      const ts = Date.now();
      const tempFileName = `${base}-ai-applied-${ts}${ext}`;
      const tempFilePath = path.join(derewolDir, tempFileName);

      // Copy original to temp (never modify original)
      fs.copyFileSync(filePath, tempFilePath);

      // Helper: parse margin value into inches for Excel COM
      function parseMarginValue(val) {
        if (val === null || val === undefined) return null;
        if (typeof val === "number") return val; // assume already inches
        if (typeof val === "string") {
          const raw = val.trim().toLowerCase();
          // numeric with optional decimal/comma
          const maybeNum = parseFloat(raw.replace(",", "."));
          if (!isNaN(maybeNum)) {
            if (/cm\b/.test(raw)) return maybeNum / 2.54;
            if (/mm\b/.test(raw)) return maybeNum / 25.4;
            if (/in\b/.test(raw) || /inch/.test(raw) || /\"$/.test(raw))
              return maybeNum;
            // no unit: assume inches
            return maybeNum;
          }
          // fallback: try match value+unit
          const m = raw.match(
            /([0-9]+(?:[\.,][0-9]+)?)\s*(cm|mm|in|inch|inches)?/,
          );
          if (m) {
            const num = parseFloat(m[1].replace(",", "."));
            const unit = m[2];
            if (!unit) return num;
            if (unit.startsWith("cm")) return num / 2.54;
            if (unit.startsWith("mm")) return num / 25.4;
            return num; // inches
          }
        }
        return null;
      }

      // Convert margins to inches if present
      let marginsConverted = null;
      if (
        suggestions &&
        suggestions.margins &&
        typeof suggestions.margins === "object"
      ) {
        const m = suggestions.margins;
        marginsConverted = {
          left: parseMarginValue(m.left),
          right: parseMarginValue(m.right),
          top: parseMarginValue(m.top),
          bottom: parseMarginValue(m.bottom),
        };
        if (
          [
            marginsConverted.left,
            marginsConverted.right,
            marginsConverted.top,
            marginsConverted.bottom,
          ].every((v) => v === null)
        ) {
          marginsConverted = null;
        }
      }

      // Prepare suggestions copy for PowerShell (with converted margins)
      const suggestionsForPS = { ...suggestions, margins: marginsConverted };

      // Write suggestions JSON to temp file for PowerShell to read
      const suggJsonPath = path.join(
        derewolDir,
        `${base}-ai-suggestions-${ts}.json`,
      );
      fs.writeFileSync(
        suggJsonPath,
        JSON.stringify(suggestionsForPS, null, 2),
        "utf8",
      );

      // PowerShell script: open Excel COM, apply page setup per sheet, save and quit
      function escapeForPS(p) {
        return p.replace(/'/g, "''");
      }

      const psPath = path.join(derewolDir, `${base}-ai-apply-${ts}.ps1`);
      const tempNorm = escapeForPS(tempFilePath);
      const suggNorm = escapeForPS(suggJsonPath);

      const psScript = `
try {
  $ErrorActionPreference = 'Stop'
  $sugg = Get-Content -Raw -Path '${suggNorm}' | ConvertFrom-Json
  $x = New-Object -ComObject Excel.Application
} catch {
  Write-Output "ERROR: Excel COM not available or failed to create object: $($_.Exception.Message)"
  exit 2
}

$x.Visible = $false
$x.DisplayAlerts = $false

try {
  $wb = $x.Workbooks.Open('${tempNorm}')
  foreach ($ws in $wb.Worksheets) {
    # Orientation
    if ($sugg.orientation) {
      if ($sugg.orientation -match 'paysage|landscape') { $ws.PageSetup.Orientation = 2 } else { $ws.PageSetup.Orientation = 1 }
    }

    # FitToPages
    if ($sugg.fitToPages -eq $true) {
      $ws.PageSetup.Zoom = $false
      $ws.PageSetup.FitToPagesWide = 1
      $ws.PageSetup.FitToPagesTall = 0
    }

    # Scale (Zoom percent)
    if ($sugg.scale -and ($sugg.scale -is [int] -or $sugg.scale -is [double])) {
      try { $ws.PageSetup.Zoom = [int]$sugg.scale } catch {}
    }

    # Margins (expect object with keys left,right,top,bottom in cm or inches)
    if ($sugg.margins -and $sugg.margins -is [object]) {
      try {
        if ($sugg.margins.left) { $ws.PageSetup.LeftMargin = [double]$sugg.margins.left }
        if ($sugg.margins.right) { $ws.PageSetup.RightMargin = [double]$sugg.margins.right }
        if ($sugg.margins.top) { $ws.PageSetup.TopMargin = [double]$sugg.margins.top }
        if ($sugg.margins.bottom) { $ws.PageSetup.BottomMargin = [double]$sugg.margins.bottom }
      } catch { }
    }

    # Print area
    if ($sugg.printArea) {
      try { $ws.PageSetup.PrintArea = $sugg.printArea } catch { }
    }
  }

  $wb.Save()
  $wb.Close($false)
  $x.Quit()
  Write-Output "OK"
} catch {
  Write-Output "ERROR: $($_.Exception.Message)"
  try { $x.Quit() } catch {}
  exit 3
}
`;

      fs.writeFileSync(psPath, psScript, "utf8");

      // Execute the PowerShell script
      const cmd = `powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${psPath.replace(/"/g, '\\"')}"`;
      try {
        await execShell(cmd, { windowsHide: true, timeout: 120000 });
      } catch (err) {
        const msg = err?.message || String(err);
        return { success: false, error: `PowerShell/Excel error: ${msg}` };
      }

      // Append to local ai_applied_history.jsonl
      try {
        const hist = {
          original: filePath,
          temp: tempFilePath,
          suggestions,
          timestamp: new Date().toISOString(),
        };
        const hpath = path.join(derewolDir, "ai_applied_history.jsonl");
        fs.appendFileSync(hpath, JSON.stringify(hist) + "\n", "utf8");
        log("AI_APPLIED", hist);
      } catch (e) {
        console.warn("Failed to write AI history:", e.message);
      }

      return { success: true, tempFilePath };
    } catch (e) {
      console.error("ai:applySuggestions error:", e.message);
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("ai:applyExcelFull", async (_event, { filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: "Fichier introuvable" };
    }
    const ext = path.extname(filePath).toLowerCase();
    if (![".xlsx", ".xls"].includes(ext)) {
      return {
        success: false,
        error:
          "Format non supporté — seule la version Excel est prise en charge",
      };
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    workbook.eachSheet((sheet) => {
      const cols = sheet.columnCount || 0;
      const po = sheet.pageSetup || {};
      sheet.pageSetup = po;
      po.orientation = cols > 7 ? "landscape" : "portrait";
      po.fitToPage = true;
      po.fitToWidth = 1;
      po.fitToHeight = 0;
      po.horizontalCentered = true;
      po.verticalCentered = true;
      po.margins = {
        left: 0.5,
        right: 0.5,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3,
      };
      po.showGridLines = true;
      sheet.columns.forEach((col) => {
        let maxLen = 10;
        col.eachCell({ includeEmpty: false }, (cell) => {
          const value = cell.value;
          const length = value ? value.toString().length : 0;
          if (length > maxLen) {
            maxLen = length;
          }
        });
        col.width = Math.min(maxLen + 2, 40);
      });
      if (!po.printTitlesRow && sheet.rowCount > 0) {
        po.printTitlesRow = "1:1";
      }
    });

    const tempFilePath = path.join(os.tmpdir(), `dw-ai-${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(tempFilePath);
    return { success: true, tempFilePath };
  } catch (err) {
    console.error("ai:applyExcelFull error:", err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle(
  "ai:improveOcrText",
  async (_event, { text, docType, improvements, printerId }) => {
    try {
      if (!text) {
        return { success: false, error: "Texte OCR manquant" };
      }
      const data = await improveOcrText(text, docType, improvements, printerId);
      return { success: true, ...data };
    } catch (err) {
      console.error("ai:improveOcrText error:", err.message);
      return { success: false, error: err.message };
    }
  },
);

// Print a local temp file (convert to PDF if needed) and send to configured printer
ipcMain.handle("print:local", async (_event, { tempFilePath }) => {
  try {
    if (!tempFilePath || !fs.existsSync(tempFilePath))
      return { success: false, error: "Fichier introuvable" };
    const ext = path.extname(tempFilePath).toLowerCase();
    let pdfPath = tempFilePath;

    if ([".xlsx", ".xls", ".doc", ".docx"].includes(ext)) {
      // Convert to PDF using Office COM
      const outPdf = tempFilePath.replace(/\.[^.]+$/, ".pdf");
      const normalized = tempFilePath.replace(/'/g, "''");
      const outputNormalized = outPdf.replace(/'/g, "''");
      let cmd;
      if ([".doc", ".docx"].includes(ext)) {
        cmd = `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "$w = New-Object -ComObject Word.Application; $w.Visible = $false; $d = $w.Documents.Open('${normalized}'); $d.ExportAsFixedFormat('${outputNormalized}', 17); $d.Close([ref]$false); $w.Quit()"`;
      } else {
        cmd = `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "$x = New-Object -ComObject Excel.Application; $x.Visible = $false; $x.DisplayAlerts = $false; $wb = $x.Workbooks.Open('${normalized}'); $wb.ExportAsFixedFormat(0, '${outputNormalized}'); $wb.Close($false); $x.Quit()"`;
      }
      await execShell(cmd, { windowsHide: true, timeout: 120000 });
      pdfPath = outPdf;
    }

    // Use pdf-to-printer for printing PDFs
    if (path.extname(pdfPath).toLowerCase() !== ".pdf") {
      return {
        success: false,
        error: "Impossible de convertir en PDF pour l'impression",
      };
    }

    const printerName = getPrinterWindowsName();
    const printOpts = printerName ? { printer: printerName } : {};
    await pdfToPrinter.print(pdfPath, printOpts);

    return { success: true };
  } catch (e) {
    console.error("print:local error:", e.message);
    return { success: false, error: e.message };
  }
});

// Delete temporary file
ipcMain.handle("file:deleteTemp", async (_event, { tempFilePath }) => {
  try {
    if (!tempFilePath || !fs.existsSync(tempFilePath)) return { success: true };
    try {
      fs.unlinkSync(tempFilePath);
    } catch (err) {
      // Try secure delete helper
      await forceDeleteWhenReleased(tempFilePath);
    }
    return { success: true };
  } catch (e) {
    console.warn("file:deleteTemp error:", e.message);
    return { success: false, error: e.message };
  }
});

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
// viewer:open — download + decrypt → tmp file → BrowserWindow (100% local éphémère)
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

    // 2. Download + decrypt from derewol-files
    const { data: fileData, error: dlError } = await supabase.storage
      .from("derewol-files")
      .download(file.storage_path);

    if (dlError) return { success: false, error: dlError.message };

    const decrypted = decryptFile(
      Buffer.from(await fileData.arrayBuffer()),
      file.encrypted_key,
    );

    if (!decrypted || decrypted.length < 4) {
      return { success: false, error: "Fichier invalide ou corrompu" };
    }

    // 3. Détection type + conversion Office → PDF si nécessaire
    const ext = path.extname(file.file_name).toLowerCase();
    const OFFICE_EXTS = [".docx", ".xlsx", ".doc", ".xls"];
    const isOfficeFile = OFFICE_EXTS.includes(ext);

    let pdfTmpPath = null;
    const tmpName = `dw-view-${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}${ext}`;
    const tmpPath = path.join(os.tmpdir(), tmpName);
    fs.writeFileSync(tmpPath, decrypted);

    // 4. Ouvrir la fenêtre IMMÉDIATEMENT
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
        plugins: false,
        preload: path.join(__dirname, "../preload/viewerPreload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: false,
        webSecurity: false,
        sandbox: false,
        webviewTag: false,
        allowRunningInsecureContent: false,
      },
    });

    // ── Sécurité viewer ──────────────────────────────────────
    win.webContents.session.on("will-download", (event) => {
      event.preventDefault();
      console.log("[VIEWER] Téléchargement bloqué");
    });

    win.webContents.on("will-navigate", (e, url) => {
      if (!url.startsWith("file://")) e.preventDefault();
    });

    if (!isDev) {
      win.setContentProtection(true);
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

    // 1. DÉCLARER la fonction en premier
    const viewerReadyHandler = async (event) => {
      if (event.sender !== win.webContents) return;
      ipcMain.removeListener("viewer:ready", viewerReadyHandler);

      try {
        let viewerBytes = decrypted;
        let finalType = getFileType(file.file_name);

        if (isOfficeFile) {
          // ✅ Vérifier que la fenêtre est encore vivante avant d'envoyer
          if (win.isDestroyed()) return;
          event.sender.send("viewer:converting");

          const pdfTmpName = tmpName.replace(ext, ".pdf");
          pdfTmpPath = path.join(os.tmpdir(), pdfTmpName);

          await convertOfficeToPdfForViewer(tmpPath, pdfTmpPath);

          // ✅ Re-vérifier après l'await long
          if (win.isDestroyed()) return;

          try {
            if (fs.existsSync(tmpPath)) secureDelete(tmpPath);
          } catch (_) {}

          const s = viewerSessions.get(sessionKey);
          if (s) s.pdfTmpPath = pdfTmpPath;

          viewerBytes = fs.readFileSync(pdfTmpPath);
          finalType = "pdf";
        }

        console.log(
          "[VIEWER] Envoi données - type:",
          finalType,
          "bytes:",
          viewerBytes.length,
        );

        // ✅ Vérification finale avant send
        if (win.isDestroyed()) return;

        event.sender.send("viewer:data", {
          name: file.file_name,
          displayName: file.file_name,
          jobId,
          fileId,
          type: finalType,
          bytesArray: Array.from(viewerBytes),
        });
      } catch (err) {
        if (!win.isDestroyed()) {
          event.sender.send("viewer:error", err.message);
        }
      }
    };

    // 2. ENREGISTRER le handler
    ipcMain.on("viewer:ready", viewerReadyHandler);

    // 3. CHARGER la page en dernier
    win.loadFile(path.join(__dirname, "../renderer/viewer/viewer.html"));
    win.webContents.openDevTools();

    const sessionKey = viewerSessionKey(jobId, fileId);
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

    viewerSessions.set(sessionKey, {
      win,
      tmpPath,
      pdfTmpPath: null,
      timer: ttlTimer,
    });

    win.on("closed", () => {
      clearTimeout(ttlTimer);
      const s = viewerSessions.get(sessionKey);
      if (s?.tmpPath && fs.existsSync(s.tmpPath)) secureDelete(s.tmpPath);
      if (s?.pdfTmpPath && fs.existsSync(s.pdfTmpPath))
        secureDelete(s.pdfTmpPath);
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

  const printerName = printerCfg?.name;
  if (printerName) {
    const printerStatus = checkPrinterStatus(printerName);
    if (!printerStatus.online) {
      dialog.showErrorBox(
        "Impression bloquée",
        printerStatus.online === false
          ? "Imprimante non disponible"
          : "Erreur imprimante",
      );
      return { success: false, error: printerStatus.reason };
    }
  }

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

ipcMain.handle(
  "setup:register",
  async (_, { name, slug, ownerPhone, email }) => {
    try {
      const owner_phone = (ownerPhone || "").toString().trim() || null;
      const user_email = (email || "").toString().trim() || null;
      const { supabaseAdmin } = require("../services/supabase");
      const { data, error } = await supabaseAdmin
        .from("printers")
        .insert({ name, slug, owner_phone, email: user_email })
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
        process.env.DEREWOL_PWA_URL || "https://derewol.digitalesf.com";
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
  },
);

// ── IPC : Sauvegarde de l'onglet actif (restauration après reload) ────────────────────────
ipcMain.handle("app:save-active-tab", (_, tabName) => {
  if (tabName && typeof tabName === "string") {
    lastActiveTabGlobal = tabName;
    console.log("[APP] Onglet actif sauvegardé:", tabName);
  }
  return { success: true };
});

ipcMain.handle("app:get-active-tab", () => {
  return lastActiveTabGlobal;
});

// ── IPC : Config imprimeur ──────────────────────────────────────
ipcMain.handle("printer:config", () => {
  // Priorité : printerCfg en mémoire, sinon charger depuis disque
  const config = printerCfg || loadConfig();
  if (!config) {
    // Retourner objet avec null si aucune config trouvée
    return { name: null, slug: null, id: null };
  }
  return config;
});

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
  if (isOfflineApp) {
    return { valid: false, expired: true, daysLeft: 0, offline: true };
  }
  if (!printerCfg?.id) return { valid: false, expired: true, daysLeft: 0 };
  return await checkSubscription(printerCfg.id);
});

ipcMain.handle("subscription:activate", async (_, code) => {
  if (isOfflineApp) {
    return { success: false, error: "Mode hors ligne — activation impossible" };
  }
  if (!printerCfg?.id) return { success: false, error: "Non configuré" };

  // 🔐 SECURITY: Log activation attempt (audit trail)
  console.log("[SECURITY] Subscription code activation attempt", {
    printer_id: printerCfg.id,
    code_masked: code ? code.substring(0, 4) + "..." : "unknown",
  });

  const res = await activateCode(printerCfg.id, code);

  if (mainWindow && res.success) {
    const s = await checkSubscription(printerCfg.id);

    const planMonths =
      res.plan === "1month"
        ? 1
        : res.plan === "3months"
          ? 3
          : res.plan === "6months"
            ? 6
            : 1;

    try {
      console.log("[AI] Initialisation des crédits IA pour plan:", res.plan);
      await supabase.rpc("init_ai_credits_for_plan", {
        p_printer_id: printerCfg.id,
        p_plan_months: planMonths,
      });
      console.log("[AI] Crédits IA initialisés pour plan:", res.plan);
    } catch (rpcErr) {
      console.warn(
        "[AI] Échec initialisation crédits IA:",
        rpcErr.message || rpcErr,
      );
    }

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

ipcMain.handle("shell:openExternal", async (_, { url }) => {
  const { shell } = require("electron");
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle("trial:activate", async () => {
  if (isOfflineApp) {
    return { success: false, error: "Mode hors ligne — essai impossible" };
  }
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
  let data, error;

  // Tentative 1 : jointure directe via la FK de print_jobs.file_id
  ({ data, error } = await supabase
    .from("print_jobs")
    .select(
      `id, print_token, file_id, file_groups ( id, owner_id ), files!print_jobs_file_id_fkey ( id, storage_path, encrypted_key, file_name )`,
    )
    .eq("id", jobId)
    .single());

  if (error || !data) {
    // Option B : fallback fiable avec deux requêtes séparées
    const result = await supabase
      .from("print_jobs")
      .select(`id, print_token, file_id, file_groups ( id, owner_id )`)
      .eq("id", jobId)
      .single();

    if (result.error || !result.data) {
      throw new Error(`Job ${jobId} introuvable`);
    }

    data = result.data;

    const fileResult = await supabase
      .from("files")
      .select("id, storage_path, encrypted_key, file_name")
      .eq("id", data.file_id)
      .single();

    if (fileResult.error || !fileResult.data) {
      throw new Error(`Fichier introuvable pour job ${jobId}`);
    }

    data.files = fileResult.data;
  }

  if (!data) throw new Error(`Job ${jobId} introuvable`);

  const file = Array.isArray(data.files) ? data.files[0] : data.files || null;
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

  // Lire les options d'impression stockées par le modal
  const optKey = `${jobId}_${data.file_id}`;
  const printOpts = global._filesPrintOptions?.[optKey] || {};
  const orientation = printOpts.orientation || null; // "portrait" | "landscape" | null
  const duplex = printOpts.duplex || false;
  const pageRange =
    printOpts.pages === "range"
      ? { from: printOpts.pageFrom || 1, to: printOpts.pageTo || 999 }
      : null;
  console.log(`[PRINT] Options:`, { orientation, duplex, pageRange });

  const { data: signedData, error: signedError } = await supabase.storage
    .from("derewol-files")
    .createSignedUrl(file.storage_path, 60, {
      download: true,
      transform: { quality: 100 },
    });

  if (signedError)
    throw new Error(`URL signée échouée : ${signedError.message}`);

  const cacheBustedUrl = `${signedData.signedUrl}&cb=${Date.now()}`;
  const fetchResponse = await fetch(cacheBustedUrl);
  if (!fetchResponse.ok)
    throw new Error(`Téléchargement échoué : ${fetchResponse.status}`);
  const fileData = await fetchResponse.blob();

  console.log(
    `[DOWNLOAD] Fresh fetch — ${file.storage_path} — ${fileData.size} bytes`,
  );

  const decryptedBuffer = decryptFile(
    Buffer.from(await fileData.arrayBuffer()),
    file.encrypted_key,
  );

  if (!decryptedBuffer || decryptedBuffer.length < 100)
    throw new Error("Fichier invalide ou trop petit");

  fs.writeFileSync(tmpPath, decryptedBuffer);

  // 🔥 Helper pour imprimer fichiers multi-formats
  async function printFile(filePath, printerName, printOpts = {}) {
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
        const pageRange =
          printOpts.pages === "range"
            ? { from: printOpts.pageFrom || 1, to: printOpts.pageTo || 9999 }
            : null;
        if (pageRange) {
          await pdfToPrinter.print(filePath, {
            printer: "Mp-Pdf",
            pages: `${pageRange.from}-${pageRange.to}`,
          });
        } else {
          fs.copyFileSync(filePath, outputPdfPath);
        }
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
      const pageRange =
        printOpts.pages === "range"
          ? `${printOpts.pageFrom || 1}-${printOpts.pageTo || 9999}`
          : undefined;
      await pdfToPrinter.print(filePath, {
        printer: printerName,
        ...(pageRange && { pages: pageRange }),
      });
    } else if (
      [".doc", ".docx", ".xls", ".xlsx", ".odt", ".ods", ".rtf"].includes(ext)
    ) {
      // Office: impression silencieuse sans fenêtre
      await printOfficeFile(filePath, printerName, printOpts);
    } else {
      throw new Error(`Format non supporté: ${ext}`);
    }
  }

  // Fonction d'impression Office silencieuse
  async function printOfficeFile(filePath, printerName, printOpts = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const normalized = filePath.replace(/\//g, "\\");
    const fileEscaped = normalized.replace(/'/g, "''");
    const tmpPdf = filePath.replace(/\.[^.]+$/, "_print_tmp.pdf");
    const tmpPdfNorm = tmpPdf.replace(/\//g, "\\").replace(/'/g, "''");

    // Options d'impression
    const orientation = printOpts.orientation === "portrait" ? 1 : 2; // 1=portrait, 2=landscape
    const duplex = printOpts.duplex || false;
    const pageRange =
      printOpts.pages === "range"
        ? { from: printOpts.pageFrom || 1, to: printOpts.pageTo || 999 }
        : null;

    console.log(`[PRINT] Options appliquées:`, {
      orientation,
      duplex,
      pageRange,
    });

    let convertCmd;
    if ([".doc", ".docx"].includes(ext)) {
      const wordOrientation = printOpts.orientation === "landscape" ? 1 : 0;
      convertCmd =
        "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command " +
        '"$w = New-Object -ComObject Word.Application; ' +
        "$w.Visible = $false; " +
        "$d = $w.Documents.Open('" +
        fileEscaped +
        "'); " +
        `$d.PageSetup.Orientation = ${wordOrientation}; ` +
        (pageRange
          ? `$d.ExportAsFixedFormat('${tmpPdfNorm}', 17, $false, $false, 0, '', '', $false, $false, 1, $false, ${pageRange.from}, ${pageRange.to}); `
          : `$d.ExportAsFixedFormat('${tmpPdfNorm}', 17); `) +
        "$d.Close([ref]$false); " +
        '$w.Quit()"';
    } else if ([".xls", ".xlsx"].includes(ext)) {
      const excelOrientation = orientation; // 1=portrait, 2=landscape
      convertCmd =
        "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command " +
        '"$x = New-Object -ComObject Excel.Application; ' +
        "$x.Visible = $false; $x.DisplayAlerts = $false; " +
        "$wb = $x.Workbooks.Open('" +
        fileEscaped +
        "'); " +
        "foreach ($sheet in $wb.Sheets) { " +
        "  $sheet.PageSetup.Zoom = $false; " +
        "  $sheet.PageSetup.FitToPagesWide = 1; " +
        "  $sheet.PageSetup.FitToPagesTall = $false; " +
        `  $sheet.PageSetup.Orientation = ${excelOrientation}; ` +
        (duplex
          ? "  $sheet.PageSetup.OddAndEvenPagesHeaderFooter = $true; "
          : "") +
        "} " +
        "$wb.ExportAsFixedFormat(0, '" +
        tmpPdfNorm +
        "'); " +
        "$wb.Close($false); " +
        '$x.Quit()"';
    } else {
      throw new Error("Format non supporté : " + ext);
    }

    await execShell(convertCmd, { windowsHide: true, timeout: 60000 });

    if (!fs.existsSync(tmpPdf)) {
      throw new Error("Conversion PDF échouée : fichier non créé");
    }

    const pdfPrintOpts = { printer: printerName };
    if (duplex) {
      pdfPrintOpts.duplex = "long-edge";
    }

    try {
      await pdfToPrinter.print(tmpPdf, pdfPrintOpts);
    } finally {
      try {
        fs.unlinkSync(tmpPdf);
      } catch (_) {}
    }
  }

  for (let i = 0; i < copies; i++) {
    await printFile(tmpPath, printerName, printOpts);
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

  // Marquer le fichier comme imprimé (filet de sécurité pour le calcul de statut groupe)
  await supabase
    .from("files")
    .update({ hash_printed: "printed" })
    .eq("id", data.file_id);

  // ✅ Return cleanup info (cleanup scheduled separately, not here)
  return {
    jobId,
    fileId: data.file_id,
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

  await supabase.from("files").delete().eq("storage_path", result.storagePath);
  console.log(`[PRINT] ${result.fileName} → Storage supprimé via webhook ✅`);

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

    const printerStatus = await checkPrinterStatus(printerName);
    if (!printerStatus.online) {
      log("PRINT_BLOCKED", {
        groupId,
        printer: printerName,
        reason: printerStatus.dotState,
      });
      dialog.showErrorBox(
        "Impression bloquée",
        "Imprimante non disponible — vérifiez la connexion",
      );
      return { success: false, error: printerStatus.reason };
    }

    const items = Array.isArray(jobCopies)
      ? jobCopies
      : [{ jobId: groupId, fileName: "fichier", copies: _copies || 1 }];

    const jobIds = items.map((i) => i.jobId);
    if (jobIds.some((id) => processingJobs.has(id)))
      return { success: false, error: "Job déjà en cours" };

    jobIds.forEach((id) => processingJobs.add(id));

    // Vérifier les doublons dans le spooler
    // 🔥 BUG FIX: Skip guard for virtual printers (Mp-Pdf, etc.)
    const VIRTUAL_KEYWORDS = [
      "microsoft print to pdf",
      "onenote",
      "anydesk",
      "xps document writer",
      "fax",
      "mp-pdf",
      "mp pdf",
    ];
    const isVirtualPrinter = VIRTUAL_KEYWORDS.some((v) =>
      printerName.toLowerCase().includes(v.toLowerCase()),
    );

    for (const item of items) {
      const { data: jobData, error: jobError } = await supabase
        .from("print_jobs")
        .select(`file_id, files!print_jobs_file_id_fkey ( storage_path )`)
        .eq("id", item.jobId)
        .single();

      if (jobError || !jobData?.files?.storage_path) {
        console.warn(
          `[SPOOLER] Impossible de récupérer le chemin pour job ${item.jobId}`,
        );
        continue;
      }

      // Skip spooler guard for virtual printers
      if (!isVirtualPrinter) {
        const fileHash = crypto
          .createHash("md5")
          .update(jobData.files.storage_path)
          .digest("hex");

        try {
          const result = spoolerGuard.addToQueue({
            jobId: item.jobId,
            fileName: item.fileName,
            fileHash,
          });

          if (!result?.allow) {
            // BUG FIX: Use result.message with fallback, wrap in try/catch
            const errorMsg = result?.message || "Impression bloquée";
            log("PRINT_BLOCKED", {
              jobId: item.jobId,
              reason: "duplicate_job",
            });
            try {
              dialog.showErrorBox("Impression bloquée", errorMsg);
            } catch (e) {
              console.error("[PRINT] Erreur showErrorBox:", e.message);
            }
            return { success: false, error: errorMsg };
          }

          if (result?.action === "cancel_old") {
            console.log(`[SPOOLER] Ancien job annulé pour ${item.jobId}`);
          }
        } catch (guardErr) {
          const errorMsg = guardErr?.message || "Erreur vérification spooler";
          console.warn("[SPOOLER] addToQueue error:", errorMsg);
          try {
            dialog.showErrorBox("Erreur spooler", errorMsg);
          } catch (e) {
            console.error("[PRINT] Erreur showErrorBox:", e.message);
          }
          return { success: false, error: errorMsg };
        }
      } else {
        console.log(
          `[SPOOLER] ✅ Imprimante virtuelle ${printerName} → guard skipped`,
        );
      }
    }

    log("PRINT_GROUP_START", { groupId, items, printer: printerName });

    const results = [],
      errors = [];
    let fileGroupId = null,
      ownerId = null;

    const activeItems = items.filter(
      (i) =>
        i.status !== "completed" &&
        i.status !== "rejected" &&
        i.status !== "expired",
    );
    const groupCopies = Math.max(
      1,
      ...(activeItems.length > 0 ? activeItems : items).map(
        (i) => Number(i.copies) || 1,
      ),
    );

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

          // Cleanup direct storage
          try {
            if (result.storagePath) {
              await supabase.storage
                .from("derewol-files")
                .remove([result.storagePath]);
              console.log(`[PRINT] ${result.fileName} → Storage supprimé ✅`);
              pdfCache.delete(item.jobId);
            }
          } catch (e) {
            console.warn(
              `[PRINT] Erreur nettoyage ${result.fileName}:`,
              e.message,
            );
          }
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
        spoolerGuard.completeJob(item.jobId);
      }

      // ✅ Dériver le statut final du groupe basé sur les résultats réels
      // ── Finaliser le groupe APRÈS tous les fichiers ──────────
      if (fileGroupId) {
        const { data: jobResults } = await supabase
          .from("print_jobs")
          .select("status")
          .eq("group_id", fileGroupId);

        const statuses = (jobResults || []).map((j) => j.status);
        const relevantStatuses = statuses.filter((s) => s !== "queued");
        if (relevantStatuses.length === 0) {
          // Tous les jobs traités — marquer completed
          await supabase
            .from("file_groups")
            .update({ status: "completed" })
            .eq("id", fileGroupId);
          console.log(
            "[GROUP] " + fileGroupId + " → completed (all jobs done)",
          );
        } else {
          const allDone = relevantStatuses.every((s) => s === "completed");
          const allFailed = relevantStatuses.every((s) => s === "failed");
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

    const printerStatus = checkPrinterStatus(printerName);
    if (!printerStatus.online) {
      log("PRINT_BLOCKED", {
        jobId,
        printer: printerName,
        reason: printerStatus.dotState,
      });
      dialog.showErrorBox(
        "Impression bloquée",
        "Imprimante non disponible — vérifiez la connexion",
      );
      return { success: false, error: printerStatus.reason };
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
      .select("id, rejected, hash_printed")
      .eq("group_id", fileGroupId);

    const { data: completedJobs } = await supabase
      .from("print_jobs")
      .select("file_id")
      .eq("group_id", fileGroupId)
      .eq("status", "completed");

    const completedFileIds = new Set(
      completedJobs?.map((j) => j.file_id) || [],
    );
    console.log("[DEBUG job:reject] fileGroupId:", fileGroupId);
    console.log(
      "[DEBUG job:reject] updatedFiles:",
      JSON.stringify(updatedFiles),
    );
    console.log(
      "[DEBUG job:reject] completedJobs:",
      JSON.stringify(completedJobs),
    );
    console.log("[DEBUG job:reject] completedFileIds:", [...completedFileIds]);
    const total = updatedFiles?.length || 0;
    const rejectedCount = updatedFiles?.filter((f) => f.rejected).length || 0;
    const nonRejected = updatedFiles?.filter((f) => !f.rejected) || [];
    console.log("[DEBUG job:reject] nonRejected:", JSON.stringify(nonRejected));
    const allNonRejectedPrinted = nonRejected.every(
      (f) => completedFileIds.has(f.id) || f.hash_printed,
    );
    console.log(
      "[DEBUG job:reject] allNonRejectedPrinted:",
      allNonRejectedPrinted,
    );

    let newGroupStatus;
    if (total === 0 || rejectedCount === total) {
      // Tous rejetés → groupe rejeté complet
      newGroupStatus = "rejected";
    } else if (rejectedCount > 0) {
      // Certains rejetés, certains imprimés → partiel_rejected si tous les non-rejetés sont imprimés
      newGroupStatus = allNonRejectedPrinted ? "partial_rejected" : "waiting";
    } else {
      // Aucun rejeté → vérifier si tous sont imprimés
      newGroupStatus = allNonRejectedPrinted ? "completed" : "printing";
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

function filterPrintersForEnv(printerNames) {
  const VIRTUAL_KEYWORDS = [
    "microsoft print to pdf",
    "onenote",
    "anydesk",
    "xps document writer",
    "fax",
    "mp-pdf",
    "mp pdf",
  ];

  if (isDev) return printerNames;

  return printerNames.filter((printer) => {
    const name = typeof printer === "string" ? printer : printer?.name;
    if (!name) return false;
    const lower = name.toLowerCase();
    return !VIRTUAL_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
}

// ── IPC : Imprimantes ───────────────────────────────────────────
ipcMain.handle("printer:list", async () => {
  const printers = await getInstalledPrinters();
  return filterPrintersForEnv(printers);
});
ipcMain.handle("printer:default", async () => await getDefaultPrinter());
ipcMain.handle("printer:check-status", async (_event, printerName) => {
  console.log(
    "[Main] printer:check-status — printerName reçu du renderer:",
    printerName,
  );
  try {
    const nameToCheck = printerName || getPrinterWindowsName() || null;
    console.log("[Main] nameToCheck :", nameToCheck);
    const result = await checkPrinterStatus(nameToCheck);
    return result;
  } catch (err) {
    console.error("[Main] printer:check-status échoué :", err.message);
    return {
      online: false,
      status: null,
      name: null,
      method: "ipc-error",
      error: err.message,
    };
  }
});

// TEMP TEST — simulation d'une imprimante hors ligne
ipcMain.handle("printer:simulate-offline", async () => {
  console.log("[Test] Simulation imprimante hors ligne");
  return {
    online: false,
    status: 7,
    name: "NPIEEBED4 (HP LaserJet M402dn)",
    method: "wmi-simulated",
  };
});
ipcMain.handle("printer:debug-list", async () => {
  const names = await debugListPrinters();
  console.log("[Main] printer:debug-list :", names);
  return names;
});

ipcMain.handle("ai:analyze-document", async (_event, { filePath }) => {
  console.log("[Main] ai:analyze-document :", filePath);
  try {
    const apiKey = await getDecryptedAnthropicKey();
    const result = await analyzeDocumentForPrint(filePath, apiKey);
    return { success: true, data: result };
  } catch (err) {
    console.error("[Main] ai:analyze-document échoué :", err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("ai:analyze-excel", async (_event, { filePath }) => {
  console.log("[Main] ai:analyze-excel :", filePath);
  try {
    const apiKey = await getDecryptedAnthropicKey();
    const result = await analyzeExcel(filePath, apiKey);
    return { success: true, data: result };
  } catch (err) {
    console.error("[Main] ai:analyze-excel échoué :", err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("ocr:check-credits", async (_event, { userId }) => {
  console.log("[Main] ocr:check-credits userId:", userId);
  try {
    const result = await checkOCRCredits(supabase, userId);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, credits: 0, canUseOCR: false, error: err.message };
  }
});

ipcMain.handle(
  "ocr:extract-text",
  async (_event, { filePath, language, userId }) => {
    console.log(
      "[Main] ocr:extract-text :",
      filePath,
      "lang:",
      language,
      "userId:",
      userId,
    );
    try {
      const apiKey = await getDecryptedAnthropicKey();
      const creditDeductor = makeSupabaseCreditDeductor(supabase);
      const result = await extractTextFromImage({
        filePath,
        anthropicApiKey: apiKey,
        language: language ?? "fr",
        userId,
        onCreditDeduct: creditDeductor,
      });
      return { success: true, data: result };
    } catch (err) {
      console.error("[Main] ocr:extract-text échoué :", err.message);
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle("pdf:get-pages", (_event, fileId) => {
  console.log(`[IPC] getPdfPages called for fileId: ${fileId}`);
  console.log(`[IPC] Cache keys:`, Object.keys(pdfCache.getAll()));
  const result = pdfCache.get(fileId);
  console.log(`[IPC] returning: ${result} for fileId: ${fileId}`);
  return result;
});

// ── IPC : Fusion Preview - télécharge + déchiffre le fichier ────────────────────────────────────
ipcMain.handle("fusion:get-preview", async (event, fileId) => {
  try {
    // Récupérer le fichier depuis DB
    const { data: file, error: selectErr } = await supabase
      .from("files")
      .select("storage_path, encrypted_key, file_name")
      .eq("id", fileId)
      .single();

    if (selectErr || !file) {
      throw new Error(
        `Fichier ${fileId} introuvable: ${selectErr?.message || "pas de données"}`,
      );
    }

    // Créer une URL signée et ajouter cache-buster (même logique que printSingleJobNoDelay)
    const { data: signedData, error: signedErr } = await supabase.storage
      .from("derewol-files")
      .createSignedUrl(file.storage_path, 60, { download: true });

    if (signedErr || !signedData) {
      throw new Error(
        `Impossible créer signed URL pour ${file.storage_path}: ${signedErr?.message || "pas de données"}`,
      );
    }

    const cacheBustedUrl = `${signedData.signedUrl}&cb=${Date.now()}`;
    console.log(
      `[FUSION] Télécharger ${file.file_name} depuis ${file.storage_path}`,
    );

    const fetchResponse = await fetch(cacheBustedUrl);
    if (!fetchResponse.ok)
      throw new Error(`Fetch failed: ${fetchResponse.statusText}`);
    const arrayBuffer = await fetchResponse.arrayBuffer();

    // Déchiffrer
    const decrypted = decryptFile(Buffer.from(arrayBuffer), file.encrypted_key);
    if (!decrypted) {
      throw new Error("Déchiffrement échoué pour " + file.file_name);
    }

    // Retourner le buffer comme array pour sérialisation IPC
    console.log(
      `[FUSION] ✓ Fichier déchiffré: ${file.file_name} (${decrypted.length} bytes)`,
    );
    return {
      buffer: Array.from(decrypted),
      fileName: file.file_name,
    };
  } catch (err) {
    console.error("[FUSION] Erreur fusion:get-preview:", err.message);
    throw err;
  }
});

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
    // Accept a URL string (or fallback to string coercion)
    const urlStr = typeof data === "string" ? data : String(data || "");
    let urlObj;
    try {
      urlObj = new URL(urlStr);
    } catch (err) {
      // If not absolute, resolve against configured base
      const base =
        process.env.DEREWOL_PWA_URL || "https://derewol.digitalesf.com";
      urlObj = new URL(urlStr, base);
    }

    // Try to extract slug from /p/<slug>
    const parts = urlObj.pathname.split("/").filter(Boolean);
    let slug = null;
    if (parts.length >= 2 && parts[0] === "p") slug = parts[1];

    // If we have a slug, create a short-lived secure token and persist it
    if (slug) {
      try {
        const token = crypto.randomBytes(12).toString("hex");
        const tokenExpiresAt = new Date(
          Date.now() + 30 * 60 * 1000,
        ).toISOString(); // 30 minutes

        const { data: insertData, error: insertError } = await supabase
          .from("anon_sessions")
          .insert({
            qr_token: token,
            printer_slug: slug,
            token_expires_at: tokenExpiresAt,
            first_seen_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (!insertError) {
          // Append token as query param for the generated QR URL
          urlObj.searchParams.set("token", token);
        } else {
          console.warn("[IPC] QR token insertion failed:", insertError.message);
        }
      } catch (err) {
        console.warn("[IPC] Erreur création token QR:", err?.message || err);
      }
    }

    const dataURL = await QRCode.toDataURL(urlObj.toString(), {
      width: 300,
      margin: 2,
    });
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
        .select("storage_path, encrypted_key, group_id")
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
      startFileWatcher(
        savePath,
        fileId,
        fileRow.storage_path,
        fileRow.group_id,
        mainWindow,
      );

      // Suppression automatique après 30 minutes
      setTimeout(() => {
        try {
          if (fs.existsSync(savePath)) {
            stopFileWatcher(savePath);
            secureDelete(savePath);
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

ipcMain.handle(
  "fusion:generate",
  async (event, { pngData, fileName, sourceFiles }) => {
    try {
      log("FUSION_START", {
        fileName,
        sources: sourceFiles.map((f) => f.fileId),
      });

      const tmpDir = os.tmpdir();
      const pngPath = path.join(tmpDir, `fusion_${Date.now()}.png`);
      const pdfPath = path.join(tmpDir, `fusion_${Date.now()}.pdf`);

      fs.writeFileSync(pngPath, Buffer.from(pngData));
      await _pngToPdf(Buffer.from(pngData), pdfPath);

      const pdfBuffer = fs.readFileSync(pdfPath);

      const firstFile = sourceFiles[0];
      const storagePrefix = firstFile.storagePath
        ? firstFile.storagePath.substring(
            0,
            firstFile.storagePath.lastIndexOf("/") + 1,
          )
        : "";
      const newStoragePath = `${storagePrefix}${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("derewol-files")
        .upload(newStoragePath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload échoué: ${uploadError.message}`);

      const { data: firstJob, error: firstJobError } = await supabase
        .from("print_jobs")
        .select("group_id, file_groups(owner_id)")
        .eq("id", firstFile.jobId)
        .single();

      if (firstJobError)
        throw new Error(
          `Impossible de récupérer le job source: ${firstJobError.message}`,
        );

      const groupId = firstJob?.group_id;
      const ownerId = firstJob?.file_groups?.owner_id;

      const { data: newFile, error: insertError } = await supabase
        .from("files")
        .insert({
          file_name: fileName,
          storage_path: newStoragePath,
          group_id: groupId,
          encrypted_key: null,
          file_hash: null,
        })
        .select()
        .single();

      if (insertError)
        throw new Error(`Insert fichier échoué: ${insertError.message}`);

      // ✅ Réutilise le job du premier fichier source au lieu d'en créer un nouveau.
      const { error: updateJobError } = await supabase
        .from("print_jobs")
        .update({
          file_id: newFile.id,
          status: "queued",
          expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
          // copies_requested et copies_remaining inchangés — déjà à 1
        })
        .eq("id", firstFile.jobId);
      if (updateJobError)
        throw new Error(`Update job échoué: ${updateJobError.message}`);

      for (const src of sourceFiles) {
        if (src.jobId !== firstFile.jobId) {
          await supabase
            .from("print_jobs")
            .update({
              status: "completed",
              error_message: "Remplacé par fusion",
            })
            .eq("id", src.jobId);
        }

        await supabase.from("files").delete().eq("id", src.fileId);

        if (src.storagePath) {
          const { error: storageErr } = await supabase.storage
            .from("derewol-files")
            .remove([src.storagePath]);

          // ✅ LOG TEMPORAIRE — à retirer après debug
          if (storageErr) {
            console.error(
              `[FUSION] Storage delete FAILED for ${src.storagePath}:`,
              storageErr.message,
            );
          } else {
            console.log(`[FUSION] Storage delete OK: ${src.storagePath}`);
          }
        }

        pdfCache.delete(src.fileId);
      }

      await supabase
        .from("file_groups")
        .update({ files_count: 1 })
        .eq("id", groupId);

      try {
        fs.unlinkSync(pngPath);
      } catch (_) {}
      try {
        fs.unlinkSync(pdfPath);
      } catch (_) {}

      log("FUSION_SUCCESS", { fileName, newFileId: newFile.id });
      return { success: true, newFileId: newFile.id };
    } catch (err) {
      console.error("[FUSION] Erreur:", err.message);
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle("file:get-signed-url", async (event, fileId) => {
  try {
    const { data: file, error } = await supabase
      .from("files")
      .select("storage_path")
      .eq("id", fileId)
      .single();

    if (error) throw error;
    if (!file?.storage_path) throw new Error("Fichier introuvable");

    const { data: signed, error: signedError } = await supabase.storage
      .from("derewol-files")
      .createSignedUrl(file.storage_path, 300);

    if (signedError) throw signedError;
    return { success: true, url: signed.signedUrl };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Manuel upload fallback après échec automatique ───────────
ipcMain.handle(
  "file:manual-upload",
  async (_, { fileId, storagePath, groupId }) => {
    try {
      const { dialog } = require("electron");
      const selected = dialog.showOpenDialogSync({
        properties: ["openFile"],
      });

      if (!selected || selected.length === 0) {
        return { success: false, cancelled: true };
      }

      const localPath = selected[0];
      const fileBuffer = fs.readFileSync(localPath);
      const { encrypted, key } = encryptFile(fileBuffer);

      let targetStoragePath = storagePath;
      if (!targetStoragePath) {
        const { data: fileRow } = await supabase
          .from("files")
          .select("storage_path, group_id")
          .eq("id", fileId)
          .single();
        if (!fileRow) return { success: false, error: "Fichier introuvable" };
        targetStoragePath = fileRow.storage_path;
        if (!groupId) groupId = fileRow.group_id;
      }

      const { error: uploadError } = await supabase.storage
        .from("derewol-files")
        .update(targetStoragePath, encrypted, {
          upsert: true,
          contentType: "application/octet-stream",
        });

      if (uploadError) {
        return { success: false, error: uploadError.message };
      }

      const { error: updateKeyError } = await supabase
        .from("files")
        .update({
          encrypted_key: key,
          modified_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      if (updateKeyError) {
        console.error(
          "[MANUAL UPLOAD] ❌ encrypted_key update échoué:",
          updateKeyError.message,
        );
        return {
          success: false,
          error:
            "Clé de chiffrement non sauvegardée: " + updateKeyError.message,
        };
      }

      console.log(
        "[MANUAL UPLOAD] ✅ encrypted_key mis à jour pour fileId:",
        fileId,
      );

      try {
        await supabase.from("notifications").insert({
          type: "file_updated",
          file_id: fileId,
          group_id: groupId,
          message: "Votre fichier a été mis à jour par l'imprimeur",
          read: false,
          created_at: new Date().toISOString(),
        });
      } catch (notifyErr) {
        console.warn(
          "[MANUAL UPLOAD] Notification insert failed:",
          notifyErr.message,
        );
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

// ── RECOVERY ────────────────────────────────────────────────
ipcMain.handle("recovery:request", async (_, emailOrPhone) => {
  try {
    const result = await requestRecovery(emailOrPhone);
    return { success: true, method: result.method };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("recovery:verify", async (_, { emailOrPhone, code }) => {
  try {
    const { printer } = await verifyRecovery(emailOrPhone, code);
    console.log("[RECOVERY] printer reçu:", printer);
    const { saveConfig } = require("../services/printerConfig");
    const BASE_URL =
      process.env.DEREWOL_PWA_URL || "https://derewol.digitalesf.com";
    const cfg = {
      id: printer.id,
      slug: printer.slug,
      name: printer.name,
      url: `${BASE_URL}/p/${printer.slug}`,
      owner_phone: printer.owner_phone,
    };
    console.log("[RECOVERY] saveConfig appelé avec:", cfg);
    await saveConfig(cfg);
    console.log("[RECOVERY] config sauvegardée, relaunch dans 2s...");
    return { success: true, printer };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("app:relaunch", () => {
  console.log("[APP] Relancement demandé...");
  app.relaunch();
  app.exit(0);
});

ipcMain.handle("dev:logout", () => {
  clearConfig();
  app.relaunch();
  app.exit(0);
});

async function _pngToPdf(pngBuffer, outputPdfPath) {
  return new Promise((resolve, reject) => {
    try {
      // Lit les dimensions PNG directement depuis le buffer
      // Les bytes 16-24 d'un PNG contiennent width et height (IHDR chunk)
      const width = pngBuffer.readUInt32BE(16);
      const height = pngBuffer.readUInt32BE(20);

      // A4 en points (72 dpi) : 595.28 x 841.89
      const A4_W = 595.28;
      const A4_H = 841.89;

      const PDFDocument = require("pdfkit");
      const fs = require("fs");

      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        autoFirstPage: true,
      });

      const stream = fs.createWriteStream(outputPdfPath);
      doc.pipe(stream);

      // Calcule le scale pour fit A4 en gardant le ratio
      const scale = Math.min(A4_W / width, A4_H / height);
      const drawW = width * scale;
      const drawH = height * scale;
      const x = (A4_W - drawW) / 2;
      const y = (A4_H - drawH) / 2;

      doc.image(pngBuffer, x, y, { width: drawW, height: drawH });
      doc.end();

      stream.on("finish", resolve);
      stream.on("error", reject);
    } catch (err) {
      reject(new Error(`Erreur conversion PNG→PDF: ${err.message}`));
    }
  });
}

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

    if (error) {
      if (isNetworkError(error)) {
        // Erreur réseau — continuer en mode hors ligne
        console.warn("[VERIFY] Erreur réseau — mode hors ligne maintenu");
      } else {
        // Erreur Supabase (pas réseau) — compte probablement supprimé
        console.warn(
          "[VERIFY] Erreur Supabase — compte inexistant, reset config",
        );
        stopPolling();
        await cleanupSubscriptionChannel();
        clearConfig();
        printerCfg = null;

        if (printerVerificationTimer) {
          clearInterval(printerVerificationTimer);
          printerVerificationTimer = null;
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        }

        setTimeout(() => launchOnboarding(), 500);
      }
      return;
    }

    if (!data) {
      // Imprimeur introuvable (compte supprimé)
      console.warn(
        "[VERIFY] Imprimeur introuvable — compte n'existe plus, reset config",
      );
      stopPolling();
      await cleanupSubscriptionChannel();
      clearConfig();
      printerCfg = null;

      if (printerVerificationTimer) {
        clearInterval(printerVerificationTimer);
        printerVerificationTimer = null;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }

      setTimeout(() => launchOnboarding(), 500);
    }
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn("[VERIFY] Exception réseau — mode hors ligne maintenu");
    } else {
      console.error("[VERIFY] Exception inattendue:", err);
      // Traiter comme compte inexistant
      stopPolling();
      await cleanupSubscriptionChannel();
      clearConfig();
      printerCfg = null;

      if (printerVerificationTimer) {
        clearInterval(printerVerificationTimer);
        printerVerificationTimer = null;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }

      setTimeout(() => launchOnboarding(), 500);
    }
  }
}

// ── Check Access Status (source of truth = database) ──────────────
async function checkAccess(subscription = null) {
  if (isOfflineApp) {
    console.log("[ACCESS] Mode hors ligne — vérification suspendue");
    return { status: "offline", daysLeft: 0 };
  }

  if (!printerCfg?.id) {
    console.log("[ACCESS] No printer config → inactive");
    return { status: "inactive" };
  }

  try {
    const sub = subscription || (await checkSubscription(printerCfg.id));

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
function launchApp(
  isFreshRegistration = false,
  isOffline = false,
  skipPolling = false,
) {
  isOfflineApp = isOffline;

  // Si on lance normalement, arrêter le retry offline
  if (!isOffline && offlineRetryTimer) {
    clearInterval(offlineRetryTimer);
    offlineRetryTimer = null;
  }

  createMainWindow();
  console.log("[SUB WATCH] Lancement surveillance abonnement...");
  subscribeToSubscriptionChanges()
    .then(() => console.log("[SUB] subscribeToSubscriptionChanges appelée"))
    .catch((err) => {
      console.warn("[SUB] Failed to subscribe realtime updates:", err.message);
    });
  startSubscriptionPolling();
  console.log("[SUB POLL] startSubscriptionPolling appelée");

  // ALWAYS check access status on window load (source of truth = database)
  mainWindow.webContents.on("did-finish-load", async () => {
    if (isBooting) {
      console.log("[BOOT] Boot déjà en cours — skip did-finish-load");
      return;
    }

    isBooting = true;
    try {
      console.log("[BOOT] Window loaded — checking access status from DB");

      // ─ Ré-tester la connectivité au cas où l'utilisateur fait un reload manuel
      const isOnline = await testConnectivity();
      isOfflineApp = !isOnline;

      if (isOfflineApp) {
        console.log(
          "[BOOT] Mode hors ligne détecté (via test connectivité) — accès non vérifié",
        );
        mainWindow.webContents.send("app:ready", {
          status: "offline",
          daysLeft: 0,
          isOffline: true,
        });
        mainWindow.webContents.send(
          "app:offline-warning",
          "Mode hors ligne — vérification impossible",
        );
        return;
      }

      const access = await checkAccess();

      // Allow app to load if trial OR paid subscription is active
      if (access.status === "active" || access.status === "trial") {
        console.log("[BOOT] Access granted — showing main app", access.status);
        mainWindow.webContents.send("app:ready", {
          status: access.status,
          daysLeft: access.daysLeft,
          isOffline: false,
        });
        if (skipPolling) {
          mainWindow.webContents.send(
            "app:revoked-warning",
            "Accès suspendu — contactez Derewol",
          );
        }
      } else {
        console.log("[BOOT] Access denied, forcing modal:", access.status);
        mainWindow.webContents.send("show:activation-modal", access);
      }
    } finally {
      isBooting = false;
    }
  });

  if (!skipPolling) {
    startPolling((jobs) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send("job:received", jobs);
        } catch (e) {
          // Silently ignore destroyed window errors
        }
      }
    }, printerCfg.id);
  }

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

  app.on("before-quit", async () => {
    spoolerGuard.destroy();
    await cleanDerewolFilesDir();
  });

  // ── Abonnement : check + push renderer ──────────────────────────────
  // Initial immediate check on boot
  (async () => {
    try {
      if (isOfflineApp) {
        console.log("[BOOT] Skip subscription check en mode hors ligne");
        return;
      }
      const s = await checkSubscription(printerCfg.id);
      const access = await checkAccess(s);
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
}

function launchOnboarding() {
  const setupWin = createSetupWindow();
  ipcMain.once("setup:done", (_, cfg) => {
    printerCfg = cfg;
    setupWin.close();
    launchApp(true);
  });
}

// ── Fonction utilitaire pour détecter erreurs réseau ──────────────
function isNetworkError(err) {
  if (!err) return false;
  const msg = err.message || "";
  const code = err.code || "";
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    msg.includes("timeout")
  );
}

// ── Retry en arrière-plan pour mode hors ligne ───────────────────
let offlineRetryTimer = null;

async function startOfflineRetry() {
  if (offlineRetryTimer) clearInterval(offlineRetryTimer);
  offlineRetryTimer = setInterval(async () => {
    if (!printerCfg?.id) return;
    try {
      console.log("[OFFLINE RETRY] Tentative de vérification Supabase...");
      const { data, error } = await supabase
        .from("printers")
        .select("id, name, slug")
        .eq("id", printerCfg.id)
        .single();

      if (!error && data) {
        console.log("[OFFLINE RETRY] Connexion rétablie — synchronisation");
        isOfflineApp = false;
        if (data.name !== printerCfg.name) {
          printerCfg.name = data.name;
          saveConfig(printerCfg);
        }
        // Notifier l'app que la connexion est revenue
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("app:online");
          if (!hasReloadedAfterReconnect) {
            hasReloadedAfterReconnect = true;
            setTimeout(() => {
              hasReloadedAfterReconnect = false;
            }, 5000);
            try {
              mainWindow.webContents.reload();
            } catch (reloadErr) {
              console.warn(
                "[OFFLINE RETRY] Impossible de recharger la fenêtre:",
                reloadErr.message,
              );
            }
          }
        }
        clearInterval(offlineRetryTimer);
        offlineRetryTimer = null;
      }
    } catch (err) {
      // Continuer à réessayer
    }
  }, 30000); // Toutes les 30 secondes
}

// ── Boot ────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  screenshotProtectionEnabled = !isDev;
  log("APP_START", { version: "1.0.0" });
  cleanTmpFiles();
  await cleanDerewolFilesDir(); // Nettoyage fichiers téléchargés résiduels
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
    // Vérifier l'existence de l'imprimeur dans Supabase
    const { data, error } = await supabase
      .from("printers")
      .select("id, name, slug")
      .eq("id", printerCfg.id)
      .single();

    if (error) {
      if (isNetworkError(error)) {
        // Erreur réseau — mode hors ligne
        console.warn(
          "[BOOT] Erreur réseau — mode hors ligne, vérification impossible",
        );
        launchApp(false, true); // Mode offline
        startOfflineRetry();
      } else {
        // Erreur Supabase (pas réseau) — probablement compte supprimé
        console.warn(
          "[BOOT] Erreur Supabase — compte inexistant, reset config",
        );
        clearConfig();
        printerCfg = null;
        launchOnboarding();
      }
      return;
    }

    if (!data) {
      // Imprimeur introuvable (compte supprimé)
      console.warn(
        "[BOOT] Imprimeur introuvable — compte n'existe plus, reset config",
      );
      clearConfig();
      printerCfg = null;
      launchOnboarding();
      return;
    }

    if (data.revoked === true) {
      console.warn(
        "[BOOT] Imprimeur révoqué — accès suspendu, maintien de la config locale",
      );
      launchApp(false, false, true);
      return;
    }

    // Imprimeur trouvé — synchroniser le nom si nécessaire
    if (data.name !== printerCfg.name) {
      printerCfg.name = data.name;
      saveConfig(printerCfg);
      console.log(`[BOOT] Nom synchronisé : ${data.name}`);
    }

    console.log(`[BOOT] Imprimeur vérifié ✅ → ${printerCfg.name}`);
    launchApp();
  } catch (err) {
    if (isNetworkError(err)) {
      // Exception réseau — mode hors ligne
      console.warn("[BOOT] Exception réseau — mode hors ligne");
      launchApp(false, true);
      startOfflineRetry();
    } else {
      // Exception inattendue — traiter comme compte inexistant
      console.error("[BOOT] Exception inattendue:", err);
      clearConfig();
      printerCfg = null;
      launchOnboarding();
    }
  }
});

app.on("window-all-closed", async () => {
  stopPolling();
  await cleanDerewolFilesDir(); // Nettoyage dossiers téléchargés à la fermeture
  if (printerVerificationTimer) {
    clearInterval(printerVerificationTimer);
    printerVerificationTimer = null;
  }
  if (offlineRetryTimer) {
    clearInterval(offlineRetryTimer);
    offlineRetryTimer = null;
  }
  if (subscriptionChannel) {
    cleanupSubscriptionChannel().catch((err) => {
      console.warn("[SUB] Error cleaning up realtime channel:", err.message);
    });
  }
  if (process.platform !== "darwin") app.quit();
});
