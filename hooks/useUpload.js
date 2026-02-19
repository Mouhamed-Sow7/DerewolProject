import { useState } from "react";
import supabase from "../lib/supabase";
import { loadSession } from "../lib/helpers";

async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function useUpload() {
  const [loading, setLoading] = useState(false);

  async function uploadFiles(files, displayId) {
    setLoading(true);

    const session = loadSession();
    const ownerId = displayId || session.id;

    const { data: groupData, error: groupError } = await supabase
      .from("file_groups")
      .insert([{
        owner_id: ownerId,
        status: "waiting",
        created_at: new Date(),
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000)
      }])
      .select()
      .single();

    if (groupError) throw groupError;

    for (const file of files) {
      const hash = await hashFile(file);

      const path = `${ownerId}/${groupData.id}/${file.name}`;

      await supabase.storage
        .from("derewol-files")
        .upload(path, file);

      await supabase.from("files").insert([{
        group_id: groupData.id,
        file_name: file.name,
        storage_path: path,
        encrypted_key: null,
        file_hash: hash,
        created_at: new Date()
      }]);
    }

    await supabase.from("print_jobs").insert([{
      group_id: groupData.id,
      printer_id: null,
      status: "queued",
      print_token: crypto.randomUUID(),
      created_at: new Date(),
      expires_at: new Date(Date.now() + 20 * 60 * 1000)
    }]);

    setLoading(false);
  }

  return { uploadFiles, loading };
}
