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

  let lastUpdateTime = 0;

  window.derewol.onJobReceived((jobs) => {
    const currentTime = Date.now();
    const timeSinceUpdate = currentTime - lastUpdateTime;

    console.log(
      "[JOBS RECEIVED] Nombre:",
      jobs?.length || 0,
      "Temps depuis maj:",
      timeSinceUpdate + "ms",
    );

    const currentJobs = jobStore.getJobs();
    const map = {};

    (jobs || []).forEach((job) => {
      const clientId = job.file_groups?.owner_id || "Inconnu";
      const jobId = job.id;
      const fileGroupId = job.file_groups?.id;
      const groupKey = `grp-${fileGroupId || clientId}`;

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
        };
      }

      const files = job.file_groups?.files || [];
      const linkedFile =
        files.find((f) => f.id === job.file_id) || files[0] || null;

      if (!linkedFile) return;

      const exists = map[groupKey].items.find((x) => x.jobId === jobId);
      if (!exists) {
        map[groupKey].items.push({
          jobId,
          fileGroupId,
          fileId: linkedFile.id,
          fileName: linkedFile.file_name,
          // Conserver le statut du job pour affichage dans l'UI
          status: job.status, // 'queued' | 'printing' | 'rejected'
        });
        console.log(
          `[BRIDGE] Added file: ${linkedFile.file_name} (${job.status}) to group ${groupKey}`,
        );
      }
    });

    // Filtrer les groupes dont TOUS les items sont rejetés → les retirer
    // Mais garder les groupes avec au moins un item queued ou printing
    const formatted = Object.values(map).filter((group) => {
      const hasActive = group.items.some(
        (i) => i.status === "queued" || i.status === "printing",
      );
      const hasRejected = group.items.some((i) => i.status === "rejected");
      // Garder si au moins un actif, ou si récemment rejeté (pour feedback)
      return hasActive || hasRejected;
    });

    const currentSig = sig(currentJobs);
    const newSig = sig(formatted);

    // Update ONLY if data changed - no unnecessary re-renders
    if (currentSig !== newSig) {
      const hasNew = formatted.some((group) => {
        const prevGroup = currentJobs.find((c) => c.id === group.id);
        if (!prevGroup) return true;
        return group.items.some(
          (item) => !prevGroup.items.find((x) => x.jobId === item.jobId),
        );
      });

      if (hasNew) {
        console.log("[NEW JOBS] Nouveaux jobs - notification audio activée");
        playNotification();
      }

      lastUpdateTime = currentTime;
      jobStore.setJobs(formatted);
    }
  });
}
