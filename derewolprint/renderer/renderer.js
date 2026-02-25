/* renderer.js */

import jobStore from "./js/state/jobStore.js";
import renderJobs, { getFileCopies, setStoreRef } from "./js/ui/renderJobs.js";
import { initBridge } from './js/bridge/derewolBridge.js';

const printingGroups = new Set();
setStoreRef(id => jobStore.getJobs().find(g => g.id === id));

let pendingRejectId = null;

function showRejectModal(id) {
  pendingRejectId = id;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  pendingRejectId = null;
  document.getElementById('modal-overlay').classList.remove('active');
}

function updateSelectionBar() {
  const checked = document.querySelectorAll('.job-checkbox:checked');
  const bar = document.getElementById('selection-bar');
  const countEl = document.getElementById('selection-count');
  if (checked.length > 0) {
    bar.style.display = 'flex';
    countEl.textContent = checked.length + ' sélectionné' + (checked.length > 1 ? 's' : '');
  } else {
    bar.style.display = 'none';
  }
}
window.updateSelectionBar = updateSelectionBar;

function confirmReject() {
  const ids = Array.isArray(pendingRejectId) ? pendingRejectId : [pendingRejectId];
  ids.forEach(id => {
    const card = document.getElementById(id);
    if (!card) return;
    card.style.transition = 'opacity 0.3s, height 0.3s, margin 0.3s';
    card.style.opacity = '0';
    card.style.height = card.offsetHeight + 'px';
    requestAnimationFrame(() => {
      card.style.height = '0'; card.style.margin = '0'; card.style.padding = '0';
    });
    setTimeout(() => card.remove(), 300);
    const group = jobStore.getJobs().find(g => g.id === id);
    const jobIds = group?.items?.map(i => i.jobId) || [id];
    jobIds.forEach(jid => window.derewol?.rejectJob?.(jid));
    jobStore.removeJob(id);
  });
  document.querySelector('#modal-overlay .modal h3').textContent = 'Rejeter ce job ?';
  pendingRejectId = null;
  updateSelectionBar();
  closeModal();
}

// ── Impression — copies différentes par fichier ───────────────
function confirmJob(groupId, group) {
  if (printingGroups.has(groupId)) return;
  printingGroups.add(groupId);

  const card = document.getElementById(groupId);
  const btn = card.querySelector('.btn-print');
  const btnReject = card.querySelector('.btn-reject');
  const printerName = document.getElementById('printer-select').value;

  // { jobId, fileName, copies } pour chaque fichier
  const jobCopies = group.items.map(item => ({
    jobId: item.jobId,
    fileName: item.fileName,
    copies: getFileCopies(item.jobId, item.fileId),
  }));

  btn.textContent = `⏳ Impression (${group.items.length} fichier${group.items.length > 1 ? 's' : ''})`;
  btn.disabled = true;
  btn.style.opacity = '0.7';
  btnReject.disabled = true;
  btnReject.style.opacity = '0.3';

  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Annuler';
  btnCancel.className = 'btn-cancel';
  btnCancel.addEventListener('click', () => {
    printingGroups.delete(groupId);
    btn.textContent = '🖨️ Imprimer tout';
    btn.disabled = false; btn.style.opacity = '1';
    btnReject.disabled = false; btnReject.style.opacity = '1';
    btnCancel.remove();
  });
  card.querySelector('.job-actions').appendChild(btnCancel);

  // Passe jobCopies (tableau) à main.js
  window.derewol?.confirmPrint?.(groupId, printerName, 1, jobCopies);
}

initBridge();

window.derewol.getPrinters().then(printers => {
  const select = document.getElementById('printer-select');
  const dot = document.getElementById('printer-dot');
  const blacklist = ['onenote', 'pdf', 'fax', 'xps', 'microsoft'];
  const real = printers.filter(p => !blacklist.some(b => p.name.toLowerCase().includes(b)));
  if (real.length === 0) {
    select.innerHTML = '<option>Aucune imprimante physique</option>';
    dot.style.background = '#ff6b6b';
    return;
  }
  select.innerHTML = real.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  const hp = real.find(p => p.name.toLowerCase().includes('hp'));
  if (hp) select.value = hp.name;
  dot.style.background = 'var(--jaune)';
});

jobStore.subscribe(groups => {
  const filtered = groups.filter(g => !printingGroups.has(g.id));
  renderJobs(filtered, { onPrint: confirmJob, onReject: showRejectModal });
});

document.getElementById('btn-select-all').addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.job-checkbox');
  const allChecked = [...checkboxes].every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
  updateSelectionBar();
});

document.getElementById('btn-reject-selected').addEventListener('click', () => {
  const checked = document.querySelectorAll('.job-checkbox:checked');
  if (!checked.length) return;
  pendingRejectId = [...checked].map(cb => cb.dataset.id);
  document.getElementById('modal-overlay').classList.add('active');
  document.querySelector('#modal-overlay .modal h3').textContent =
    `Rejeter ${checked.length} job${checked.length > 1 ? 's' : ''} ?`;
});

document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-confirm').addEventListener('click', confirmReject);