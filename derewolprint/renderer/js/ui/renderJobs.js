// renderer/js/ui/renderJobs.js

/**
 * renderJobs - Affiche la liste des jobs dans l'UI
 * @param {Array} jobs - tableau des jobs {id, fileName, clientId, size, time}
 * @param {Object} callbacks - callbacks pour les actions { onPrint, onReject }
 */
export default function renderJobs(jobs, { onPrint, onReject } = {}) {
  console.log("Jobs reçus pour render:", jobs);

  const list = document.getElementById('jobs-list');
  const count = document.getElementById('job-count');

  if (!list || !count) {
    console.error("DOM manquant : jobs-list ou job-count introuvable");
    return;
  }

  // Met à jour le compteur de jobs
  count.textContent = jobs.length + (jobs.length > 1 ? ' jobs' : ' job');

  // Cas où il n'y a aucun job
  if (jobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <p>Aucun job en attente</p>
        <span>Les fichiers autorisés apparaîtront ici</span>
      </div>
    `;
    return;
  }

  // Génère le HTML de chaque job
  list.innerHTML = jobs.map(job => `
    <div class="job-card" id="${job.id}" style="border:1px solid #ccc; padding:10px; margin-bottom:10px;">
      <input type="checkbox" class="job-checkbox" data-id="${job.id}">
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

  // Attache les callbacks
  document.querySelectorAll('.btn-print').forEach(btn => {
    btn.addEventListener('click', () => onPrint?.(btn.dataset.id));
  });

  document.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', () => onReject?.(btn.dataset.id));
  });

  // Events checkboxes
  document.querySelectorAll('.job-checkbox').forEach(cb => {
    cb.addEventListener('change', window.updateSelectionBar);
  });
}
