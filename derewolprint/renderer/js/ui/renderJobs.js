// renderer/js/ui/renderJobs.js

// Store copies par fichier
const copiesPerFile = {};

function getFileCopies(jobId, fileId) {
  return copiesPerFile[`${jobId}_${fileId}`] || 1;
}
function setFileCopies(jobId, fileId, val) {
  copiesPerFile[`${jobId}_${fileId}`] = val;
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
      const disableActions = !["waiting", "queued"].includes(group.groupStatus);

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
            <div class="job-client-id"><i class="fa-regular fa-user"></i> ${group.ownerId ? group.ownerId.substring(0, 20) : "#" + group.clientId.slice(-8)} ${btBadge} ${groupStatusBadge}</div>
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

  document.querySelectorAll(".job-checkbox").forEach((cb) => {
    cb.addEventListener("change", window.updateSelectionBar);
  });
}

// Helper accès store
let jobStore_getGroup = () => null;
export function setStoreRef(fn) {
  jobStore_getGroup = fn;
}
