const supabase = require('./supabase');

let pollingInterval = null;

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
    console.log('[POLLING] Jobs trouvés :', data.length);
  }

  return data || [];
}

function startPolling(onJobsReceived, intervalMs = 10000) {
  console.log('[POLLING] Démarrage — intervalle', intervalMs / 1000 + 's');
  fetchPendingJobs().then(onJobsReceived);
  pollingInterval = setInterval(async () => {
    const jobs = await fetchPendingJobs();
    onJobsReceived(jobs);
  }, intervalMs);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[POLLING] Arrêté');
  }
}

module.exports = { startPolling, stopPolling };