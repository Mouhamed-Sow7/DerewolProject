// renderer.js
import jobStore from "./js/state/jobStore.js";
import renderJobs from "./js/ui/renderJobs.js";
import { initBridge } from './js/bridge/derewolBridge.js';

// ── Variables modale de rejet ─────────────────────────────────
let pendingRejectId = null;

// ── Ouvre la modale de rejet pour un job donné ────────────────
function showRejectModal(id) {
  pendingRejectId = id;
  document.getElementById('modal-overlay').classList.add('active');
}

// ── Ferme la modale de rejet ──────────────────────────────────
function closeModal() {
  pendingRejectId = null;
  document.getElementById('modal-overlay').classList.remove('active');
}

// ── Confirme le rejet d'un job ───────────────────────────────
function confirmReject() {
  if (!pendingRejectId) return;

  const card = document.getElementById(pendingRejectId);

  // Animation disparition
  card.style.transition = 'opacity 0.3s ease, height 0.3s ease, margin 0.3s ease';
  card.style.opacity = '0';
  card.style.height = card.offsetHeight + 'px';
  requestAnimationFrame(() => {
    card.style.height = '0';
    card.style.margin = '0';
    card.style.padding = '0';
  });
  setTimeout(() => card.remove(), 300);

  // Appel backend
  if (window.derewol?.rejectJob) window.derewol.rejectJob(pendingRejectId);

  // Retirer du store
  jobStore.removeJob(pendingRejectId);

  closeModal();
}

// ── Confirme l'impression d'un job ───────────────────────────
function confirmJob(id) {
  const card = document.getElementById(id);
  const btn = card.querySelector('.btn-print');
  const btnReject = card.querySelector('.btn-reject');
  const printerName = document.getElementById('printer-select').value;

  btn.textContent = 'Impression...';
  btn.disabled = true;
  btn.style.opacity = '0.7';
  btn.style.cursor = 'not-allowed';
  btnReject.disabled = true;
  btnReject.style.opacity = '0.3';
  btnReject.style.cursor = 'not-allowed';
  // Ajoute bouton annuler
  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Annuler';
  btnCancel.className = 'btn-cancel';
  btnCancel.addEventListener('click', () => {
    btn.textContent = 'Imprimer';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btnReject.disabled = false;
    btnReject.style.opacity = '1';
    btnReject.style.cursor = 'pointer';
    btnCancel.remove();
    console.log('[PRINT] Annulé par imprimeur');
  });
  card.querySelector('.job-actions').appendChild(btnCancel);
  if (window.derewol?.confirmPrint) window.derewol.confirmPrint(id, printerName);
}

initBridge();

// ── Détecte l'imprimante au démarrage ────────────────────────
window.derewol.getPrinters().then(printers => {
  const select = document.getElementById('printer-select');
  const dot = document.getElementById('printer-dot');

  // Filtre les imprimantes virtuelles
  const blacklist = ['onenote', 'pdf', 'fax', 'xps', 'microsoft'];
  const realPrinters = printers.filter(p => 
    !blacklist.some(b => p.name.toLowerCase().includes(b))
  );

  if (realPrinters.length === 0) {
    select.innerHTML = '<option>Aucune imprimante physique</option>';
    dot.style.background = '#ff6b6b';
    return;
  }

  select.innerHTML = realPrinters.map(p => `
    <option value="${p.name}">${p.name}</option>
  `).join('');

  const hp = realPrinters.find(p => p.name.toLowerCase().includes('hp'));
  if (hp) select.value = hp.name;
  dot.style.background = 'var(--jaune)';
});

// ── Abonnement store pour UI automatique ─────────────────────
jobStore.subscribe((jobs) => {
  renderJobs(jobs, {
    onPrint: confirmJob,
    onReject: showRejectModal
  });
});

// ── Modale boutons ─────────────────────────────────────────
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-confirm').addEventListener('click', confirmReject);

// // ── Test local (mockJobs) ───────────────────────────────────
// const mockJobs = [
//   { id: 'job-001', fileName: 'Facture_Mars2026.pdf', clientId: 'DW-392917AB', size: '245 Ko', time: 'Il y a 2 min' },
//   { id: 'job-002', fileName: 'CV_Amadou.pdf', clientId: 'DW-AB71234', size: '180 Ko', time: 'Il y a 5 min' },
// ];

// // Simule ajout dans store → UI réagit automatiquement
// jobStore.setJobs(mockJobs);
// jobStore.addJob({
//   id: "test-001",
//   fileName: "Test.pdf",
//   clientId: "DW-TEST",
//   size: "120 Ko",
//   time: "Maintenant"
// });
