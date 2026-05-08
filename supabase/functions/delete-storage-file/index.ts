import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const payload = await req.json();
  const storage_path = payload.old_record?.storage_path || payload.storage_path;

  if (!storage_path) {
    return new Response(JSON.stringify({ error: "no storage_path" }), {
      status: 400,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.storage
    .from("derewol-files")
    .remove([storage_path]);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  return new Response(
    JSON.stringify({ success: true, deleted: storage_path }),
    { status: 200 },
  );
});
