import jobStore from '../state/jobStore.js';

// ── Notification sonore ───────────────────────────────────────
function playNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.12);
    });
  } catch(e) {}
}

export function initBridge() {
  if (!window.derewol?.onJobReceived) return;

  window.derewol.onJobReceived((jobs) => {

    // ── Groupe par clientId ───────────────────────────────────
    const map = {};

    jobs.forEach(job => {
      const clientId = job.file_groups?.owner_id || 'Inconnu';

      if (!map[clientId]) {
        map[clientId] = {
          id: job.id,
          clientId,
          time: new Date(job.created_at).toLocaleTimeString(),
          // Chaque entrée = { jobId, fileName, copies }
          items: [],
        };
      }

      // Un job = un file_group = plusieurs fichiers possibles
      const files = job.file_groups?.files || [];
      files.forEach(f => {
        if (!map[clientId].items.find(x => x.jobId === job.id && x.fileId === f.id)) {
          map[clientId].items.push({
            jobId: job.id,
            fileId: f.id,
            fileName: f.file_name,
            copies: 1, // défaut — modifiable par imprimeur
          });
        }
      });
    });

    const formatted = Object.values(map);
    const currentJobs = jobStore.getJobs();

    // Signature — détecte ajout/suppression
    const sig = arr => arr
      .map(g => `${g.clientId}:${g.items.map(i => i.fileId).join(',')}`)
      .sort().join('|');

    if (sig(currentJobs) !== sig(formatted)) {
      console.log('[BRIDGE] Changement → update UI');
      const wasEmpty = currentJobs.length === 0;
      const hasMore = formatted.length > currentJobs.length;
      if (wasEmpty || hasMore) playNotification();
      jobStore.setJobs(formatted);
    }
  });
}