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
    .map((g) => `${g.id}:${g.items.map((i) => i.jobId).join(",")}`)
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
      const grpKey = `grp-${clientId}`;

      if (!map[grpKey]) {
        map[grpKey] = {
          id: grpKey,
          clientId,
          time: new Date(job.created_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          items: [],
          _timestamp: currentTime, // Timestamp pour forcer les mises à jour
        };
      }

      const files = job.file_groups?.files || [];

      const linkedFile =
        files.find((f) => f.id === job.file_id) || files[0] || null;

      if (!linkedFile) return;

      const exists = map[grpKey].items.find((x) => x.jobId === job.id);

      if (!exists) {
        map[grpKey].items.push({
          jobId: job.id,
          fileGroupId: job.file_groups?.id,
          fileId: linkedFile.id,
          fileName: linkedFile.file_name,
        });
      }
    });

    const formatted = Object.values(map);
    const currentSig = sig(currentJobs);
    const newSig = sig(formatted);

    console.log(
      "[SIGNATURE] Avant:",
      currentSig.substring(0, 40) + "...",
      "Après:",
      newSig.substring(0, 40) + "...",
      "Identique:",
      currentSig === newSig,
    );

    // IMPORTANT: Mise à jour sur changement DE SIGNATURE
    // OU si jobs.length > 0 (force heartbeat toutes les X secondes)
    if (
      currentSig !== newSig ||
      (formatted.length > 0 && timeSinceUpdate > 5000)
    ) {
      const hasNew = formatted.some(
        (g) => !currentJobs.find((c) => c.id === g.id),
      );

      if (hasNew) {
        console.log("[NEW JOBS] Nouveaux jobs détectés - son activé");
        playNotification();
      } else if (formatted.length > 0) {
        console.log("[HEARTBEAT] Mise à jour forcée du DOM (5s écoulées)");
      }

      lastUpdateTime = currentTime;
      jobStore.setJobs(formatted);
    }
  });
}
