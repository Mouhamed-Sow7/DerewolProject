const mockJobs = [
  { id: 'job-001', fileName: 'Facture_Mars2026.pdf', clientId: 'DW-392917AB', size: '245 Ko', time: 'Il y a 2 min' },
  { id: 'job-002', fileName: 'CV_Amadou.pdf', clientId: 'DW-AB71234', size: '180 Ko', time: 'Il y a 5 min' },
];

// ── Modal confirmation ──────────────────────────────────────────
let pendingRejectId = null;

function showRejectModal(id) {
  pendingRejectId = id;
  document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
  pendingRejectId = null;
  document.getElementById('modal-overlay').classList.remove('active');
}

function confirmReject() {
  if (!pendingRejectId) return;
  const card = document.getElementById(pendingRejectId);
  card.style.transition = 'opacity 0.3s ease, height 0.3s ease, margin 0.3s ease';
  card.style.opacity = '0';
  card.style.height = card.offsetHeight + 'px';
  requestAnimationFrame(() => { card.style.height = '0'; card.style.margin = '0'; card.style.padding = '0'; });
  setTimeout(() => card.remove(), 300);
  if (window.derewol?.rejectJob) window.derewol.rejectJob(pendingRejectId);
  closeModal();
}

// ── Confirm print ───────────────────────────────────────────────
function confirmJob(id) {
  const card = document.getElementById(id);
  const btn = card.querySelector('.btn-print');
  const btnReject = card.querySelector('.btn-reject');
  btn.textContent = 'Impression...';
  btn.disabled = true;
  btn.style.opacity = '0.7';
  btn.style.cursor = 'not-allowed';
  btnReject.disabled = true;
  btnReject.style.opacity = '0.3';
  btnReject.style.cursor = 'not-allowed';
  if (window.derewol?.confirmPrint) window.derewol.confirmPrint(id);
}

// ── Render ──────────────────────────────────────────────────────
function renderJobs(jobs) {
  const list = document.getElementById('jobs-list');
  const count = document.getElementById('job-count');
  count.textContent = jobs.length + (jobs.length > 1 ? ' jobs' : ' job');

  if (jobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <p>Aucun job en attente</p>
        <span>Les fichiers autorisés apparaîtront ici</span>
      </div>`;
    return;
  }

  list.innerHTML = jobs.map(job => `
    <div class="job-card" id="${job.id}">
      <div class="job-info">
        <div class="job-name">${job.fileName}</div>
        <div class="job-meta">Client : ${job.clientId} · ${job.size} · ${job.time}</div>
      </div>
      <div class="job-actions">
        <button class="btn-print" data-id="${job.id}">Imprimer</button>
        <button class="btn-reject" data-id="${job.id}">Rejeter</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.btn-print').forEach(btn => {
    btn.addEventListener('click', () => confirmJob(btn.dataset.id));
  });

  document.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', () => showRejectModal(btn.dataset.id));
  });
}

renderJobs(mockJobs);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-confirm').addEventListener('click', confirmReject);