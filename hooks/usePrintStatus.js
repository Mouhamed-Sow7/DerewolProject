import { useState, useEffect, useCallback } from "react";
import supabase from "../lib/supabase";

export default function usePrintStatus(displayId, showToast) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!displayId) return;

    const { data, error } = await supabase
      .from("file_groups")
      .select(
        `
        id, status, approved_at, expires_at,
        files ( id, file_name, file_hash, modified_at ),
        print_jobs ( id, status, copies_requested, copies_remaining )
      `,
      )
      .eq("owner_id", displayId)
      .order("created_at", { ascending: false });

    console.log("[DASHBOARD] Data:", data, "Error:", error);

    if (!error && data) {
      // Filtre côté JS — évite le bug Supabase
      const filtered = data.filter((g) => g.status !== "deleted");

      // Détecte les modifications récentes de fichiers
      const now = Date.now();
      const recentThreshold = 10000; // 10 secondes

      filtered.forEach((group) => {
        if (group.files) {
          group.files.forEach((file) => {
            if (file.modified_at) {
              const modifiedTime = new Date(file.modified_at).getTime();
              if (now - modifiedTime < recentThreshold) {
                showToast?.(
                  `"${file.file_name}" a été mis à jour par l'imprimeur`,
                  "info",
                );
              }
            }
          });
        }
      });

      setGroups(filtered);
    }
    setLoading(false);
  }, [displayId, showToast]);

  useEffect(() => {
    fetch(); // fetch initial

    // ✅ Realtime — réagit dès qu'Electron update file_groups
    const channel = supabase
      .channel("file-groups-status")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "file_groups",
          filter: `owner_id=eq.${displayId}`,
        },
        () => {
          fetch(); // re-fetch à chaque update
        },
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [displayId, fetch]);

  return { groups, loading };
}
