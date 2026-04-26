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

// ── Bénéficie du même owner : trouve un groupe en attente ou en crée un nouveau ──────────────────────
export async function getOrCreateActiveFileGroup({
  ownerId,
  printerId,
  copiesCount = 1,
}) {
  console.log(
    `[SUPABASE] getOrCreateActiveFileGroup: ownerId=${ownerId}, printerId=${printerId}, copies=${copiesCount}`,
  );

  const now = new Date().toISOString();
  const { data: existingGroup, error: existingError } = await supabase
    .from("file_groups")
    .select("id, files_count")
    .eq("owner_id", ownerId)
    .eq("printer_id", printerId)
    .eq("status", "waiting")
    .gt("expires_at", now)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existingError && existingGroup?.id) {
    console.log(`[SUPABASE] Reusing existing group: id=${existingGroup.id}`);
    return {
      groupId: existingGroup.id,
      existingFilesCount: existingGroup.files_count || 0,
      created: false,
    };
  }

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
  return { groupId: data.id, existingFilesCount: 0, created: true };
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
  const { data, error } = await supabase
    .from("file_groups")
    .select(
      `
      id, status, expires_at, printer_id, files_count, copies_count,
      files ( id, file_name, storage_path, rejected, rejected_at ),
      print_jobs ( id, status, file_id, copies_requested, copies_remaining, expires_at )
    `,
    )
    .eq("owner_id", ownerId)
    .neq("status", "deleted");

  if (error) {
    console.error("[SUPABASE] fetchGroupsByOwner error:", error);
    return [];
  }

  if (!data || data.length === 0) {
    console.log("[SUPABASE] No groups found for owner");
    return [];
  }

  console.log("[SUPABASE] Fetched", data.length, "groups");

  return data
    .sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at))
    .map((group) => ({
      ...group,
      files: (group.files || []).map((f) => {
        // Chercher le print_job lié à ce fichier
        const job = (group.print_jobs || []).find((j) => j.file_id === f.id);
        console.log(
          `[SUPABASE] File: ${f.file_name}, rejected: ${f.rejected}, job status: ${job?.status || "none"}`,
        );
        return {
          ...f,
          rejected: f.rejected || job?.status === "rejected",
          jobStatus: job?.status || "queued",
        };
      }),
    }));
}

export default supabase;
