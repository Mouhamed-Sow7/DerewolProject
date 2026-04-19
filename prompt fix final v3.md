# DEREWOL — Fix final : autorisation téléchargement + expirés + limites + modal design

Tu es un développeur senior Electron/React/Supabase.
SQL déjà exécuté. Ne retouche PAS ce qui fonctionne déjà selon le rapport ci-dessous.

---

## CE QUI FONCTIONNE DÉJÀ — NE PAS TOUCHER

✅ Multi-file printing — `hooks/useUpload.js` lignes 81-106 (1 job par fichier)
✅ PDF download bloqué — blob URL + overlay `pointerEvents: auto`
✅ Preview modal parent-child — `main/main.js` lignes 256-286
✅ Trial expiration 10s — `main/main.js` lignes 1242-1272
✅ Subscription direct INSERT — `services/subscription.js` lignes 15-75
✅ Modal trial boucle — corrigé, ne pas retoucher la logique existante

---

## CE QUI RESTE À IMPLÉMENTER

### 1. Autorisation téléchargement client→imprimeur

### 2. Limite fichiers 20→100 + taille 20MB→100MB

### 3. Design modal trial/abonnement à revoir

### 4. Fichiers expirés : notification PWA + affichage historique des deux côtés

---

## FIX 1 — AUTORISATION TÉLÉCHARGEMENT

### Table `download_requests` déjà créée en SQL. Implémenter la logique :

### Dans `main/main.js` — ajouter ces 3 handlers IPC après les handlers subscription existants :

```js
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

      const decrypted = decryptFile(
        Buffer.from(await fileData.arrayBuffer()),
        fileRow.encrypted_key,
      );

      const { app, shell } = require("electron");
      const safeName = fileName.replace(/[^a-zA-Z0-9._\-\s]/g, "_");
      const savePath = path.join(app.getPath("downloads"), safeName);
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
      return { success: true, savePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);
```

### Dans `preload/preload.js` — ajouter dans l'objet `derewol` :

```js
requestFileDownload:   (data) => ipcRenderer.invoke('file:request-download', data),
checkDownloadApproval: (id)   => ipcRenderer.invoke('file:check-download-approval', id),
downloadApprovedFile:  (data) => ipcRenderer.invoke('file:download-approved', data),
```

### Dans `renderer/js/ui/renderJobs.js` — bouton téléchargement par fichier

Dans chaque `file-row` (fichier non rejeté, status queued ou printing),
ajouter ce bouton après le nom du fichier :

```js
// Dans la génération HTML de chaque file-row :
const canDownload =
  !item.rejected && ["queued", "printing"].includes(item.status || "queued");

if (canDownload) {
  fileRowHtml += `
    <button class="btn-req-download"
      data-file-id="${item.fileId}"
      data-group-id="${item.fileGroupId}"
      data-file-name="${item.fileName}"
      title="Demander au client l'autorisation de télécharger"
      style="background:transparent;border:1px solid var(--border);
        border-radius:6px;padding:4px 10px;cursor:pointer;
        color:var(--text-muted);font-size:11px;white-space:nowrap;
        font-family:'Inter',sans-serif;display:inline-flex;align-items:center;gap:4px;">
      <i class="fa-solid fa-download" style="font-size:10px"></i> Télécharger
    </button>`;
}

// Event listeners à attacher après injection HTML dans le DOM :
card.querySelectorAll(".btn-req-download").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const { fileId, groupId, fileName } = btn.dataset;

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-clock"></i> Demande envoyée…';

    const res = await window.derewol.requestFileDownload({
      fileId,
      groupId,
      fileName,
    });
    if (!res.success) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
      return;
    }

    const requestId = res.requestId;
    let attempts = 0;
    const maxAttempts = 200; // 200 × 3s = 10 minutes

    const poll = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(poll);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
        return;
      }

      const check = await window.derewol.checkDownloadApproval(requestId);

      if (check.status === "approved") {
        clearInterval(poll);
        btn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Téléchargement…';
        const dl = await window.derewol.downloadApprovedFile({
          requestId,
          fileId,
          fileName,
        });
        if (dl.success) {
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Téléchargé';
          btn.style.color = "var(--success, #4caf70)";
          btn.style.borderColor = "var(--success, #4caf70)";
        } else {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
        }
      } else if (check.status === "rejected" || check.status === "expired") {
        clearInterval(poll);
        btn.innerHTML = '<i class="fa-solid fa-ban"></i> Refusé';
        btn.style.color = "var(--danger, #ef5350)";
        setTimeout(() => {
          btn.disabled = false;
          btn.style.color = "";
          btn.style.borderColor = "";
          btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
        }, 3000);
      }
    }, 3000);
  });
});
```

### Dans `pages/p/index.js` PWA — notification demande téléchargement côté client

Ajouter ce hook et ce composant dans le fichier :

```jsx
// Hook surveillance demandes — à ajouter dans PrinterSPA
function useDownloadRequests(ownerId) {
  const [pending, setPending] = useState([]);
  const seenRef = useRef(new Set());

  useEffect(() => {
    if (!ownerId) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("download_requests")
        .select("id, file_id, status, requested_at, files(file_name)")
        .eq("owner_id", ownerId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString());

      const news = (data || []).filter((r) => !seenRef.current.has(r.id));
      if (news.length) setPending((prev) => [...prev, ...news]);
    };
    fetch();
    const iv = setInterval(fetch, 3000);
    return () => clearInterval(iv);
  }, [ownerId]);

  return { pending, setPending };
}

// Composant notification — styles 100% inline
function DownloadRequestNotif({ req, onRespond, C }) {
  const [loading, setLoading] = useState(false);
  const fileName = req.files?.file_name || "votre fichier";

  async function respond(approved) {
    setLoading(true);
    await supabase
      .from("download_requests")
      .update({
        status: approved ? "approved" : "rejected",
        responded_at: new Date().toISOString(),
      })
      .eq("id", req.id);
    onRespond(req.id);
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: 12,
        right: 12,
        zIndex: 9500,
        background: "#fff",
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        border: `2px solid ${C.yellow}`,
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            flexShrink: 0,
            background: "#fff3cd",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            color: "#856404",
          }}
        >
          <i className="fa-solid fa-download" />
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
            L'imprimeur souhaite télécharger{" "}
            <strong style={{ color: C.text }}>{fileName}</strong> pour le
            modifier. Autorisez-vous ?
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => respond(false)}
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            cursor: "pointer",
            border: "1px solid #fca5a5",
            background: "#fee2e2",
            color: "#dc2626",
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          <i className="fa-solid fa-xmark" /> Refuser
        </button>
        <button
          onClick={() => respond(true)}
          disabled={loading}
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: 8,
            cursor: "pointer",
            border: "none",
            background: C.green,
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "Inter, sans-serif",
          }}
        >
          {loading ? (
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
```

Dans `PrinterSPA`, ajouter dans le state et le JSX :

```jsx
// State
const { pending: dlRequests, setPending: setDlRequests } = useDownloadRequests(
  session?.owner_id,
);

// Dans le JSX (avant la fermeture du composant) :
{
  dlRequests.map((req) => (
    <DownloadRequestNotif
      key={req.id}
      req={req}
      C={C}
      onRespond={(id) =>
        setDlRequests((prev) => prev.filter((r) => r.id !== id))
      }
    />
  ));
}
```

---

## FIX 2 — LIMITES FICHIERS ET TAILLE

### Dans `pages/p/index.js` :

```js
// Remplacer les constantes existantes :
const MAX_FILES = 100; // était 20
const MAX_SIZE_MB = 100; // était 20MB

// Mettre à jour les textes dans la drop zone :
// "20 fichiers restants" → calculé dynamiquement depuis MAX_FILES - selected.length
// "PDF · max 20MB" → "PDF · max 100MB"
```

---

## FIX 3 — DESIGN MODAL ACTIVATION (revoir uniquement le CSS)

### Dans `renderer/renderer.css` — remplacer les styles du modal sans toucher au JS :

```css
/* Overlay plein écran */
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

/* Backdrop */
.activation-backdrop,
.sub-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(5px);
}

/* Box principale — plus large */
.activation-box,
.sub-overlay-box {
  position: relative;
  z-index: 1;
  background: var(--surface, #1e2d21);
  border-radius: 20px;
  padding: 32px 30px;
  width: 100%;
  max-width: 500px; /* était 420px */
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  border: 1px solid var(--border, #2a3d2e);
}

/* Logo centré */
.activation-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 10px;
}
.act-logo-mark {
  width: 30px;
  height: 30px;
  background: var(--accent, #f5c842);
  border-radius: 8px;
}
.act-logo-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--text, #e8f5e9);
}
.act-logo-text b {
  color: var(--accent, #f5c842);
}

/* Titre */
.activation-title {
  font-size: 21px;
  font-weight: 800;
  color: var(--text, #e8f5e9);
  text-align: center;
  margin-bottom: 8px;
}

/* Description */
.activation-desc {
  font-size: 13px;
  color: var(--text-muted, #7a9a7e);
  text-align: center;
  line-height: 1.6;
  margin-bottom: 22px;
}

/* Tabs */
.act-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg, #162018);
  border-radius: 10px;
  padding: 4px;
  margin-bottom: 22px;
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
  transition: all 0.2s;
  font-family: "Inter", sans-serif;
}
.act-tab.active {
  background: var(--surface, #1e2d21);
  color: var(--text, #e8f5e9);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.act-tab:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Trial card */
.act-trial-card {
  text-align: center;
  padding: 28px 20px;
  background: var(--bg, #162018);
  border-radius: 14px;
  margin-bottom: 16px;
  border: 1px solid var(--border, #2a3d2e);
}
.act-trial-icon {
  font-size: 42px;
  margin-bottom: 10px;
}
.act-trial-duration {
  font-size: 60px;
  font-weight: 900;
  color: var(--success, #4caf70);
  line-height: 1;
}
.act-trial-label {
  font-size: 15px;
  color: var(--text-muted, #7a9a7e);
  margin-bottom: 12px;
  font-weight: 500;
}
.act-trial-note {
  font-size: 12px;
  color: var(--text-muted, #7a9a7e);
  line-height: 1.6;
}

/* Bouton principal */
.act-btn-primary {
  width: 100%;
  padding: 14px;
  background: var(--accent, #f5c842);
  color: #111510;
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

/* Plans abonnement — en colonnes */
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
  position: relative;
  transition: border-color 0.2s;
}
.act-plan:hover {
  border-color: var(--accent, #f5c842);
}
.act-plan--popular {
  border-color: var(--accent, #f5c842);
}

.act-plan-left {
  display: flex;
  flex-direction: column;
}
.act-plan-label {
  font-size: 11px;
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
  flex-shrink: 0;
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
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 16px;
  font-family: "Inter", sans-serif;
  transition: opacity 0.2s;
}
.act-whatsapp-btn:hover {
  opacity: 0.9;
}

/* Saisie code */
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
  background: var(--success, #4caf70);
  color: var(--bg, #162018);
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  font-family: "Inter", sans-serif;
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
  margin-top: 18px;
  line-height: 1.5;
}

/* Banner trial discret */
#trial-banner {
  position: fixed;
  bottom: 0;
  left: 220px;
  right: 0;
  z-index: 50;
  padding: 8px 20px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid;
  font-family: "Inter", sans-serif;
}
```

---

## FIX 4 — FICHIERS EXPIRÉS : historique + notifications

### Dans `services/polling.js` — détecter les expirés et mettre à jour :

Ajouter CE BLOC dans `fetchPendingJobs`, juste après avoir obtenu `data` et avant le `return` :

```js
// Détecter et marquer les jobs expirés
const now = new Date().toISOString();
const expiredJobs = (data || []).filter(
  (j) => j.status === "queued" && j.expires_at && j.expires_at < now,
);

if (expiredJobs.length > 0) {
  for (const expJob of expiredJobs) {
    const fgId = expJob.file_groups?.id;

    // Marquer le job expiré
    await supabase
      .from("print_jobs")
      .update({ status: "expired" })
      .eq("id", expJob.id);

    // Marquer le groupe expiré si encore en waiting
    if (fgId) {
      await supabase
        .from("file_groups")
        .update({ status: "expired" })
        .eq("id", fgId)
        .in("status", ["waiting"]);

      // Supprimer le fichier du storage (plus utile)
      const storagePath = expJob.file_groups?.files?.[0]?.storage_path;
      if (storagePath) {
        await supabase.storage
          .from("derewol-files")
          .remove([storagePath])
          .catch(() => {});
      }
    }

    console.log(
      `[POLLING] ⏰ Job expiré: ${expJob.file_groups?.files?.[0]?.file_name || expJob.id}`,
    );
  }
}

// Retourner uniquement les jobs non expirés
return (data || [])
  .filter((j) => !j.expires_at || j.expires_at >= now)
  .filter((job) => !printerId || job.file_groups?.printer_id === printerId);
```

### Dans `lib/supabase.js` PWA — inclure expired dans fetchGroupsByOwner :

```js
// Chercher .neq('status', 'deleted') et remplacer par :
.in('status', ['waiting', 'printing', 'completed', 'rejected', 'partial_rejected', 'expired'])
.order('created_at', { ascending: false })
.limit(50)
```

### Dans `pages/p/index.js` PWA — notification toast + affichage expirés dans historique :

```jsx
// Ajouter ref en haut de PrinterSPA :
const notifiedExpiredRef = useRef(new Set());

// Ajouter dans le useEffect qui surveille les groupes (après polling) :
useEffect(() => {
  const justExpired = groups.filter(
    (g) => g.status === "expired" && !notifiedExpiredRef.current.has(g.id),
  );
  justExpired.forEach((g) => {
    notifiedExpiredRef.current.add(g.id);
    showToast(
      `⏰ ${g.files_count || "Vos"} fichier${g.files_count > 1 ? "s ont" : " a"} expiré — renvoyez-les`,
      "warning",
    );
  });
}, [groups]);

// Dans StatusSection, s'assurer que expired va dans historique :
const history = groups.filter(
  (g) =>
    ["completed", "rejected", "partial_rejected", "expired"].includes(
      g.status,
    ) ||
    (g.files?.length > 0 && g.files.every((f) => f.isRejected || f.rejected)),
);
```

### Dans `renderer/renderer.js` DerewolPrint — afficher expirés dans historique :

Dans la fonction qui charge l'historique (`loadHistory` ou équivalent), s'assurer que
`history:get` retourne les entrées avec `status: 'expired'` et les afficher avec un badge distinct.

Dans `renderHistory` ou la fonction qui génère les items historique, ajouter le cas expired :

```js
// Dans le statusMap de l'historique :
const statusMap = {
  completed: {
    label: "Terminé",
    color: "var(--success)",
    bg: "var(--success-light, #dcfce7)",
  },
  rejected: {
    label: "Rejeté",
    color: "var(--danger)",
    bg: "var(--danger-light, #fdecea)",
  },
  expired: { label: "Expiré", color: "#6b7280", bg: "#f3f4f6" },
};
```

---

## FICHIERS À MODIFIER

| Fichier                        | Action                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| `main/main.js`                 | Ajouter 3 handlers IPC download                                  |
| `preload/preload.js`           | Ajouter 3 bridges download                                       |
| `renderer/js/ui/renderJobs.js` | Bouton télécharger + polling approbation                         |
| `renderer/renderer.css`        | Redesign CSS modal complet                                       |
| `services/polling.js`          | Détecter + marquer expirés                                       |
| `pages/p/index.js`             | Hook download requests + notification toast expirés + limite 100 |
| `lib/supabase.js` (PWA)        | Inclure expired dans fetch                                       |
| `renderer/renderer.js`         | Badge expired dans historique                                    |

## ⚠️ NE PAS MODIFIER

- `hooks/useUpload.js` — multi-file OK ✅
- `services/subscription.js` — direct INSERT OK ✅
- Logique anti-boucle modal trial — OK ✅
- PDF blob + overlay blocking — OK ✅
- Parent window relationship — OK ✅

## OUTPUT

---FILE: main/main.js---
---FILE: preload/preload.js---
---FILE: renderer/js/ui/renderJobs.js---
---FILE: renderer/renderer.css---
---FILE: services/polling.js---
---FILE: pages/p/index.js---
---FILE: lib/supabase.js---
---FILE: renderer/renderer.js---
