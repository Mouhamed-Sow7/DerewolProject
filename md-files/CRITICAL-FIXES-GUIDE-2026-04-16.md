# 🔧 CRITICAL FIXES IMPLEMENTATION GUIDE

**Date**: April 16, 2026  
**Status**: Ready for deployment

---

## PRIORITY 1: EXECUTE SQL FIRST

Run this in Supabase SQL Editor:

```sql
-- Fix trial duration to 7 days
UPDATE subscriptions
SET duration_days = 7,
    expires_at = activated_at + INTERVAL '7 days'
WHERE plan = 'trial' AND duration_days = 15;

-- Create/update function
CREATE OR REPLACE FUNCTION create_trial_subscription(p_printer_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO subscriptions (
    printer_id, activation_code, plan, duration_days, amount,
    payment_method, status, activated_at, expires_at
  ) VALUES (
    p_printer_id,
    'TRIAL-' || UPPER(SUBSTRING(p_printer_id::text, 1, 8)),
    'trial', 7, 0, 'manual', 'active',
    NOW(), NOW() + INTERVAL '7 days'
  )
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;
```

---

## PRIORITY 2: BUG 1 FIX — Multi-File Printing (main/main.js)

**CONSOLIDATED LOGIC**: Separate printing from file cleanup delays.

**Key Changes:**

1. Remove 45-second delay from the printing loop
2. Create `printSingleJobNoDelay()` function (prints, returns paths for later cleanup)
3. Use `setTimeout()` for cleanup OUTSIDE the loop (non-blocking)
4. Mark files as `printing` → `completed` DURING printing
5. Clear `processingJobs` Set after all jobs submitted (not waiting for cleanup)

**Code blocks to replace in main/main.js:**

### Block A: Replace old `job:confirm` handler

Replace from line ~535 (the entire handler) with:

```javascript
ipcMain.handle(
  "job:confirm",
  async (event, groupId, printerName, _copies, jobCopies) => {
    // Validation abonnement AVANT impression
    if (!printerCfg?.id) return { success: false, error: "Non configuré" };

    try {
      const s = await checkSubscription(printerCfg.id);
      if (!s.valid && !s.inGrace) {
        if (mainWindow) mainWindow.webContents.send("show:activation-modal", s);
        return { success: false, error: "Abonnement requis" };
      }
    } catch (e) {
      const cfg = loadConfig();
      if (
        !cfg?.subscription?.expiresAt ||
        new Date(cfg.subscription.expiresAt) < new Date()
      ) {
        return { success: false, error: "Abonnement impossible à vérifier" };
      }
    }

    const items = Array.isArray(jobCopies)
      ? jobCopies
      : [{ jobId: groupId, fileName: "fichier", copies: _copies || 1 }];

    const jobIds = items.map((i) => i.jobId);
    if (jobIds.some((id) => processingJobs.has(id)))
      return { success: false, error: "Job déjà en cours" };

    // Mark all jobs as processing
    jobIds.forEach((id) => processingJobs.add(id));
    log("PRINT_GROUP_START", { groupId, items, printer: printerName });

    const results = [];
    const errors = [];
    let fileGroupId = null;
    let ownerId = null;

    try {
      // Fetch fileGroupId from first job
      const { data: firstJob } = await supabase
        .from("print_jobs")
        .select("file_groups(id, owner_id)")
        .eq("id", items[0].jobId)
        .single();

      fileGroupId = firstJob?.file_groups?.id;
      ownerId = firstJob?.file_groups?.owner_id;

      // Mark group as printing
      if (fileGroupId) {
        await supabase
          .from("file_groups")
          .update({ status: "printing" })
          .eq("id", fileGroupId);
      }

      // ── SEQUENTIAL PRINTING: No delays in this loop ──
      for (const item of items) {
        try {
          console.log(`[PRINT] Starting: ${item.fileName}`);
          const result = await printSingleJobNoDelay(
            item.jobId,
            printerName,
            item.copies,
          );
          results.push(result);

          if (!fileGroupId && result.fileGroupId)
            fileGroupId = result.fileGroupId;
          if (!ownerId && result.ownerId) ownerId = result.ownerId;

          // Insert history immediately
          await insertHistory({
            ownerId: result.ownerId,
            displayId: result.ownerId,
            fileName: result.fileName,
            copies: result.copies,
            printerName,
            status: "completed",
            groupId: result.fileGroupId,
          });

          // ── SCHEDULE CLEANUP INDEPENDENTLY (non-blocking) ──
          const pathToClear = result.tmpPath;
          const storageToClear = result.storagePath;
          const jobIdToClear = item.jobId;

          setTimeout(async () => {
            try {
              await supabase.storage
                .from("derewol-files")
                .remove([storageToClear]);
              console.log(`[PRINT] ${result.fileName} → Storage deleted ✅`);
              if (pathToClear && fs.existsSync(pathToClear))
                secureDelete(pathToClear);
              await supabase.from("print_jobs").delete().eq("id", jobIdToClear);
            } catch (e) {
              console.warn("[PRINT] Cleanup error:", e.message);
            }
          }, PRINT_DELAY_MS); // 30 seconds AFTER printing starts, not after loop
        } catch (err) {
          console.error(`[PRINT] ❌ ${item.fileName}:`, err.message);
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
            status: "error",
            groupId: fileGroupId,
          });
        }
      }

      // Mark group complete after all printing (cleanup still running)
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
      console.error("[PRINT] Error:", err.message);
      if (fileGroupId) {
        await supabase
          .from("file_groups")
          .update({ status: "error" })
          .eq("id", fileGroupId);
      }
      return { success: false, error: err.message };
    } finally {
      // Remove from processing set immediately (cleanup still runs independently)
      jobIds.forEach((id) => processingJobs.delete(id));
      setTimeout(() => cleanSpooler(), 3000);
    }
  },
);
```

### Block B: Add new `printSingleJobNoDelay()` function

Add this NEW function before the `job:confirm` handler:

```javascript
async function printSingleJobNoDelay(jobId, printerName, copies) {
  const tmpPath = path.join(os.tmpdir(), `dw-${jobId}.pdf`);

  const { data, error } = await supabase
    .from("print_jobs")
    .select(
      `
      id, print_token, file_id,
      file_groups (
        id, owner_id,
        files ( id, storage_path, encrypted_key, file_name )
      )
    `,
    )
    .eq("id", jobId)
    .single();

  if (error || !data) throw new Error(`Job ${jobId} not found`);

  const files = data.file_groups?.files || [];
  const file = files.find((f) => f.id === data.file_id) || files[0];
  if (!file) throw new Error("File not found");

  const fileGroupId = data.file_groups.id;
  const ownerId = data.file_groups.owner_id;

  // Mark as printing in DB
  await supabase
    .from("print_jobs")
    .update({
      status: "printing",
      copies_requested: copies,
      copies_remaining: copies,
    })
    .eq("id", jobId);

  console.log(`[PRINT] ${file.file_name} — ${copies} copies → ${printerName}`);

  // Download encrypted file
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("derewol-files")
    .download(file.storage_path);
  if (dlErr) throw new Error(`Download failed: ${dlErr.message}`);

  // Decrypt
  const decryptedBuffer = decryptFile(
    Buffer.from(await fileData.arrayBuffer()),
    file.encrypted_key,
  );
  if (!decryptedBuffer || decryptedBuffer.length < 100)
    throw new Error("Invalid file");

  fs.writeFileSync(tmpPath, decryptedBuffer);

  // ── ACTUAL PRINTING ──
  for (let i = 0; i < copies; i++) {
    await pdfToPrinter.print(tmpPath, { printer: printerName });
    console.log(`[PRINT] ${file.file_name} copy ${i + 1}/${copies} ✅`);

    await supabase
      .from("print_jobs")
      .update({ copies_remaining: copies - (i + 1) })
      .eq("id", jobId);
  }

  // Mark as completed
  await supabase
    .from("print_jobs")
    .update({ status: "completed", copies_remaining: 0 })
    .eq("id", jobId);

  // Return paths for DEFERRED cleanup
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
```

---

## PRIORITY 3: BUG 2 FIX — Trial Modal Loop (main/main.js)

**CONSOLIDATED LOGIC**: Use `trialJustActivated` flag + longer polling interval

### Block C: Fix subscription timer

In `launchApp()`, replace the `subscriptionTimer` setup:

```javascript
// Fast polling every 5 MINUTES (not 60) to detect expiration changes
if (subscriptionTimer) clearInterval(subscriptionTimer);

subscriptionTimer = setInterval(
  async () => {
    try {
      const access = await checkAccess();
      const s = await checkSubscription(printerCfg.id);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("subscription:status", s);

        // 🔥 Only show modal if access becomes INVALID
        // AND trial was NOT just activated (prevent loop)
        const needsModal =
          (access.status === "expired" || access.status === "inactive") &&
          !trialJustActivated;

        if (needsModal) {
          console.log("[EXPIRATION] Status changed to", access.status);
          mainWindow.webContents.send("show:activation-modal", access);
        }
      }
    } catch (_) {}
  },
  5 * 60 * 1000,
); // 5 minutes
```

### Block D: Fix trial:activate handler

Replace the handler (search `trial:activate`):

```javascript
ipcMain.handle("trial:activate", async () => {
  if (!printerCfg?.id) return { success: false, error: "Not configured" };

  try {
    await ensureTrialOrSubscription(printerCfg.id);
    const s = await checkSubscription(printerCfg.id);

    // SET FLAG: prevents modal loop for 10 seconds
    trialJustActivated = true;
    setTimeout(() => {
      trialJustActivated = false;
    }, 10000);

    if (mainWindow) {
      mainWindow.webContents.send("subscription:status", s);
      mainWindow.webContents.send("hide:activation-modal");
    }

    return { success: true, sub: s };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

---

## PRIORITY 4: BUG 4 FIX — Expired Files (services/polling.js)

### Block E: Fix fetchPendingJobs

At the START of `fetchPendingJobs()` function, add expiration handling:

```javascript
async function fetchPendingJobs(printerId) {
  // ── Handle expired jobs FIRST ──
  try {
    const now = new Date().toISOString();

    const { data: expiredJobs } = await supabase
      .from("print_jobs")
      .select("id, file_groups(id)")
      .lt("expires_at", now)
      .in("status", ["queued", "printing"]);

    if (expiredJobs?.length > 0) {
      const groupIds = [
        ...new Set(expiredJobs.map((j) => j.file_groups?.id).filter(Boolean)),
      ];

      // Mark jobs as expired
      await supabase
        .from("print_jobs")
        .update({ status: "expired" })
        .in(
          "id",
          expiredJobs.map((j) => j.id),
        );

      // Mark groups as expired
      await supabase
        .from("file_groups")
        .update({ status: "expired" })
        .in("id", groupIds)
        .eq("status", "waiting");

      // Remove from storage
      for (const groupId of groupIds) {
        const { data: files } = await supabase
          .from("files")
          .select("storage_path")
          .eq("group_id", groupId);

        const paths = files?.map((f) => f.storage_path).filter(Boolean) || [];
        if (paths.length > 0) {
          await supabase.storage.from("derewol-files").remove(paths);
        }
      }

      console.log(`[POLLING] ${groupIds.length} group(s) expired, cleaned up`);
    }
  } catch (e) {
    console.warn("[POLLING] Expiration check failed:", e.message);
  }

  // ── CONTINUE with normal polling ──
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  let query = supabase
    .from("print_jobs")
    .select(
      `
      id, status, print_token, created_at, expires_at, file_id,
      copies_requested, copies_remaining,
      file_groups (
        id, owner_id, status, printer_id,
        files ( id, file_name, storage_path, encrypted_key, rejected )
      )
    `,
    )
    .in("status", ["queued", "printing"])
    .gt("expires_at", now) // ← Exclude expired
    .gt("created_at", twoHoursAgo);

  if (printerId) query = query.eq("file_groups.printer_id", printerId);

  const { data, error } = await query;
  if (error) return [];

  return data || [];
}
```

---

## PRIORITY 5: BUG 3 FIX — PWA Preview (pages/p/index.js)

### Block F: Fix iframe preview to prevent downloads

In `pages/p/index.js`, find the preview iframe section (around line 1650) and replace:

```jsx
{
  previewUrl && previewUrl !== "loading" && (
    <div
      style={{
        flex: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Overlay to hide PDF toolbar Download button */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 50,
          zIndex: 10,
          background: C.green,
          pointerEvents: "auto",
        }}
      />
      <iframe
        src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=1`}
        style={{
          width: "100%",
          flex: 1,
          border: "none",
          background: "#fff",
        }}
        title={previewName}
        sandbox="allow-same-origin allow-scripts"
        onError={() => {
          setPreviewUrl(null);
        }}
      />
    </div>
  );
}
```

**Key changes:**

- Add `#toolbar=0&navpanes=0` to PDF URL (hides toolbar)
- Add overlay 50px div matching green color (covers any toolbar remnants)
- **Removed** `allow-downloads` and `allow-popups` from sandbox
- Keep only `allow-same-origin allow-scripts`

---

## PRIORITY 6: BUG 2 FIX — Hide Modal Event (preload/preload.js)

### Block G: Add event listener

In `preload/preload.js`, add to the `derewol` object:

```javascript
onHideActivationModal: (callback) =>
  ipcRenderer.on('hide:activation-modal', () => {
    console.log('[PRELOAD] hide:activation-modal event');
    callback();
  }),
```

---

## PRIORITY 7: BUG 2 + BUG 4 FIX — PWA Expired Files (pages/p/index.js)

### Block H: Show expired in history + notification

In `pages/p/index.js` `StatusSection`, update to show expired files:

```jsx
const active = groups.filter(
  (g) =>
    !["completed", "rejected", "expired", "partial_rejected"].includes(
      g.status,
    ) && (g.files?.length > 0 ? g.files.some((f) => !f.rejected) : true),
);

const history = groups.filter(
  (g) =>
    ["completed", "rejected", "expired", "partial_rejected"].includes(
      g.status,
    ) ||
    (g.files?.length > 0 && g.files.every((f) => f.rejected === true)),
);
```

Add notification when group expires:

```jsx
// In usePrintStatus or main useEffect
const notifiedRef = useRef(new Set());

useEffect(() => {
  groups.forEach((g) => {
    if (g.status === "expired" && !notifiedRef.current.has(g.id)) {
      notifiedRef.current.add(g.id);
      showToast?.(`⏰ Your files expired - resend them`, "warning");
    }
  });
}, [groups, showToast]);
```

---

## TESTING CHECKLIST

After implementing:

- [ ] Multiple files print in sequence WITHOUT 45s delay between them
- [ ] Trial activates → modal hides (no loop)
- [ ] App restart with active trial → no modal shown
- [ ] Expired files removed from storage automatically
- [ ] PDF preview has NO download button visible
- [ ] Expired files appear in "History" section on PWA
- [ ] Import/modal state changes logged correctly

---

## DEPLOYMENT STEPS

1. ✅ Execute SQL migrations first
2. ✅ Update `services/subscription.js` (DB priority logic)
3. ✅ Update `derewolprint/main/main.js` (Bug 1 + Bug 2 blocks)
4. ✅ Update `derewolprint/services/polling.js` (Bug 4)
5. ✅ Update `derewolprint/preload/preload.js` (hide event)
6. ✅ Update `pages/p/index.js` (preview + expired)
7. ✅ Rebuild and test
8. ✅ Deploy
