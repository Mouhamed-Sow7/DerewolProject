import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import supabase from "../lib/supabase";
import { loadSession } from "../lib/helpers";

export default function Status() {
  const router = useRouter();
  const { groupId } = router.query;
  const [job, setJob] = useState(null);
  const [session, setSession] = useState(null);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
  }, []);

  useEffect(() => {
    if (!groupId) return;

    const fetchStatus = async () => {
      const { data } = await supabase
        .from("print_jobs")
        .select("status, created_at")
        .eq("group_id", groupId)
        .single();
      setJob(data);
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [groupId]);

  const statusLabel = {
    queued: "En attente d'impression",
    printing: "Impression en cours...",
    completed: "Imprimé ✅",
    rejected: "Rejeté"
  };

  return (
    <div style={{ padding: "40px", fontFamily: "DM Sans, sans-serif" }}>
      <h1>Statut de votre impression</h1>
      {job ? (
        <p>{statusLabel[job.status] || job.status}</p>
      ) : (
        <p>Chargement...</p>
      )}
    </div>
  );
}