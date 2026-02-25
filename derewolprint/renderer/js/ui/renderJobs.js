// renderer/js/ui/renderJobs.js

// Store copies par fichier — { jobId_fileId: copies }
const copiesPerFile = {};

function getFileCopies(jobId, fileId) {
  return copiesPerFile[`${jobId}_${fileId}`] || 1;
}
function setFileCopies(jobId, fileId, val) {
  copiesPerFile[`${jobId}_${fileId}`] = val;
}

export { getFileCopies };

export default function renderJobs(groups, { onPrint, onReject } = {}) {
  const list = document.getElementById('jobs-list');
  const count = document.getElementById('job-count');

  if (!list || !count) return;

  const totalFiles = groups.reduce((acc, g) => acc + g.items.length, 0);
  count.textContent = `${groups.length} client${groups.length > 1 ? 's' : ''} · ${totalFiles} fichier${totalFiles > 1 ? 's' : ''}`;

  if (groups.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <p>Aucun job en attente</p>
        <span>Les fichiers envoyés apparaîtront ici</span>
      </div>`;
    return;
  }

  const checkedIds = new Set();
  document.querySelectorAll('.job-checkbox:checked').forEach(cb => checkedIds.add(cb.dataset.id));

  list.innerHTML = groups.map(group => {

    const fileRows = group.items.map(item => {
      const copies = getFileCopies(item.jobId, item.fileId);
      return `
        <div class="file-row" data-job-id="${item.jobId}" data-file-id="${item.fileId}">
          <div class="file-row-name-wrap">
            <span class="file-row-icon">📄</span>
            <span class="file-row-name" title="${item.fileName}">${item.fileName}</span>
          </div>
          <div class="file-row-copies">
            <button class="copies-btn minus" data-job-id="${item.jobId}" data-file-id="${item.fileId}">−</button>
            <span class="copies-count" id="fc-${item.jobId}-${item.fileId}">${copies}</span>
            <button class="copies-btn plus" data-job-id="${item.jobId}" data-file-id="${item.fileId}">+</button>
          </div>
        </div>`;
    }).join('');

    return `
    <div class="job-card" id="${group.id}">

      <!-- Header -->
      <div class="job-card-header">
        <div class="job-card-header-left">
          <input type="checkbox" class="job-checkbox" data-id="${group.id}"
            ${checkedIds.has(group.id) ? 'checked' : ''}>
          <div>
            <div class="job-client-id">👤 ${group.clientId}</div>
            <div class="job-time">${group.time} · ${group.items.length} fichier${group.items.length > 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="job-actions">
          <button class="btn-print" data-id="${group.id}">🖨️ Imprimer tout</button>
          <button class="btn-reject" data-id="${group.id}">Rejeter</button>
        </div>
      </div>

      <!-- Fichiers avec copies par fichier -->
      <div class="job-files-list">
        ${fileRows}
      </div>

    </div>`;
  }).join('');

  // ── Events copies par fichier ─────────────────────────────
  document.querySelectorAll('.copies-btn.minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const { jobId, fileId } = btn.dataset;
      const val = Math.max(1, getFileCopies(jobId, fileId) - 1);
      setFileCopies(jobId, fileId, val);
      document.getElementById(`fc-${jobId}-${fileId}`).textContent = val;
    });
  });

  document.querySelectorAll('.copies-btn.plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const { jobId, fileId } = btn.dataset;
      const val = Math.min(20, getFileCopies(jobId, fileId) + 1);
      setFileCopies(jobId, fileId, val);
      document.getElementById(`fc-${jobId}-${fileId}`).textContent = val;
    });
  });

  document.querySelectorAll('.btn-print').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = jobStore_getGroup(btn.dataset.id);
      onPrint?.(btn.dataset.id, group);
    });
  });

  document.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', () => onReject?.(btn.dataset.id));
  });

  document.querySelectorAll('.job-checkbox').forEach(cb => {
    cb.addEventListener('change', window.updateSelectionBar);
  });
}

// Helper — accès store depuis renderJobs
let jobStore_getGroup = () => null;
export function setStoreRef(fn) { jobStore_getGroup = fn; }