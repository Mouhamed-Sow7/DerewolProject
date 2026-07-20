// supabase/functions/preview-upload/index.ts
//
// Upload un fichier Office déchiffré dans le bucket privé `derewol-previews`
// et retourne une URL signée de courte durée pour un viewer externe
// (Google Docs Viewer / Office Online). Nécessite service_role pour
// bypasser RLS sur un bucket privé — voir register-printer/index.ts pour
// le contexte complet de cette migration.
//
// Le fichier est envoyé encodé en base64 dans le corps JSON (les Edge
// Functions Supabase acceptent jusqu'à plusieurs Mo de payload, largement
// suffisant pour des documents Office classiques).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MIME_TYPES: Record<string, string> = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".doc": "application/msword",
  ".xls": "application/vnd.ms-excel",
};

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { fileBase64, fileName } = await req.json();

    if (!fileBase64 || !fileName) {
      return new Response(
        JSON.stringify({ success: false, error: "fileBase64/fileName manquant" }),
        { status: 400, headers: corsHeaders },
      );
    }

    const ext = ("." + fileName.split(".").pop()).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const previewPath = `tmp/${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16)}${ext}`;
    const fileBytes = base64ToUint8Array(fileBase64);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: uploadError } = await supabaseAdmin.storage
      .from("derewol-previews")
      .upload(previewPath, fileBytes, { contentType, upsert: false });

    if (uploadError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Upload échoué: ${uploadError.message}`,
        }),
        { status: 500, headers: corsHeaders },
      );
    }

    const { data, error: urlError } = await supabaseAdmin.storage
      .from("derewol-previews")
      .createSignedUrl(previewPath, 195);

    if (urlError) {
      await supabaseAdmin.storage.from("derewol-previews").remove([previewPath]);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Signed URL échouée: ${urlError.message}`,
        }),
        { status: 500, headers: corsHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        signedUrl: data.signedUrl,
        previewPath,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: corsHeaders },
    );
  }
});
