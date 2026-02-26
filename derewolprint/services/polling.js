const supabase = require('./supabase');

let pollingInterval = null;

// ── Expire les jobs dépassés ──────────────────────────────────
// Détecte print_jobs expirés → met file_groups à 'expired'
// + supprime les fichiers Storage associés
async function expireStaleGroups() {
  try {
    // Trouve les print_jobs queued dont expires_at est dépassé
    const { data: expiredJobs, error } = await supabase
      .from('print_jobs')
      .select('id, group_id')
      .eq('status', 'queued')
      .lt('expires_at', new Date().toISOString());

    if (error || !expiredJobs?.length) return;

    const groupIds = [...new Set(expiredJobs.map(j => j.group_id))];
    console.log(`[POLLING] ${groupIds.length} groupe(s) expiré(s) détecté(s)`);

    // file_groups → expired (seulement ceux encore en waiting)
    await supabase
      .from('file_groups')
      .update({ status: 'expired' })
      .in('id', groupIds)
      .eq('status', 'waiting');

    // print_jobs → expired
    await supabase
      .from('print_jobs')
      .update({ status: 'expired' })
      .in('group_id', groupIds)
      .eq('status', 'queued');

    // Supprime fichiers Storage pour libérer espace
    for (const groupId of groupIds) {
      const { data: files } = await supabase
        .from('files')
        .select('storage_path')
        .eq('group_id', groupId);

      if (files?.length) {
        const paths = files.map(f => f.storage_path).filter(Boolean);
        if (paths.length) {
          await supabase.storage.from('derewol-files').remove(paths);
          console.log(`[POLLING] Storage expiré supprimé — groupe ${groupId}`);
        }
      }
    }

  } catch(e) {
    console.warn('[POLLING] Erreur expiration :', e.message);
  }
}

// ── Fetch jobs actifs ─────────────────────────────────────────
async function fetchPendingJobs() {
  const { data, error } = await supabase
    .from('print_jobs')
    .select(`
      id, status, print_token, created_at, expires_at,
      copies_requested, copies_remaining,
      file_groups (
        id, owner_id, status,
        files ( id, file_name, storage_path, encrypted_key )
      )
    `)
    .eq('status', 'queued')
    .gt('expires_at', new Date().toISOString());

  if (error) {
    console.log('[POLLING] Erreur :', error.message);
    return [];
  }

  if (data && data.length > 0) {
    console.log('[POLLING] Jobs actifs :', data.length);
  }

  return data || [];
}

// ── Start ─────────────────────────────────────────────────────
function startPolling(onJobsReceived, intervalMs = 10000) {
  console.log('[POLLING] Démarrage — intervalle', intervalMs / 1000 + 's');

  async function tick() {
    await expireStaleGroups();
    const jobs = await fetchPendingJobs();
    onJobsReceived(jobs);
  }

  tick(); // premier tick immédiat
  pollingInterval = setInterval(tick, intervalMs);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[POLLING] Arrêté');
  }
}

module.exports = { startPolling, stopPolling };