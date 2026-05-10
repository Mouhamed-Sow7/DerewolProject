const nodemailer = require("nodemailer");
const { supabase } = require("../services/supabase");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "derewolprint@gmail.com",
    pass: "vnba yxcv jvdo abyd",
  },
});

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function requestRecovery(emailOrPhone) {
  const isEmail = emailOrPhone.includes("@");
  const field = isEmail ? "email" : "owner_phone";

  const { data: printer, error } = await supabase
    .from("printers")
    .select("id, email, owner_phone, slug")
    .eq(field, emailOrPhone)
    .single();

  if (error || !printer) {
    throw new Error("Aucun compte trouvé avec cet email ou téléphone.");
  }

  // ✅ Vérifie qu'on a un email pour envoyer le code
  if (!printer.email) {
    throw new Error(
      "Aucun email associé à ce compte. Contactez le support."
    );
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { error: insertError } = await supabase
    .from("recovery_requests")
    .insert({
      printer_id: printer.id,
      email: printer.email,
      phone: printer.owner_phone || null,
      code,
      expires_at: expiresAt,
      used: false,
    });

  if (insertError)
    throw new Error("Erreur création requête: " + insertError.message);

  // ✅ Envoie TOUJOURS à l'email du printer — que ce soit email ou numéro saisi
  await transporter.sendMail({
    from: '"DerewolPrint" <derewolprint@gmail.com>',
    to: printer.email,
    subject: "Ton code de récupération DerewolPrint",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: auto;">
        <h2 style="color: #1a1a2e;">🖨️ DerewolPrint</h2>
        ${!isEmail ? `<p style="color:#888;font-size:13px;">Récupération demandée via numéro : ${emailOrPhone}</p>` : ""}
        <p>Voici ton code de récupération :</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; 
                    color: #6c63ff; text-align: center; padding: 20px; 
                    background: #f4f4ff; border-radius: 8px;">
          ${code}
        </div>
        <p style="color: #888; font-size: 13px; margin-top: 16px;">
          Ce code expire dans 30 minutes. Si tu n'as pas demandé ceci, ignore cet email.
        </p>
      </div>
    `,
  });

  return { success: true, method: isEmail ? "email" : "phone" };
}

async function verifyRecovery(emailOrPhone, code) {
  const isEmail = emailOrPhone.includes("@");
  const field = isEmail ? "email" : "owner_phone";

  // 1. Cherche le code valide
  const { data: requests, error } = await supabase
    .from("recovery_requests")
    .select("*")
    .eq(field, emailOrPhone)
    .eq("code", code)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !requests || requests.length === 0) {
    throw new Error("Code invalide ou expiré.");
  }

  const request = requests[0];

  // 2. Marque comme utilisé
  await supabase
    .from("recovery_requests")
    .update({ used: true })
    .eq("id", request.id);

  // 3. Charge les infos du printer
  const { data: printer } = await supabase
    .from("printers")
    .select("*")
    .eq("id", request.printer_id)
    .single();

  if (!printer) throw new Error("Compte introuvable.");

  return { success: true, printer };
}

module.exports = { requestRecovery, verifyRecovery };
