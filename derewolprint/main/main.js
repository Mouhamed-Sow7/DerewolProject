const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execSync } = require("child_process");
const { decryptFile, secureDelete } = require("../services/crypto");
const supabase = require("../services/supabase");
const { startPolling, stopPolling } = require("../services/polling");
const { log } = require("../services/logger");
const pdfToPrinter = require("pdf-to-printer");
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

let mainWindow = null;
let printerCfg = null;
const processingJobs = new Set();
let subscriptionTimer = null;

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
  try {
    fs.readdirSync(os.tmpdir())
      .filter((f) => f.startsWith("dw-"))
      .forEach((f) => {
        try {
          fs.unlinkSync(path.join(os.tmpdir(), f));
        } catch (e) {}
      });
  } catch (e) {}
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

    if (error) throw new Error(error.message);

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
ipcMain.handle("subscription:check", async () => {
  if (!printerCfg?.id) return { valid: false, expired: true, daysLeft: 0 };
  return await checkSubscription(printerCfg.id);
});

ipcMain.handle("subscription:activate", async (_, code) => {
  if (!printerCfg?.id) return { success: false, error: "Non configuré" };
  const res = await activateCode(printerCfg.id, code);
  if (mainWindow && res.success) {
    const s = await checkSubscription(printerCfg.id);
    mainWindow.webContents.send("subscription:status", s);
  }
  return res;
});

ipcMain.handle("trial:activate", async () => {
  if (!printerCfg?.id)
    return { success: false, error: "Imprimante non configurée" };
  try {
    await ensureTrialOrSubscription(printerCfg.id);
    if (mainWindow) {
      const s = await checkSubscription(printerCfg.id);
      mainWindow.webContents.send("subscription:status", s);
    }
    return { success: true };
  } catch (e) {
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
async function cleanupJobDB(jobId, fileGroupId) {
  try {
    if (fileGroupId) {
      await supabase.from("files").delete().eq("group_id", fileGroupId);
    }
    await supabase.from("print_jobs").delete().eq("id", jobId);
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

  await supabase.storage.from("derewol-files").remove([file.storage_path]);
  console.log(`[PRINT] ${file.file_name} → Storage supprimé ✅`);

  if (fs.existsSync(tmpPath)) secureDelete(tmpPath);

  return { jobId, fileName: file.file_name, copies, fileGroupId, ownerId };
}

// ── IPC : Impression groupée ────────────────────────────────────
ipcMain.handle(
  "job:confirm",
  async (event, groupId, printerName, _copies, jobCopies) => {
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
          await insertHistory({
            ownerId,
            displayId: ownerId,
            fileName: item.fileName,
            copies: item.copies,
            printerName,
            status: "completed",
            groupId: fileGroupId,
          });
          await cleanupJobDB(item.jobId, fileGroupId);
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
          .update({ status: "completed" })
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
  try {
    const { data: job, error } = await supabase
      .from("print_jobs")
      .select(
        `id, file_groups ( id, owner_id, files ( id, file_name, storage_path ) )`,
      )
      .eq("id", jobId)
      .single();

    if (error || !job) throw new Error("Job introuvable");

    const fileGroup = job.file_groups;
    const file = fileGroup?.files?.[0];
    const ownerId = fileGroup?.owner_id;
    const fileGroupId = fileGroup?.id;

    if (file?.storage_path) {
      await supabase.storage.from("derewol-files").remove([file.storage_path]);
    }

    await insertHistory({
      ownerId,
      displayId: ownerId,
      fileName: file?.file_name || "Fichier inconnu",
      copies: 0,
      printerName: null,
      status: "rejected",
      groupId: fileGroupId,
    });

    await supabase
      .from("file_groups")
      .update({ status: "rejected" })
      .eq("id", fileGroupId);
    await cleanupJobDB(jobId, fileGroupId);

    return { success: true, jobId };
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

    if (sub.valid === true) {
      console.log("[ACCESS] ✓ Subscription active");
      return { status: "active" };
    }

    if (sub.trial_active === true) {
      const now = new Date();
      const expire = new Date(sub.trial_expires_at);

      if (now < expire) {
        const daysLeft = Math.ceil((expire - now) / (1000 * 60 * 60 * 24));
        console.log(`[ACCESS] Trial active (${daysLeft} days left)`);
        return {
          status: "trial",
          daysLeft,
          trial_expires_at: sub.trial_expires_at,
        };
      } else {
        console.log("[ACCESS] Trial expired");
        return { status: "expired" };
      }
    }

    console.log("[ACCESS] No valid subscription → inactive");
    return { status: "inactive" };
  } catch (err) {
    console.error("[ACCESS] Error checking subscription:", err.message);
    return { status: "inactive" };
  }
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

  // ── Abonnement : check + push renderer ─────────────────────
  if (subscriptionTimer) clearInterval(subscriptionTimer);
  (async () => {
    try {
      const s = await checkSubscription(printerCfg.id);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("subscription:status", s);
    } catch (_) {}
  })();
  subscriptionTimer = setInterval(
    async () => {
      try {
        const s = await checkSubscription(printerCfg.id);
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("subscription:status", s);
      } catch (_) {}
    },
    60 * 60 * 1000,
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
