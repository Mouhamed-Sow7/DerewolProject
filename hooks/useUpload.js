import { useState } from "react";
import supabase from "../lib/supabase";
import { loadSession } from "../lib/helpers";

// ── Sanitize nom fichier pour Supabase Storage ────────────────
// Supprime espaces, accents, parenthèses, caractères spéciaux
function sanitizeFileName(name) {
  return name
    .normalize("NFD") // décompose accents
    .replace(/[\u0300-\u036f]/g, "") // supprime diacritiques
    .replace(/\s+/g, "-") // espaces → tirets
    .replace(/[^a-zA-Z0-9.\-_]/g, "_") // autres caractères → underscore
    .replace(/-+/g, "-") // tirets multiples → un seul
    .replace(/_+/g, "_") // underscores multiples → un seul
    .toLowerCase();
}

async function hashFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (e) {
    return "hash-unavailable";
  }
}

function generateToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

export default function useUpload() {
  const [loading, setLoading] = useState(false);

  async function uploadFiles(files) {
    try {
      setLoading(true);
      const session = loadSession();
      if (!session?.display_id)
        return { success: false, message: "Session invalide" };

      const ownerId = session.display_id;

      console.log('[ANON SESSION] ownerId:', ownerId);
      console.log('[ANON SESSION] session complet:', JSON.stringify(session))

      // Crée UN file_group pour tous les fichiers
      const { data: group, error: groupError } = await supabase
        .from("file_groups")
        .insert({
          owner_id: ownerId,
          status: "waiting",
          expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (groupError) throw groupError;

      // Track session anonyme
      const { data: existingSession } = await supabase
        .from('anon_sessions')
        .select('id')
        .eq('owner_id', ownerId)
        .single();

      if (existingSession) {
        await supabase.from('anon_sessions')
          .update({ 
            last_seen_at: new Date().toISOString(),
            upload_count: (existingSession.upload_count || 0) + 1
          })
          .eq('owner_id', ownerId);
      } else {
        await supabase.from('anon_sessions').insert({
          owner_id: ownerId,
          printer_slug: session.printer_slug || null,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          upload_count: 1
        });
      }

      // Upload chaque fichier
      for (const file of files) {
        const safeName = sanitizeFileName(file.name);
        const storagePath = `${ownerId}/${group.id}/${safeName}`;
        const hash = await hashFile(file);

        const { error: uploadError } = await supabase.storage
          .from("derewol-files")
          .upload(storagePath, file);

        if (uploadError)
          throw new Error(
            `Upload échoué pour "${file.name}" : ${uploadError.message}`,
          );

        const { error: fileError } = await supabase.from("files").insert({
          group_id: group.id,
          file_name: file.name, // nom original affiché
          storage_path: storagePath, // chemin sanitizé
          encrypted_key: null,
          file_hash: hash,
        });

        if (fileError) throw fileError;
      }

      // Get all files that were just uploaded
      const { data: uploadedFiles, error: filesError } = await supabase
        .from("files")
        .select("id, storage_path, file_name")
        .eq("group_id", group.id);

      if (filesError || !uploadedFiles?.length)
        throw new Error("Files not found after upload");

      // 🔥 CREATE ONE PRINT_JOB PER FILE (critical for multi-file printing!)
      for (const file of uploadedFiles) {
        const { error: jobError } = await supabase.from("print_jobs").insert({
          group_id: group.id,
          file_id: file.id, // ← Link to specific file!
          status: "queued",
          print_token: generateToken(),
          copies_requested: 1,
          copies_remaining: 1,
          expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        });

        if (jobError) throw jobError;
      }

      return { success: true, groupId: group.id };
    } catch (err) {
      console.error("Upload error:", err.message);
      return { success: false, message: err.message };
    } finally {
      setLoading(false);
    }
  }

  return { uploadFiles, loading };
}
