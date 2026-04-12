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

      const groupStatus = getStatusConfig(group.status);
      const statusBadge = `<span class="job-status-badge" style="background:${groupStatus.bg};color:${groupStatus.color}">${groupStatus.label}</span>`;
      const disableActions = !["waiting", "queued"].includes(group.status);

      const fileRows = group.items
        .map((item) => {
          const copies = getFileCopies(item.jobId, item.fileId);
          return `
        <div class="file-row" id="file-row-${item.jobId}-${item.fileId}"
          data-job-id="${item.jobId}"
          data-file-id="${item.fileId}"
          data-file-group-id="${item.fileGroupId}">

          <div class="file-row-name-wrap">
            <span class="file-row-icon"><i class="fa-solid ${getFileIconClass(item.fileName)}"></i></span>
            <span class="file-row-name" title="${item.fileName}">${item.fileName}</span>
          </div>

          <div class="file-row-right">
            <!-- Copies par fichier -->
            <div class="file-row-copies">
              <button class="copies-btn minus"
                data-job-id="${item.jobId}"
                data-file-id="${item.fileId}"><i class="fa-solid fa-minus"></i></button>
              <span class="copies-count" id="fc-${item.jobId}-${item.fileId}">${copies}</span>
              <button class="copies-btn plus"
                data-job-id="${item.jobId}"
                data-file-id="${item.fileId}"><i class="fa-solid fa-plus"></i></button>
            </div>

            <!-- Rejet fichier individuel -->
            <button class="btn-reject-file"
              data-job-id="${item.jobId}"
              data-file-id="${item.fileId}"
              data-file-name="${item.fileName}"
              data-group-id="${group.id}"
              title="Retirer ce fichier"
              ${disableActions ? "disabled" : ""}><i class="fa-solid fa-xmark"></i></button>
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
            <div class="job-client-id"><i class="fa-regular fa-user"></i> ${group.items.length > 0 ? group.items[0].fileName : "#" + group.clientId.slice(-8)} ${btBadge}</div>
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
