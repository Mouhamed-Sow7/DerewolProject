import jobStore from "../state/jobStore.js";

// ── Notification sonore ───────────────────────────────────────
function playNotification() {
  if (window.__derewolSoundEnabled === false) return;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    [0, 0.18].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.value = 880;
      osc.type = "sine";

      gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + delay + 0.12,
      );

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.12);
    });
  } catch (e) {}
}

// ── Signature util ────────────────────────────────────────────
const sig = (arr) =>
  arr
    .map(
      (g) =>
        `${g.id}:${g.items.map((i) => `${i.jobId}:${i.status}`).join(",")}`,
    )
    .sort()
    .join("|");

// ── Bridge principal ──────────────────────────────────────────
export function initBridge() {
  if (!window.derewol?.onJobReceived) return;

  window.derewol.onJobReceived((jobs) => {
    const currentJobs = jobStore.getJobs();
    const map = {};

    (jobs || []).forEach((job) => {
      const fileGroup = job.file_groups;
      const clientId = fileGroup?.owner_id || "Inconnu";
      const fileGroupId = fileGroup?.id;
      const groupKey = fileGroupId ? `grp-${fileGroupId}` : `grp-${clientId}`;

      if (!map[groupKey]) {
        map[groupKey] = {
          id: groupKey,
          clientId,
          time: new Date(job.created_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          items: [],
          // Statut du groupe depuis file_groups
          groupStatus: fileGroup?.status || "waiting",
        };
      }

      const files = fileGroup?.files || [];
      const linkedFile =
        files.find((f) => f.id === job.file_id) || files[0] || null;

      if (!linkedFile) return;
      if (linkedFile.rejected) return; // Ne pas afficher les fichiers rejetés

      const exists = map[groupKey].items.find((x) => x.jobId === job.id);
      if (!exists) {
        map[groupKey].items.push({
          jobId: job.id,
          fileGroupId,
          fileId: linkedFile.id,
          fileName: linkedFile.file_name,
          status: job.status,
        });
      }
    });

    // Filtrer les groupes vides (tous fichiers rejetés)
    const formatted = Object.values(map).filter((g) => g.items.length > 0);

    const sig = (arr) =>
      arr
        .map(
          (g) =>
            `${g.id}:${g.groupStatus}:${g.items.map((i) => `${i.jobId}`).join(",")}`,
        )
        .sort()
        .join("|");

    if (sig(currentJobs) !== sig(formatted)) {
      console.log("[BRIDGE] Changement → update UI");
      const hasNew = formatted.some(
        (g) => !currentJobs.find((c) => c.id === g.id),
      );
      if (hasNew) playNotification();
      jobStore.setJobs(formatted);
    }
  });
}
