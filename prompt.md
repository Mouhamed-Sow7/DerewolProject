# DEREWOL — Refacto complet : purge viewer + autorisation téléchargement + fix critiques

Tu es un développeur senior Electron/React/Supabase.
Lis TOUT avant de coder. Applique dans l'ordre exact.
Retourne les fichiers COMPLETS.

---

## ÉTAPE 0 — PURGE : supprimer tout le code viewer/éditeur

### Fichiers à SUPPRIMER entièrement :

- `renderer/viewer/viewer.html`
- `renderer/viewer/viewer.css`
- `renderer/viewer/viewer.js`
- `renderer/viewer/libs/` (dossier entier)

### Dans `main/main.js` — supprimer ces blocs entièrement :

- handler `ipcMain.handle('viewer:open', ...)`
- handler `ipcMain.handle('viewer:save-modified', ...)`
- handler `ipcMain.handle('viewer:close', ...)`
- fonction `openViewerWindow(...)`
- variable `let viewerWin = null`
- Map `const viewerTempFiles = new Map()`
- constante `VIEWER_FILE_TTL_MS`
- fonction `cleanViewerTempFiles()`
- appel `cleanViewerTempFiles()` dans whenReady

### Dans `preload/preload.js` — supprimer :

- `openViewer`
- `saveViewerFile`
- `closeViewer`
- `onViewerInit`

### Dans `renderer/js/ui/renderJobs.js` — supprimer :

- Tout bouton `.btn-view-file` lié au viewer interne
- Event listener `btn-view-file` click

---

## ÉTAPE 1 — MULTI-FICHIERS : fix impression séquentielle non bloquante

### Problème

Dans `main/main.js`, `printSingleJob` contient un `await setTimeout(45000)`
qui bloque la boucle → seul le premier fichier s'imprime, les suivants attendent.

### Fix : créer `printSingleJobNoDelay` dans `main/main.js`

Remplacer la fonction `printSingleJob` existante par deux fonctions :

```js
// Constante délai suppression
const PRINT_DELAY_MS = 45000;

// NOUVELLE FONCTION : imprime sans bloquer, retourne les infos pour suppression différée
async function printSingleJobNoDelay(jobId, printerName, copies) {
  const tmpPath = path.join(os.tmpdir(), `dw-${jobId}-${Date.now()}.pdf`);

  const { data, error } = await supabase
    .from("print_jobs")
    .select(
      `
      id, file_id,
      file_groups (
        id, owner_id,
        files ( id, storage_path, encrypted_key, file_name )
      )
    `,
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

  const { data: fileData, error: dlErr } = await supabase.storage
    .from("derewol-files")
    .download(file.storage_path);
  if (dlErr) throw new Error(`Téléchargement: ${dlErr.message}`);

  const decrypted = decryptFile(
    Buffer.from(await fileData.arrayBuffer()),
    file.encrypted_key,
  );
  if (!decrypted || decrypted.length < 100) throw new Error("Fichier invalide");

  fs.writeFileSync(tmpPath, decrypted);

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

  // Retourner les infos — la suppression se fera en différé dans le caller
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

### Remplacer le handler `job:confirm` dans `main/main.js` :

```js
ipcMain.handle(
  "job:confirm",
  async (event, groupId, printerName, _copies, jobCopies) => {
    // Validation abonnement
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
        return { success: false, error: "Vérification abonnement impossible" };
      }
    }

    const items = Array.isArray(jobCopies)
      ? jobCopies
      : [{ jobId: groupId, fileName: "fichier", copies: _copies || 1 }];

    const jobIds = items.map((i) => i.jobId);
    if (jobIds.some((id) => processingJobs.has(id)))
      return { success: false, error: "Job déjà en cours" };

    jobIds.forEach((id) => processingJobs.add(id));

    const results = [],
      errors = [];
    let fileGroupId = null,
      ownerId = null;

    try {
      const { data: firstJob } = await supabase
        .from("print_jobs")
        .select("file_groups(id, owner_id)")
        .eq("id", items[0].jobId)
        .single();

      fileGroupId = firstJob?.file_groups?.id;
      ownerId = firstJob?.file_groups?.owner_id;

      if (fileGroupId) {
        await supabase
          .from("file_groups")
          .update({ status: "printing" })
          .eq("id", fileGroupId);
      }

      // Impression séquentielle SANS délai dans la boucle
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

          // Suppression différée PAR fichier — n'attend pas les autres
          const { tmpPath, storagePath, jobId: jId } = result;
          setTimeout(async () => {
            try {
              await supabase.storage
                .from("derewol-files")
                .remove([storagePath]);
              console.log(`[PRINT] Storage supprimé: ${result.fileName} ✅`);
              if (tmpPath && fs.existsSync(tmpPath)) secureDelete(tmpPath);
              await supabase.from("print_jobs").delete().eq("id", jId);
            } catch (e) {
              console.warn("[CLEANUP] Erreur diff:", e.message);
            }
          }, PRINT_DELAY_MS);
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
            status: "completed",
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
      if (fileGroupId) {
        await supabase
          .from("file_groups")
          .update({ status: "completed" })
          .eq("id", fileGroupId);
      }
      return { success: false, error: err.message };
    } finally {
      jobIds.forEach((id) => processingJobs.delete(id));
      setTimeout(() => cleanSpooler(), 3000);
    }
  },
);
```

---

## ÉTAPE 2 — AUTORISATION TÉLÉCHARGEMENT (nouvelle logique)

### Principe

L'imprimeur clique "Télécharger pour modifier" sur un fichier.
Une notification apparaît côté PWA client : "Autorisez-vous le téléchargement de votre fichier ?"
Si OUI → URL signée envoyée à l'imprimeur → téléchargement local → modification avec Office local.
Si NON → bloqué.
Notification au client que le fichier a été téléchargé (tracé).

### SQL à exécuter dans Supabase :

```sql
-- Table pour les demandes d'autorisation
CREATE TABLE IF NOT EXISTS public.download_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES public.file_groups(id) ON DELETE CASCADE,
  owner_id     text NOT NULL,
  printer_id   uuid NOT NULL REFERENCES public.printers(id),
  status       text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'downloaded')),
  requested_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  downloaded_at timestamptz,
  expires_at   timestamptz DEFAULT now() + INTERVAL '10 minutes'
);
CREATE INDEX IF NOT EXISTS idx_dl_requests_owner ON public.download_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_dl_requests_file  ON public.download_requests(file_id);
```

### Dans `main/main.js` — handler demande téléchargement :

```js
// Imprimeur demande autorisation de télécharger un fichier
ipcMain.handle("file:request-download", async (_, { fileId, groupId }) => {
  if (!printerCfg?.id) return { success: false, error: "Non configuré" };

  try {
    // Récupérer owner_id du groupe
    const { data: group } = await supabase
      .from("file_groups")
      .select("owner_id")
      .eq("id", groupId)
      .single();

    if (!group) return { success: false, error: "Groupe introuvable" };

    // Créer la demande
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

    console.log(`[DOWNLOAD] Demande créée: ${req.id}`);
    return { success: true, requestId: req.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Vérifier si une demande a été approuvée
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

// Télécharger le fichier après approbation
ipcMain.handle(
  "file:download-approved",
  async (_, { requestId, fileId, fileName }) => {
    try {
      // Vérifier approbation
      const { data: req } = await supabase
        .from("download_requests")
        .select("status, expires_at")
        .eq("id", requestId)
        .single();

      if (!req || req.status !== "approved") {
        return { success: false, error: "Non autorisé" };
      }
      if (new Date(req.expires_at) < new Date()) {
        return { success: false, error: "Autorisation expirée" };
      }

      // Récupérer le fichier
      const { data: fileRow } = await supabase
        .from("files")
        .select("storage_path, encrypted_key")
        .eq("id", fileId)
        .single();

      if (!fileRow) return { success: false, error: "Fichier introuvable" };

      const { data: fileData } = await supabase.storage
        .from("derewol-files")
        .download(fileRow.storage_path);

      const decrypted = decryptFile(
        Buffer.from(await fileData.arrayBuffer()),
        fileRow.encrypted_key,
      );

      // Sauvegarder dans le dossier Téléchargements de l'imprimeur
      const { app, dialog } = require("electron");
      const savePath = path.join(app.getPath("downloads"), fileName);
      fs.writeFileSync(savePath, decrypted);

      // Marquer comme téléchargé
      await supabase
        .from("download_requests")
        .update({
          status: "downloaded",
          downloaded_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      console.log(`[DOWNLOAD] ✅ Fichier téléchargé: ${savePath}`);

      // Ouvrir avec l'app par défaut (Word, Excel, etc.)
      require("electron").shell.openPath(savePath);

      return { success: true, savePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);
```

### Dans `preload/preload.js` — ajouter :

```js
requestFileDownload:       (data) => ipcRenderer.invoke('file:request-download', data),
checkDownloadApproval:     (id)   => ipcRenderer.invoke('file:check-download-approval', id),
downloadApprovedFile:      (data) => ipcRenderer.invoke('file:download-approved', data),
```

### Dans `renderer/js/ui/renderJobs.js` — bouton "Télécharger" par fichier :

```js
// Dans chaque file-row (fichier non rejeté), remplacer ancien btn-view-file par :
`<button class="btn-download-file" 
  data-file-id="${item.fileId}"
  data-group-id="${item.fileGroupId}"
  data-file-name="${item.fileName}"
  title="Demander autorisation de télécharger"
  style="background:transparent;border:1px solid var(--border);
    border-radius:6px;padding:4px 8px;cursor:pointer;
    color:var(--text-muted);font-size:11px;white-space:nowrap;">
  <i class="fa-solid fa-download"></i> Télécharger
</button>`;

// Event listener dans bindJobCardEvents ou équivalent :
card.querySelectorAll(".btn-download-file").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const { fileId, groupId, fileName } = btn.dataset;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    const res = await window.derewol.requestFileDownload({ fileId, groupId });
    if (!res.success) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
      return;
    }

    // Polling pour vérifier l'approbation (max 10 minutes)
    btn.innerHTML = '<i class="fa-solid fa-clock"></i> En attente…';
    const requestId = res.requestId;
    const pollApproval = setInterval(async () => {
      const check = await window.derewol.checkDownloadApproval(requestId);

      if (check.status === "approved") {
        clearInterval(pollApproval);
        btn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Téléchargement…';
        const dl = await window.derewol.downloadApprovedFile({
          requestId,
          fileId,
          fileName,
        });
        if (dl.success) {
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Téléchargé';
          btn.style.color = "var(--success, #22c55e)";
        } else {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
        }
      } else if (check.status === "rejected" || check.status === "expired") {
        clearInterval(pollApproval);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-ban"></i> Refusé';
        setTimeout(() => {
          btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
        }, 3000);
      }
    }, 3000);

    // Auto-stop après 11 minutes
    setTimeout(
      () => {
        clearInterval(pollApproval);
        if (btn.innerHTML.includes("attente")) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
        }
      },
      11 * 60 * 1000,
    );
  });
});
```

### Dans `pages/p/index.js` PWA — notification d'autorisation côté client

```jsx
// Hook pour surveiller les demandes de téléchargement
function useDownloadRequests(ownerId) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const notifiedRef = useRef(new Set());

  useEffect(() => {
    if (!ownerId) return;

    const fetchRequests = async () => {
      const { data } = await supabase
        .from("download_requests")
        .select("id, file_id, status, requested_at, files(file_name)")
        .eq("owner_id", ownerId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString());

      const newReqs = (data || []).filter(
        (r) => !notifiedRef.current.has(r.id),
      );
      if (newReqs.length > 0) {
        setPendingRequests((prev) => [...prev, ...newReqs]);
      }
    };

    fetchRequests();
    const interval = setInterval(fetchRequests, 3000);
    return () => clearInterval(interval);
  }, [ownerId]);

  return { pendingRequests, setPendingRequests };
}

// Composant notification demande téléchargement
function DownloadRequestNotification({ request, onRespond, C }) {
  const fileName = request.files?.file_name || "votre fichier";
  const [responding, setResponding] = useState(false);

  async function respond(approved) {
    setResponding(true);
    await supabase
      .from("download_requests")
      .update({
        status: approved ? "approved" : "rejected",
        responded_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    onRespond(request.id);
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 80,
        left: 16,
        right: 16,
        zIndex: 9000,
        background: "#fff",
        borderRadius: 14,
        padding: "16px 20px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        border: `2px solid ${C.yellow}`,
        animation: "fadeInUp 0.3s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "#fff3cd",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: 20,
          }}
        >
          <i className="fa-solid fa-download" style={{ color: "#856404" }} />
        </div>
        <div>
          <p
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: C.text,
              marginBottom: 4,
            }}
          >
            Demande de téléchargement
          </p>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
            L'imprimeur souhaite télécharger <strong>{fileName}</strong> pour
            modification. Autorisez-vous ?
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => respond(false)}
          disabled={responding}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            border: "1px solid #fca5a5",
            background: "#fee2e2",
            color: "#dc2626",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          <i className="fa-solid fa-xmark" /> Refuser
        </button>
        <button
          onClick={() => respond(true)}
          disabled={responding}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            border: "none",
            background: C.green,
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          {responding ? (
            <i className="fa-solid fa-spinner fa-spin" />
          ) : (
            <>
              <i className="fa-solid fa-check" /> Autoriser
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// Dans PrinterSPA, ajouter :
const { pendingRequests, setPendingRequests } = useDownloadRequests(
  session?.owner_id,
);

// Et dans le JSX, avant la fermeture du main :
{
  pendingRequests.map((req) => (
    <DownloadRequestNotification
      key={req.id}
      request={req}
      C={C}
      onRespond={(id) =>
        setPendingRequests((prev) => prev.filter((r) => r.id !== id))
      }
    />
  ));
}
```

---

## ÉTAPE 3 — LIMIT FICHIERS : 20 → 100 + taille 20MB → 100MB

### Dans `pages/p/index.js` PWA :

```js
// Remplacer :
const MAX_FILES = 100; // était 20
const MAX_SIZE_MB = 100; // était 20
```

### Dans le texte de la drop zone, mettre à jour les mentions "20 fichiers" et "20MB".

---

## ÉTAPE 4 — MODAL TRIAL : redesign + logique live

### Dans `renderer/renderer.css` — remplacer les styles du modal activation :

```css
/* ── Modal Activation — redesign ─────────────────────────── */
#activation-modal,
#subscription-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 99999 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.activation-backdrop,
.sub-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(6px);
}

.activation-box,
.sub-overlay-box {
  position: relative;
  z-index: 1;
  background: var(--surface, #1e2d21);
  border-radius: 20px;
  padding: 32px 28px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  border: 1px solid var(--border, #2a3d2e);
}

/* Logo */
.activation-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: center;
  margin-bottom: 8px;
}

.act-logo-mark {
  width: 28px;
  height: 28px;
  background: var(--accent, #f5c842);
  border-radius: 7px;
}

.act-logo-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--text, #e8f5e9);
}

.act-logo-text b {
  color: var(--accent, #f5c842);
}

/* Titre + desc */
.activation-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--text, #e8f5e9);
  text-align: center;
  margin-bottom: 6px;
}

.activation-desc {
  font-size: 14px;
  color: var(--text-muted, #7a9a7e);
  text-align: center;
  line-height: 1.6;
  margin-bottom: 24px;
}

/* Tabs */
.act-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg, #162018);
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 24px;
}

.act-tab {
  flex: 1;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted, #7a9a7e);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: "Inter", sans-serif;
  transition: all 0.2s;
}

.act-tab.active {
  background: var(--surface, #1e2d21);
  color: var(--text, #e8f5e9);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.act-tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Panel essai */
.act-trial-card {
  text-align: center;
  padding: 24px 20px;
  background: var(--bg, #162018);
  border-radius: 14px;
  margin-bottom: 16px;
  border: 1px solid var(--border, #2a3d2e);
}

.act-trial-icon {
  font-size: 44px;
  margin-bottom: 10px;
}
.act-trial-duration {
  font-size: 56px;
  font-weight: 800;
  color: var(--green-light, #4caf70);
  line-height: 1;
}
.act-trial-label {
  font-size: 16px;
  color: var(--text-muted, #7a9a7e);
  margin-bottom: 12px;
  font-weight: 500;
}
.act-trial-note {
  font-size: 12px;
  color: var(--text-muted, #7a9a7e);
  line-height: 1.6;
}

/* Bouton primary */
.act-btn-primary {
  width: 100%;
  padding: 14px;
  background: var(--accent, #f5c842);
  color: var(--green-dark, #111510);
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  font-family: "Inter", sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
}
.act-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}
.act-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Plans abonnement */
.act-plans {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.act-plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: var(--bg, #162018);
  border-radius: 12px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.2s;
  position: relative;
}

.act-plan:hover {
  border-color: var(--accent, #f5c842);
}
.act-plan--popular {
  border-color: var(--accent, #f5c842);
}
.act-plan--best {
  border-color: var(--green-light, #4caf70);
}

.act-plan-left {
  display: flex;
  flex-direction: column;
}
.act-plan-label {
  font-size: 12px;
  color: var(--text-muted, #7a9a7e);
  font-weight: 500;
  margin-bottom: 2px;
}
.act-plan-price {
  font-size: 18px;
  font-weight: 800;
  color: var(--text, #e8f5e9);
}
.act-plan-saving {
  font-size: 11px;
  color: var(--accent, #f5c842);
  font-weight: 700;
  margin-top: 2px;
}

.act-plan-badge {
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  background: var(--accent, #f5c842);
  color: #111510;
  white-space: nowrap;
}

/* WhatsApp */
.act-whatsapp-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  background: #25d366;
  color: #fff;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  margin-bottom: 16px;
  font-family: "Inter", sans-serif;
  transition: opacity 0.2s;
}
.act-whatsapp-btn:hover {
  opacity: 0.9;
}

/* Code input */
.act-code-row {
  display: flex;
  gap: 8px;
}

.act-code-row input {
  flex: 1;
  padding: 11px 14px;
  border: 2px solid var(--border, #2a3d2e);
  border-radius: 8px;
  font-size: 14px;
  font-family: monospace;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
  background: var(--bg, #162018);
  color: var(--text, #e8f5e9);
  outline: none;
  transition: border-color 0.2s;
}
.act-code-row input:focus {
  border-color: var(--accent, #f5c842);
}

.act-btn-activate {
  padding: 11px 18px;
  background: var(--green-light, #4caf70);
  color: var(--bg, #162018);
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: "Inter", sans-serif;
  white-space: nowrap;
  transition: opacity 0.2s;
}
.act-btn-activate:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.act-code-error {
  font-size: 12px;
  color: var(--danger, #ef5350);
  margin-top: 6px;
}

.act-footer-note {
  font-size: 11px;
  color: var(--text-muted, #7a9a7e);
  text-align: center;
  margin-top: 20px;
  line-height: 1.5;
}

/* Banner trial discret */
#trial-banner {
  position: fixed;
  bottom: 0;
  left: 220px;
  right: 0;
  z-index: 50;
  padding: 7px 20px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.3s;
}
```

### Dans `renderer/renderer.js` — `handleSubscriptionStatus` correct :

```js
let trialJustActivated = false;

function handleSubscriptionStatus(sub) {
  if (!sub) return;

  const overlay =
    document.getElementById("activation-modal") ||
    document.getElementById("subscription-overlay");
  if (!overlay) return;

  // Mise à jour slug
  const slugEl =
    document.getElementById("act-slug") ||
    document.getElementById("sub-printer-slug");
  if (slugEl) slugEl.textContent = window.__printerCfg?.slug || "—";

  const blocked = sub.valid === false && sub.inGrace !== true;
  const isTrialExpired = sub.plan === "trial" && sub.expired === true;
  const isTrial = sub.isTrial && sub.valid;

  if (blocked && !trialJustActivated) {
    overlay.style.display = "flex";

    // Trial expiré → masquer tab essai, forcer abonnement
    if (isTrialExpired) {
      const tabTrial = document.getElementById("tab-trial");
      if (tabTrial) tabTrial.style.display = "none";
      const tabSub = document.getElementById("tab-sub");
      const panelTrial = document.getElementById("panel-trial");
      const panelSub = document.getElementById("panel-subscription");
      if (panelTrial) panelTrial.style.display = "none";
      if (panelSub) panelSub.style.display = "block";
      if (tabSub) tabSub.classList.add("active");
    }

    const titleEl = document.getElementById("act-title");
    const descEl = document.getElementById("act-desc");
    if (titleEl)
      titleEl.textContent = isTrialExpired
        ? "⏰ Votre essai de 7 jours est terminé"
        : "🔒 Activation requise";
    if (descEl)
      descEl.textContent =
        "Abonnez-vous pour continuer à recevoir des impressions.";

    bindActivationModal();
  } else {
    overlay.style.display = "none";
    if (isTrial) showTrialBanner(sub.daysLeft);
  }
}

// Anti-boucle après activation trial
window.derewol?.onHideActivationModal?.(() => {
  trialJustActivated = true;
  setTimeout(() => {
    trialJustActivated = false;
  }, 10000);
  const overlay =
    document.getElementById("activation-modal") ||
    document.getElementById("subscription-overlay");
  if (overlay) overlay.style.display = "none";
});
```

---

## ÉTAPE 5 — FICHIERS EXPIRÉS : notification + historique

### Dans `services/polling.js` — détecter et mettre à jour les expirés :

```js
// Dans fetchPendingJobs, après avoir obtenu les data, ajouter avant le return :
const now = new Date().toISOString();
const expired = (data || []).filter(
  (j) => j.status === "queued" && j.expires_at && j.expires_at < now,
);

for (const exp of expired) {
  await supabase
    .from("print_jobs")
    .update({ status: "expired" })
    .eq("id", exp.id);

  const fgId = exp.file_groups?.id;
  if (fgId) {
    await supabase
      .from("file_groups")
      .update({ status: "expired" })
      .eq("id", fgId)
      .in("status", ["waiting"]); // seulement si pas en impression

    // Supprimer fichier du storage
    const storagePath = exp.file_groups?.files?.[0]?.storage_path;
    if (storagePath) {
      await supabase.storage
        .from("derewol-files")
        .remove([storagePath])
        .catch(() => {});
    }
  }
}
```

### Dans `pages/p/index.js` PWA — afficher les expirés dans historique + toast :

```js
// Dans usePrintStatus ou useEffect de polling, ajouter :
const notifiedExpiredRef = useRef(new Set());

useEffect(() => {
  const justExpired = groups.filter(
    g => g.status === 'expired' && !notifiedExpiredRef.current.has(g.id)
  );
  justExpired.forEach(g => {
    notifiedExpiredRef.current.add(g.id);
    showToast?.(`⏰ ${g.files_count || 'Des'} fichiers ont expiré — renvoyez-les`, 'warning');
  });
}, [groups]);

// Dans fetchGroupsByOwner (lib/supabase.js), inclure expired :
.in('status', ['waiting', 'printing', 'completed', 'rejected', 'partial_rejected', 'expired'])
```

---

## FICHIERS À MODIFIER / CRÉER

| Fichier                        | Action                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| `main/main.js`                 | Supprimer viewer + ajouter download handlers + fix multi-print         |
| `preload/preload.js`           | Supprimer viewer + ajouter download bridges                            |
| `renderer/renderer.js`         | handleSubscriptionStatus + anti-boucle                                 |
| `renderer/renderer.css`        | Redesign modal activation complet                                      |
| `renderer/js/ui/renderJobs.js` | Remplacer btn-view-file par btn-download-file                          |
| `services/polling.js`          | Détecter expirés                                                       |
| `pages/p/index.js`             | DownloadRequestNotification + limit 100 fichiers/100MB + toast expirés |
| `lib/supabase.js` (PWA)        | Inclure expired dans fetchGroupsByOwner                                |

## SQL À EXÉCUTER EN PREMIER :

1. Table `download_requests` (voir Étape 2)
2. Fix trial 7 jours :

```sql
UPDATE subscriptions SET duration_days=7, expires_at=activated_at+INTERVAL '7 days'
WHERE plan='trial' AND duration_days=15;
```

## OUTPUT

---FILE: main/main.js---
---FILE: preload/preload.js---
---FILE: renderer/renderer.js---
---FILE: renderer/renderer.css---
---FILE: renderer/js/ui/renderJobs.js---
---FILE: services/polling.js---
---FILE: pages/p/index.js---
---FILE: lib/supabase.js---
