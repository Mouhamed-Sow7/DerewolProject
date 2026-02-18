import jobStore from '../state/jobStore.js';

export function initBridge() {
  if (window.derewol?.onJobReceived) {
    window.derewol.onJobReceived((jobs) => {
      const formatted = jobs.map(job => ({
        id: job.id,
        fileName: job.file_groups?.files?.[0]?.file_name || 'Fichier inconnu',
        clientId: job.file_groups?.owner_id || 'Inconnu',
        size: '— Ko',
        time: new Date(job.created_at).toLocaleTimeString()
      }));

      // Ne re-render que si les jobs ont changé
      const currentIds = jobStore.getJobs().map(j => j.id).join(',');
      const newIds = formatted.map(j => j.id).join(',');
      if (currentIds !== newIds) {
        jobStore.setJobs(formatted);
      }
    });
  }
}