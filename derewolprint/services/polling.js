const supabase = require("./supabase");

let pollingInterval = null;
let currentCallback = null;
let currentPrinterId = null;
let currentIntervalMs = 1000;

async function expireStaleGroups(printerId) {
  try {
    let query = supabase
      .from("print_jobs")
      .select("id, group_id")
      .eq("status", "queued")
      .lt("expires_at", new Date().toISOString());

    const { data: expiredJobs, error } = await query;
    if (error || !expiredJobs?.length) return;

    const groupIds = [...new Set(expiredJobs.map((j) => j.group_id))];

    // Filtre par printer_id si fourni
    let updateQuery = supabase
      .from("file_groups")
      .update({ status: "expired" })
      .in("id", groupIds)
      .eq("status", "waiting");
    if (printerId) updateQuery = updateQuery.eq("printer_id", printerId);
    await updateQuery;

    await supabase
      .from("print_jobs")
      .update({ status: "expired" })
      .in("group_id", groupIds)
      .eq("status", "queued");

    for (const groupId of groupIds) {
      const { data: files } = await supabase
        .from("files")
        .select("storage_path")
        .eq("group_id", groupId);
      if (files?.length) {
        const paths = files.map((f) => f.storage_path).filter(Boolean);
        if (paths.length)
          await supabase.storage.from("derewol-files").remove(paths);
      }
    }

    console.log(`[POLLING] ${groupIds.length} groupe(s) expiré(s)`);
  } catch (e) {
    console.warn("[POLLING] Erreur expiration :", e.message);
  }
}

async function fetchPendingJobs(printerId) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("print_jobs")
    .select(
      `
      id, status, print_token, created_at, expires_at, file_id,
      copies_requested, copies_remaining,
      file_groups (
        id, owner_id, status, printer_id,
        files ( id, file_name, storage_path, encrypted_key )
      )
    `,
    )
    .in("status", ["queued", "printing", "rejected"])
    .gt("expires_at", new Date().toISOString())
    .gt("created_at", twoHoursAgo);

  // Filtre via file_groups.printer_id
  if (printerId) {
    query = query.eq("file_groups.printer_id", printerId);
  }

  const { data, error } = await query;

  if (error) {
    console.log("[POLLING] Erreur :", error.message);
    return [];
  }

  // Filtre côté JS pour être sûr (Supabase nested filter pas toujours fiable)
  const filtered = (data || []).filter(
    (job) => !printerId || job.file_groups?.printer_id === printerId,
  );

  if (filtered.length > 0)
    console.log("[POLLING] Jobs actifs :", filtered.length);
  return filtered;
}

function startPolling(onJobsReceived, printerId, intervalMs = 1000) {
  // IMPORTANT: Intervalle par défaut réduit à 1s pour sync immédiate
  // L'utilisateur peut l'augmenter dans les settings
  console.log(
    `[POLLING] Démarrage — printer: ${printerId} — intervalle ${intervalMs / 1000}s`,
  );

  // Stocker les paramètres pour redémarrage ultérieur
  currentCallback = onJobsReceived;
  currentPrinterId = printerId;
  currentIntervalMs = intervalMs;

  let lastCallTime = 0;
  let previousJobsJson = "";

  function normalizeJobs(jobsArray) {
    return JSON.stringify(
      (jobsArray || [])
        .map((job) => ({
          id: job.id,
          status: job.status,
          print_token: job.print_token,
          created_at: job.created_at,
          expires_at: job.expires_at,
          file_id: job.file_id,
          copies_requested: job.copies_requested,
          copies_remaining: job.copies_remaining,
          file_groups: {
            id: job.file_groups?.id,
            owner_id: job.file_groups?.owner_id,
            status: job.file_groups?.status,
            printer_id: job.file_groups?.printer_id,
            files: (job.file_groups?.files || []).map((f) => ({
              id: f.id,
              file_name: f.file_name,
              storage_path: f.storage_path,
            })),
          },
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  }

  async function tick() {
    try {
      await expireStaleGroups(printerId);
      const jobs = await fetchPendingJobs(printerId);

      // ═══════════════════════════════════════════════════════════
      // DIFF STRATEGY: Only notify if jobs changed
      // ═══════════════════════════════════════════════════════════

      const currentJobsJson = normalizeJobs(jobs);

      if (currentJobsJson === previousJobsJson) {
        // No changes — skip UI update
        return;
      }

      previousJobsJson = currentJobsJson;

      // Only call callback if data actually changed
      if (jobs.length > 0) {
        lastCallTime = Date.now();
        console.log(
          `[POLLING] ${jobs.length} job(s) actif(s) — timestamp: ${lastCallTime}`,
        );
      }

      onJobsReceived(jobs);
    } catch (e) {
      console.error("[POLLING] Erreur tick:", e.message);
    }
  }

  // Premier appel immédiat
  tick();

  // Puis intervalle régulier
  pollingInterval = setInterval(tick, intervalMs);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  console.log("[POLLING] Arrêté");
}

function restartPolling(newIntervalMs) {
  if (!currentCallback || !currentPrinterId) {
    console.warn("[POLLING] Impossible de redémarrer: pas de contexte");
    return;
  }

  console.log(
    "[POLLING] Redémarrage avec nouvel intervalle:",
    newIntervalMs + "ms",
  );

  stopPolling();
  currentIntervalMs = newIntervalMs;
  startPolling(currentCallback, currentPrinterId, newIntervalMs);
}

module.exports = { startPolling, stopPolling, restartPolling };
