import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

export async function createUserIfNotExists(data) {
  // ── Cherche par téléphone, pas par display_id ─────────────
  const { data: existing, error } = await supabase
    .from("users")
    .select("id, display_id")
    .eq("phone", data.phone)
    .maybeSingle();

  if (error) {
    console.error("Erreur vérification user :", error.message);
    throw new Error(error.message);
  }

  // ── User existant → retourne son display_id ───────────────
  if (existing) {
    return { display_id: existing.display_id };
  }

  // ── Nouveau user → insert avec le display_id généré ───────
  const { error: insertError } = await supabase
    .from("users")
    .insert({
      display_id: data.display_id,
      type: data.type,
      phone: data.phone,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });

  if (insertError) {
    console.error("Erreur création user :", insertError.message);
    throw new Error(insertError.message);
  }

  return { display_id: data.display_id };
}

export default supabase;