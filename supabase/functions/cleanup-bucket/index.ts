// supabase/functions/cleanup-bucket/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Récupère tous les storage_path référencés en DB (fichiers actifs)
  const { data: activeFiles } = await supabase
    .from("files")
    .select("storage_path");

  const activePaths = new Set(
    (activeFiles ?? []).map((f) => f.storage_path).filter(Boolean),
  );

  // Liste tous les fichiers du bucket par dossier printer
  const { data: printerFolders } = await supabase.storage
    .from("derewol-files")
    .list("", { limit: 100 });

  const toDelete: string[] = [];
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;

  for (const folder of printerFolders ?? []) {
    // Liste les sous-dossiers owner
    const { data: ownerFolders } = await supabase.storage
      .from("derewol-files")
      .list(folder.name, { limit: 100 });

    for (const ownerFolder of ownerFolders ?? []) {
      const prefix = `${folder.name}/${ownerFolder.name}`;

      // Liste les fichiers dans ce dossier
      const { data: files } = await supabase.storage
        .from("derewol-files")
        .list(prefix, { limit: 500 });

      for (const file of files ?? []) {
        const fullPath = `${prefix}/${file.name}`;
        const isOrphan = !activePaths.has(fullPath);
        const isOld = new Date(file.created_at).getTime() < sixHoursAgo;

        if (isOrphan && isOld) {
          toDelete.push(fullPath);
        }
      }
    }
  }

  // Supprime par batch de 100
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const { error } = await supabase.storage
      .from("derewol-files")
      .remove(batch);
    if (!error) deleted += batch.length;
  }

  // Log dans ta table logs
  await supabase.from("logs").insert({
    event: "cron_cleanup_bucket",
    details: `Supprimé ${deleted} fichiers orphelins sur ${toDelete.length} détectés`,
    created_at: new Date().toISOString(),
  });

  console.log(`Cleanup: ${deleted}/${toDelete.length} fichiers supprimés`);
  return new Response(JSON.stringify({ deleted, toDelete }), {
    headers: { "Content-Type": "application/json" },
  });
});
