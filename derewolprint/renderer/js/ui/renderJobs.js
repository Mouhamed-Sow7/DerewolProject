// renderer/js/ui/renderJobs.js

// Store copies par fichier
const copiesPerFile = {};

function getFileCopies(jobId, fileId) {
  return copiesPerFile[`${jobId}_${fileId}`] || 1;
}
function setFileCopies(jobId, fileId, val) {
  copiesPerFile[`${jobId}_${fileId}`] = val;
}

function formatClientId(id) {
  if (!id) return "Client";
  if (id.startsWith("DW-anon-")) return id.toUpperCase();
  return id.slice(0, 8).toUpperCase();
}

function getFileIconClass(fileName) {
  const ext = fileName?.split(".")?.pop()?.toLowerCase() || "";
  switch (ext) {
    case "pdf":
      return "fa-file-pdf";
    case "doc":
    case "docx":
      return "fa-file-word";
    case "xls":
    case "xlsx":
      return "fa-file-excel";
    default:
      return "fa-file-lines";
  }
}

function getStatusConfig(status) {
  return (
    {
      waiting: { label: "En attente", color: "#92400e", bg: "#fffbeb" },
      queued: { label: "En attente", color: "#92400e", bg: "#fffbeb" },
      printing: { label: "Impression", color: "#1d4ed8", bg: "#eff6ff" },
      completed: { label: "Terminé", color: "#166534", bg: "#f0fdf4" },
      rejected: { label: "Rejeté", color: "#b91c1c", bg: "#fef2f2" },
      expired: { label: "Expiré", color: "#4b5563", bg: "#f3f4f6" },
    }[status] || { label: "En attente", color: "#92400e", bg: "#fffbeb" }
  );
}

export { getFileCopies };

export default function renderJobs(
  groups,
  { onPrint, onReject, onRejectFile } = {},
) {
  const list = document.getElementById("jobs-list");
  const count = document.getElementById("job-count");

  if (!list || !count) return;

  const totalFiles = groups.reduce((acc, g) => acc + g.items.length, 0);
  count.textContent = `${groups.length} client${groups.length > 1 ? "s" : ""} · ${totalFiles} fichier${totalFiles > 1 ? "s" : ""}`;

  if (groups.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-regular fa-file-lines"></i></div>
        <p>Aucun job en attente</p>
        <span>Les fichiers envoyés apparaîtront ici</span>
      </div>`;
    return;
  }

  const checkedIds = new Set();
  document
    .querySelectorAll(".job-checkbox:checked")
    .forEach((cb) => checkedIds.add(cb.dataset.id));

  list.innerHTML = groups
    .map((group) => {
      const btBadge = group.isBluetooth
        ? '<span class="bt-badge"><i class="fa-brands fa-bluetooth-b"></i> BT</span>'
        : "";

      const groupStatus = getStatusConfig(group.groupStatus);
      const statusBadge = `<span class="job-status-badge" style="background:${groupStatus.bg};color:${groupStatus.color}">${groupStatus.label}</span>`;
      const disableActions = ["printing", "completed", "failed"].includes(
        group.groupStatus,
      );

      // Calculer statut global du groupe
      const allRejected = group.items.every((i) => i.status === "rejected");
      const someRejected = group.items.some((i) => i.status === "rejected");
      const someActive = group.items.some(
        (i) => i.status === "queued" || i.status === "printing",
      );

      const groupStatusBadge = allRejected
        ? '<span class="group-badge group-badge--rejected"><i class="fa-solid fa-xmark"></i> Tout rejeté</span>'
        : someRejected && someActive
          ? '<span class="group-badge group-badge--partial"><i class="fa-solid fa-triangle-exclamation"></i> Partiel</span>'
          : "";

      const fileRows = group.items
        .map((item) => {
          const copies = getFileCopies(item.jobId, item.fileId);
          const rejected = item.status === "rejected";

          return `
        <div class="file-row ${rejected ? "file-row--rejected" : ""}"
          id="file-row-${item.jobId}-${item.fileId}"
          data-job-id="${item.jobId}"
          data-file-id="${item.fileId}"
          data-file-group-id="${item.fileGroupId}"
          style="${rejected ? "opacity:0.5;" : ""}">

          <div class="file-row-name-wrap">
            <span class="file-row-icon">
              ${rejected ? '<i class="fa-solid fa-xmark" style="color:var(--danger)"></i>' : '<i class="fa-solid ' + getFileIconClass(item.fileName) + '"></i>'}
            </span>
            <span class="file-row-name" title="${item.fileName}">${item.fileName}</span>
            ${rejected ? '<span class="file-row-rejected-label">Rejeté</span>' : ""}
            ${item.status === "printing" ? '<span class="file-status-dot file-status-dot--printing" title="Impression en cours"><i class="fa-solid fa-spinner fa-spin"></i></span>' : ""}
          </div>

          <div class="file-row-right">
            ${
              !rejected
                ? `
            <div class="file-row-copies">
              <button class="copies-btn minus"
                data-job-id="${item.jobId}"
                data-file-id="${item.fileId}"><i class="fa-solid fa-minus"></i></button>
              <span class="copies-count" id="fc-${item.jobId}-${item.fileId}">${copies}</span>
              <button class="copies-btn plus"
                data-job-id="${item.jobId}"
                data-file-id="${item.fileId}"><i class="fa-solid fa-plus"></i></button>
            </div>

            <button class="btn-view-file"
              data-job-id="${item.jobId}"
              data-file-id="${item.fileId}"
              data-file-name="${item.fileName}"
              title="Prévisualiser"
              ><i class="fa-solid fa-eye"></i></button>

            <button class="btn-print-options"
              data-job-id="${item.jobId}"
              data-file-id="${item.fileId}"
              data-file-name="${item.fileName}"
              data-file-ext="${item.fileName.split(".").pop().toLowerCase()}"
              title="Options d'impression"
              style="background:transparent;border:1px solid var(--border);
                border-radius:6px;padding:4px 10px;cursor:pointer;
                color:var(--text-muted);font-size:11px;white-space:nowrap;
                font-family:'Inter',sans-serif;display:inline-flex;align-items:center;gap:4px;">
              <i class="fa-solid fa-sliders" style="font-size:10px"></i> Options
            </button>

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
            </button>

            <button class="btn-reject-file"
              data-job-id="${item.jobId}"
              data-file-id="${item.fileId}"
              data-file-name="${item.fileName}"
              data-group-id="${group.id}"
              title="Retirer ce fichier"
              ${disableActions ? "disabled" : ""}><i class="fa-solid fa-xmark"></i></button>
            `
                : ""
            }
          </div>

        </div>`;
        })
        .join("");

      return `
    <div class="job-card" id="${group.id}">

      <!-- Header -->
      <div class="job-card-header">
        <div class="job-card-header-left">
          <input type="checkbox" class="job-checkbox" data-id="${group.id}"
            ${checkedIds.has(group.id) ? "checked" : ""}>
          <div>
            <div class="job-client-id"><i class="fa-regular fa-user"></i> ${formatClientId(group.clientId)} ${btBadge} ${groupStatusBadge}</div>
            <div class="job-time">${group.time} · ${group.items.length} fichier${group.items.length > 1 ? "s" : ""} · ${statusBadge}</div>
          </div>
        </div>
        <div class="job-actions">
          <button class="btn-print" data-id="${group.id}" ${disableActions ? "disabled" : ""}><i class="fa-solid fa-print"></i> Imprimer tout</button>
          <button class="btn-reject" data-id="${group.id}" ${disableActions ? "disabled" : ""}>Tout rejeter</button>
        </div>
      </div>

      <!-- Fichiers avec rejet individuel -->
      <div class="job-files-list">
        ${fileRows}
      </div>

    </div>`;
    })
    .join("");

  // ── Events copies ─────────────────────────────────────────
  document.querySelectorAll(".copies-btn.minus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { jobId, fileId } = btn.dataset;
      const val = Math.max(1, getFileCopies(jobId, fileId) - 1);
      setFileCopies(jobId, fileId, val);
      document.getElementById(`fc-${jobId}-${fileId}`).textContent = val;
    });
  });

  document.querySelectorAll(".copies-btn.plus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const { jobId, fileId } = btn.dataset;
      const val = Math.min(20, getFileCopies(jobId, fileId) + 1);
      setFileCopies(jobId, fileId, val);
      document.getElementById(`fc-${jobId}-${fileId}`).textContent = val;
    });
  });

  // ── Vue fichier ──────────────────────────────────────────
  document.querySelectorAll(".btn-view-file").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.derewol.viewerOpen(btn.dataset.jobId, btn.dataset.fileId);
    });
  });

  // ── Demande téléchargement ────────────────────────────────
  document.querySelectorAll(".btn-req-download").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { fileId, groupId, fileName } = btn.dataset;
      const origHTML = btn.innerHTML;

      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-clock"></i> Demande…';

      const res = await window.derewol.requestFileDownload({
        fileId,
        groupId,
        fileName,
      });
      if (!res.success) {
        btn.disabled = false;
        btn.innerHTML = origHTML;
        return;
      }

      const requestId = res.requestId;
      let attempts = 0;
      const maxAttempts = 200; // 200 × 3s = 10 min

      const poll = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(poll);
          btn.disabled = false;
          btn.innerHTML = origHTML;
          return;
        }

        const check = await window.derewol.checkDownloadApproval(requestId);

        if (check.status === "approved") {
          clearInterval(poll);
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> DL…';
          const dl = await window.derewol.downloadApprovedFile({
            requestId,
            fileId,
            fileName,
          });
          if (dl.success) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> OK';
            btn.style.color = "var(--success, #4caf70)";
            btn.style.borderColor = "var(--success, #4caf70)";
          } else {
            btn.disabled = false;
            btn.innerHTML = origHTML;
          }
        } else if (check.status === "rejected" || check.status === "expired") {
          clearInterval(poll);
          btn.innerHTML = '<i class="fa-solid fa-ban"></i> Refusé';
          btn.style.color = "var(--danger, #ef5350)";
          setTimeout(() => {
            btn.disabled = false;
            btn.style.color = "";
            btn.style.borderColor = "";
            btn.innerHTML = origHTML;
          }, 3000);
        }
      }, 3000);
    });
  });

  // ── Rejet fichier individuel ──────────────────────────────
  document.querySelectorAll(".btn-reject-file").forEach((btn) => {
    btn.addEventListener("click", () => {
      onRejectFile?.({
        jobId: btn.dataset.jobId,
        fileId: btn.dataset.fileId,
        fileName: btn.dataset.fileName,
        groupId: btn.dataset.groupId,
      });
    });
  });

  // ── Rejet groupe entier ───────────────────────────────────
  document.querySelectorAll(".btn-reject").forEach((btn) => {
    btn.addEventListener("click", () => onReject?.(btn.dataset.id));
  });

  // ── Impression ────────────────────────────────────────────
  document.querySelectorAll(".btn-print").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = jobStore_getGroup(btn.dataset.id);
      onPrint?.(btn.dataset.id, group);
    });
  });

  // ── Options d'impression ──────────────────────────────────
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-print-options");
    if (btn) {
      const { jobId, fileId, fileName, fileExt } = btn.dataset;
      openPrintOptionsModal(jobId, fileId, fileName, fileExt);
    }
  });

  document.querySelectorAll(".job-checkbox").forEach((cb) => {
    cb.addEventListener("change", window.updateSelectionBar);
  });
}

// Helper accès store
let jobStore_getGroup = () => null;

// ── MODAL OPTIONS D'IMPRESSION ────────────────────────────────────────
function openPrintOptionsModal(jobId, fileId, fileName, ext) {
  const existing = document.getElementById("print-options-modal");
  if (existing) existing.remove();

  const isPdf = ext === "pdf";
  const isExcel = ["xlsx", "xls"].includes(ext);
  const defaultOri = isExcel ? "landscape" : "portrait";

  const modal = document.createElement("div");
  modal.id = "print-options-modal";
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
  `;

  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;border:0.5px solid #e0e0e0;
      padding:1.5rem;width:340px;font-family:'Inter',sans-serif;">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">
        <div>
          <p style="font-size:15px;font-weight:600;margin:0;color:#1a1a1a;">Options d'impression</p>
          <p style="font-size:12px;color:#666;margin:4px 0 0;max-width:220px;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${fileName}</p>
        </div>
        <span style="font-size:11px;background:#f0f0f0;color:#555;
          padding:3px 8px;border-radius:6px;border:0.5px solid #ddd;text-transform:uppercase;">
          ${ext}
        </span>
      </div>

      <div style="border-top:0.5px solid #eee;padding-top:1rem;display:flex;flex-direction:column;gap:1rem;">

        ${
          !isPdf
            ? `
        <div>
          <p style="font-size:11px;color:#888;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Orientation</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button id="opt-portrait"
              style="display:flex;flex-direction:column;align-items:center;gap:6px;
                padding:12px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:${defaultOri === "portrait" ? "2px solid #1B5E35;background:#E8F5E9;color:#1B5E35;font-weight:600" : "0.5px solid #ddd;background:#fff;color:#555;font-weight:400"};">
              <svg width="22" height="28" viewBox="0 0 22 28" fill="none">
                <rect x="1" y="1" width="20" height="26" rx="2" stroke="currentColor" stroke-width="1.5" fill="#f5f5f5"/>
                <rect x="4" y="6" width="14" height="2" rx="1" fill="currentColor" opacity="0.4"/>
                <rect x="4" y="11" width="14" height="2" rx="1" fill="currentColor" opacity="0.4"/>
                <rect x="4" y="16" width="10" height="2" rx="1" fill="currentColor" opacity="0.4"/>
              </svg>
              Portrait
            </button>
            <button id="opt-landscape"
              style="display:flex;flex-direction:column;align-items:center;gap:6px;
                padding:12px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:${defaultOri === "landscape" ? "2px solid #1B5E35;background:#E8F5E9;color:#1B5E35;font-weight:600" : "0.5px solid #ddd;background:#fff;color:#555;font-weight:400"};">
              <svg width="28" height="22" viewBox="0 0 28 22" fill="none">
                <rect x="1" y="1" width="26" height="20" rx="2" stroke="currentColor" stroke-width="1.5" fill="#f5f5f5"/>
                <rect x="4" y="6" width="20" height="2" rx="1" fill="currentColor" opacity="0.4"/>
                <rect x="4" y="11" width="20" height="2" rx="1" fill="currentColor" opacity="0.4"/>
                <rect x="4" y="15" width="14" height="2" rx="1" fill="currentColor" opacity="0.4"/>
              </svg>
              Paysage
            </button>
          </div>
        </div>

        <div>
          <p style="font-size:11px;color:#888;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Ajustement</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button id="opt-fit"
              style="padding:9px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:2px solid #1B5E35;background:#E8F5E9;color:#1B5E35;font-weight:600;">
              Ajuster à la page
            </button>
            <button id="opt-actual"
              style="padding:9px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:0.5px solid #ddd;background:#fff;color:#555;font-weight:400;">
              Taille réelle
            </button>
          </div>
        </div>
        `
            : ""
        }

        <div>
          <p style="font-size:11px;color:#888;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Pages</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
            <button id="opt-pages-all"
              style="padding:9px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:2px solid #1B5E35;background:#E8F5E9;color:#1B5E35;font-weight:600;">
              Toutes
            </button>
            <button id="opt-pages-range"
              style="padding:9px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:0.5px solid #ddd;background:#fff;color:#555;font-weight:400;">
              Intervalle
            </button>
          </div>
          <div id="opt-range-inputs" style="display:none;gap:8px;align-items:center;">
            <span style="font-size:12px;color:#888;">De</span>
            <input type="number" id="opt-page-from" min="1" value="1"
              style="width:60px;padding:6px;border:0.5px solid #ddd;border-radius:6px;
                font-size:13px;text-align:center;font-family:'Inter',sans-serif;">
            <span style="font-size:12px;color:#888;">à</span>
            <input type="number" id="opt-page-to" min="1" value="1"
              style="width:60px;padding:6px;border:0.5px solid #ddd;border-radius:6px;
                font-size:13px;text-align:center;font-family:'Inter',sans-serif;">
          </div>
        </div>

        <div>
          <p style="font-size:11px;color:#888;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">Recto / Verso</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button id="opt-recto"
              style="padding:9px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:2px solid #1B5E35;background:#E8F5E9;color:#1B5E35;font-weight:600;">
              Recto
            </button>
            <button id="opt-duplex"
              style="padding:9px 8px;border-radius:8px;cursor:pointer;font-size:12px;
                border:0.5px solid #ddd;background:#fff;color:#555;font-weight:400;">
              Recto-verso
            </button>
          </div>
        </div>

      </div>

      <div style="display:flex;gap:8px;margin-top:1.25rem;padding-top:1rem;border-top:0.5px solid #eee;">
        <button id="opt-btn-cancel"
          style="flex:1;padding:9px;border-radius:8px;border:0.5px solid #ddd;
            background:#fff;cursor:pointer;font-size:13px;color:#666;font-family:'Inter',sans-serif;">
          Annuler
        </button>
        <button id="opt-btn-confirm"
          style="flex:2;padding:9px;border-radius:8px;border:none;
            background:#D4A017;cursor:pointer;font-size:13px;font-weight:600;
            color:#fff;font-family:'Inter',sans-serif;">
          Confirmer
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Fermeture overlay
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closePrintOptionsModal();
  });

  // Boutons orientation
  modal
    .querySelector("#opt-portrait")
    ?.addEventListener("click", () => setOptOri("portrait"));
  modal
    .querySelector("#opt-landscape")
    ?.addEventListener("click", () => setOptOri("landscape"));

  // Boutons ajustement
  modal
    .querySelector("#opt-fit")
    ?.addEventListener("click", () => setOptFit("fit"));
  modal
    .querySelector("#opt-actual")
    ?.addEventListener("click", () => setOptFit("actual"));

  // Boutons pages
  modal
    .querySelector("#opt-pages-all")
    ?.addEventListener("click", () => setOptPages("all"));
  modal
    .querySelector("#opt-pages-range")
    ?.addEventListener("click", () => setOptPages("range"));

  // Boutons duplex
  modal
    .querySelector("#opt-recto")
    ?.addEventListener("click", () => setOptDuplex("recto"));
  modal
    .querySelector("#opt-duplex")
    ?.addEventListener("click", () => setOptDuplex("duplex"));

  // Annuler / Confirmer
  modal
    .querySelector("#opt-btn-cancel")
    ?.addEventListener("click", () => closePrintOptionsModal());
  modal
    .querySelector("#opt-btn-confirm")
    ?.addEventListener("click", () => confirmPrintOptions(jobId, fileId));

  window._printOptions = {
    jobId,
    fileId,
    orientation: defaultOri,
    fit: "fit",
    pages: "all",
    pageFrom: 1,
    pageTo: 999,
    duplex: "recto",
  };
}

function setOptOri(val) {
  window._printOptions.orientation = val;
  ["portrait", "landscape"].forEach((k) => {
    const b = document.getElementById("opt-" + k);
    if (!b) return;
    if (k === val) {
      b.style.border = "2px solid #1B5E35";
      b.style.background = "#E8F5E9";
      b.style.color = "#1B5E35";
      b.style.fontWeight = "600";
    } else {
      b.style.border = "0.5px solid #ddd";
      b.style.background = "#fff";
      b.style.color = "#555";
      b.style.fontWeight = "400";
    }
  });
}

function setOptFit(val) {
  window._printOptions.fit = val;
  ["fit", "actual"].forEach((k) => {
    const b = document.getElementById("opt-" + k);
    if (!b) return;
    if (k === val) {
      b.style.border = "2px solid #1B5E35";
      b.style.background = "#E8F5E9";
      b.style.color = "#1B5E35";
      b.style.fontWeight = "600";
    } else {
      b.style.border = "0.5px solid #ddd";
      b.style.background = "#fff";
      b.style.color = "#555";
      b.style.fontWeight = "400";
    }
  });
}

function setOptPages(val) {
  window._printOptions.pages = val;
  ["all", "range"].forEach((k) => {
    const b = document.getElementById("opt-pages-" + k);
    if (!b) return;
    if (k === val) {
      b.style.border = "2px solid #1B5E35";
      b.style.background = "#E8F5E9";
      b.style.color = "#1B5E35";
      b.style.fontWeight = "600";
    } else {
      b.style.border = "0.5px solid #ddd";
      b.style.background = "#fff";
      b.style.color = "#555";
      b.style.fontWeight = "400";
    }
  });
  const rangeDiv = document.getElementById("opt-range-inputs");
  if (rangeDiv) rangeDiv.style.display = val === "range" ? "flex" : "none";
}

function setOptDuplex(val) {
  window._printOptions.duplex = val;
  ["recto", "duplex"].forEach((k) => {
    const b = document.getElementById("opt-" + k);
    if (!b) return;
    if (k === val) {
      b.style.border = "2px solid #1B5E35";
      b.style.background = "#E8F5E9";
      b.style.color = "#1B5E35";
      b.style.fontWeight = "600";
    } else {
      b.style.border = "0.5px solid #ddd";
      b.style.background = "#fff";
      b.style.color = "#555";
      b.style.fontWeight = "400";
    }
  });
}

function closePrintOptionsModal() {
  const m = document.getElementById("print-options-modal");
  if (m) m.remove();
}

function confirmPrintOptions(jobId, fileId) {
  const opts = window._printOptions;
  if (opts.pages === "range") {
    opts.pageFrom =
      parseInt(document.getElementById("opt-page-from")?.value) || 1;
    opts.pageTo =
      parseInt(document.getElementById("opt-page-to")?.value) || 999;
  }
  // Stocker les options par fichier
  if (!window._filesPrintOptions) window._filesPrintOptions = {};
  window._filesPrintOptions[jobId + "_" + fileId] = { ...opts };
  closePrintOptionsModal();
}

export function setStoreRef(fn) {
  jobStore_getGroup = fn;
}
