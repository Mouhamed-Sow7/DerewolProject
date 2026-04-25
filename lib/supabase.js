// lib/supabase.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Résout un slug → printer record ──────────────────────────
export async function getPrinterBySlug(slug) {
  const { data, error } = await supabase
    .from("printers")
    .select("id, slug, name")
    .eq("slug", slug)
    .single();

  if (error || !data) return null;
  return data; // { id, slug, name }
}

// ── Crée un file_group lié à l'imprimeur ──────────────────────
export async function createFileGroup({ ownerId, printerId, copiesCount = 1 }) {
  console.log(
    `[SUPABASE] createFileGroup: ownerId=${ownerId}, printerId=${printerId}, copies=${copiesCount}`,
  );
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  const { data, error } = await supabase
    .from("file_groups")
    .insert({
      owner_id: ownerId,
      printer_id: printerId,
      status: "waiting",
      expires_at: expiresAt,
      copies_count: copiesCount,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  console.log(`[SUPABASE] File group created: id=${data.id}`);
  return data.id;
}

// ── Upload + insert file + print_job (avec copies par fichier) ──
export async function uploadFileToGroup({
  file,
  groupId,
  ownerId,
  printerId,
  copies = 1,
}) {
  console.log(
    `[SUPABASE] uploadFileToGroup: file=${file.name}, groupId=${groupId}, copies=${copies}`,
  );
  const safeName = file.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9.\-_]/g, "")
    .toLowerCase();

  const storagePath = `${printerId}/${ownerId.slice(0, 8)}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("derewol-files")
    .upload(storagePath, file, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (upErr) throw new Error(`Upload échoué : ${upErr.message}`);

  const { data: fileData, error: fileErr } = await supabase
    .from("files")
    .insert({
      group_id: groupId,
      file_name: file.name,
      storage_path: storagePath,
      encrypted_key: null,
      file_hash: null,
    })
    .select("id")
    .single();

  if (fileErr) throw new Error(`Insert file échoué : ${fileErr.message}`);

  console.log(`[SUPABASE] File created: id=${fileData.id}, name=${file.name}`);

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error: jobErr } = await supabase.from("print_jobs").insert({
    group_id: groupId,
    file_id: fileData.id,
    status: "queued",
    copies_requested: copies,
    copies_remaining: copies,
    expires_at: expiresAt,
  });

  if (jobErr) throw new Error(`Insert job échoué : ${jobErr.message}`);

  console.log(
    `[SUPABASE] Print job created: groupId=${groupId}, fileId=${fileData.id}, copies=${copies}`,
  );

  return fileData.id;
}

// ── Met à jour files_count sur un group ──────────────────────
export async function updateFilesCount(groupId, count) {
  await supabase
    .from("file_groups")
    .update({ files_count: count })
    .eq("id", groupId);
}

// ── Fetch groupes d'un owner ──────────────────────────────────
export async function fetchGroupsByOwner(ownerId) {
  if (!ownerId) return [];

  console.log("[FETCH] ownerId:", ownerId);

  const { data, error } = await supabase
    .from("file_groups")
    .select(
      `
      id, status, expires_at, printer_id, files_count, copies_count, created_at,
      files ( id, file_name, storage_path, rejected, rejected_at ),
      print_jobs ( id, status, file_id, copies_requested, copies_remaining, expires_at )
    `,
    )
    .eq("owner_id", ownerId)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(50);

  console.log("[FETCH] résultats:", data?.length, "| error:", error?.message);

  if (error) {
    console.error("[fetchGroupsByOwner] error:", error.message);
    return [];
  }

  return (data || []).map((group) => {
    const files = group.files || [];
    const jobs = group.print_jobs || [];

    // Enrichir chaque fichier avec son statut de job
    const enrichedFiles = files.map((f) => {
      const job = jobs.find((j) => j.file_id === f.id);
      const fallbackJobStatus = (() => {
        if (f.rejected === true) return "rejected";
        if (job?.status) return job.status;
        if (group.status === "waiting") return "queued";
        if (group.status === "printing") return "completed";
        if (
          [
            "completed",
            "partial_completed",
            "failed",
            "rejected",
            "partial_rejected",
          ].includes(group.status)
        )
          return "completed";
        if (group.status === "expired") return "expired";
        return "queued";
      })();

      return {
        ...f,
        isRejected: f.rejected === true || job?.status === "rejected",
        jobStatus: job?.status || fallbackJobStatus,
        jobId: job?.id || null,
      };
    });

    // Dériver un statut d'affichage stable depuis les fichiers
    const rejectedCount = enrichedFiles.filter((f) => f.isRejected).length;
    const activeCount = enrichedFiles.filter(
      (f) => !f.isRejected && ["queued", "printing"].includes(f.jobStatus),
    ).length;
    const completedCount = enrichedFiles.filter(
      (f) => f.jobStatus === "completed",
    ).length;
    const totalCount = enrichedFiles.length || group.files_count || 0;

    let derivedStatus = group.status;

    if (totalCount > 0) {
      if (rejectedCount === totalCount) {
        derivedStatus = "rejected";
      } else if (rejectedCount > 0 && activeCount === 0) {
        derivedStatus = "partial_rejected";
      } else if (completedCount === totalCount) {
        derivedStatus = "completed";
      } else if (completedCount > 0 && activeCount > 0) {
        derivedStatus = "printing"; // En cours
      } else if (completedCount > 0 && activeCount === 0 && rejectedCount > 0) {
        derivedStatus = "partial_completed";
      }
    }

    return {
      ...group,
      files: enrichedFiles,
      derivedStatus, // ← utiliser ceci dans l'UI au lieu de group.status
    };
  });
}

export default supabase;
