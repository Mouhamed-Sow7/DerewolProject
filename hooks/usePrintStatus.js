const fetch = useCallback(async () => {
  if (!displayId) return;
  
  const { data, error } = await supabase
    .from("file_groups")
    .select(`
      id, status, approved_at, expires_at,
      files ( id, file_name, file_hash ),
      print_jobs ( id, status, copies_requested, copies_remaining )
    `)
    .eq("owner_id", displayId)
    .order("created_at", { ascending: false });

  console.log('[DASHBOARD] Data:', data, 'Error:', error);
  
  if (!error && data) {
    // Filtre côté JS — évite le bug Supabase
    const filtered = data.filter(g => g.status !== "deleted");
    setGroups(filtered);
  }
  setLoading(false);
}, [displayId]);