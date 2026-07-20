// supabase/functions/register-printer/index.ts
//
// Inscrit une nouvelle boutique dans la table `printers`. Cette opération
// nécessite le rôle service_role (bypass RLS) car une nouvelle boutique n'a,
// par définition, encore aucun droit d'écriture sur `printers`. Avant cette
// fonction, l'app Electron distribuée aux clients embarquait directement la
// clé service_role pour faire cet insert — un risque de sécurité critique
// (clé admin extractible depuis n'importe quelle installation cliente).
//
// Ici, la clé service_role reste côté serveur : Supabase l'injecte
// automatiquement dans l'environnement de la fonction (SUPABASE_URL et
// SUPABASE_SERVICE_ROLE_KEY sont des secrets intégrés, jamais à configurer
// manuellement). L'app Electron appelle cette fonction avec la clé anon
// (publique par design), jamais avec la clé admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { name, slug, ownerPhone, email } = await req.json();

    if (!name || typeof name !== "string" || !name.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "Nom manquant" }),
        { status: 400, headers: corsHeaders },
      );
    }
    if (!slug || typeof slug !== "string" || !slug.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "Slug manquant" }),
        { status: 400, headers: corsHeaders },
      );
    }

    const owner_phone = (ownerPhone || "").toString().trim() || null;
    const user_email = (email || "").toString().trim() || null;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabaseAdmin
      .from("printers")
      .insert({ name: name.trim(), slug: slug.trim(), owner_phone, email: user_email })
      .select()
      .single();

    if (error) {
      const isDuplicate =
        error.code === "23505" || error.message.includes("duplicate key");
      return new Response(
        JSON.stringify({
          success: false,
          error: isDuplicate
            ? `Le slug "${slug}" est déjà utilisé. Veuillez en choisir un autre.`
            : error.message,
        }),
        { status: isDuplicate ? 409 : 500, headers: corsHeaders },
      );
    }

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: corsHeaders },
    );
  }
});
