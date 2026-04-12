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
    const currentJobMap = new Map(
      currentJobs.map((g) => [
        g.id,
        new Set(g.items.map((item) => item.jobId)),
      ]),
    );
    const map = {};

    (jobs || []).forEach((job) => {
      const clientId = job.file_groups?.owner_id || "Inconnu";
      const grpKey = `grp-${clientId}`;

      if (!map[grpKey]) {
        // Map status EXACTLY: pending, processing, completed, rejected
        let mappedStatus = job.file_groups?.status || job.status || "waiting";
        if (mappedStatus === "queued") mappedStatus = "pending";
        if (mappedStatus === "expired") mappedStatus = "expired";

        map[grpKey] = {
          id: grpKey,
          clientId,
          status: mappedStatus,
          time: new Date(job.created_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          items: [],
          _timestamp: currentTime,
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

    // Update ONLY if data changed - no unnecessary re-renders
    if (currentSig !== newSig) {
      const hasNew = formatted.some((group) => {
        const previousJobIds = currentJobMap.get(group.id);
        if (!previousJobIds) return true;
        return group.items.some((item) => !previousJobIds.has(item.jobId));
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
