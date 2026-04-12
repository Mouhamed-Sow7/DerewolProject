const supabase = require("./supabase");

let pollingInterval = null;

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
  // Filtre par printer_id — chaque DerewolPrint ne voit que SES jobs
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
    .eq("status", "queued")
    .gt("expires_at", new Date().toISOString());

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

function startPolling(onJobsReceived, printerId, intervalMs = 3000) {
  console.log(
    `[POLLING] Démarrage — printer: ${printerId} — intervalle ${intervalMs / 1000}s`,
  );

  async function tick() {
    await expireStaleGroups(printerId);
    const jobs = await fetchPendingJobs(printerId);
    onJobsReceived(jobs);
  }

  tick();
  pollingInterval = setInterval(tick, intervalMs);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

module.exports = { startPolling, stopPolling };
