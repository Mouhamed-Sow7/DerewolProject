/** * Abonnements — même modèle que saas.md / table `subscriptions`. * - Codes `pending` : générés par l'admin, activables dans DerewolPrint (`activateCode`). * - `printer_id` null : code utilisable par n'importe quel imprimeur (première activation assigne). * - Prolongation : gérée côté app au moment de l'activation (base = max(now, expires_at active)). */ function generateActivationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = (n) =>
    Array.from(
      { length: n },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  return `DW-${rand(4)}-${rand(4)}-${rand(4)}`;
}
async function createActivationCode({
  printerId,
  paymentMethod,
  durationDays,
  amount,
  plan,
}) {
  const code = generateActivationCode();
  const { data, error } = await sb
    .from("subscriptions")
    .insert({
      printer_id: printerId || null,
      activation_code: code,
      payment_method: paymentMethod,
      duration_days: durationDays,
      amount: amount,
      plan: plan || "1month",
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
async function fetchSubscriptions(filter = "all") {
  let query = sb
    .from("subscriptions")
    .select("*, printers ( name, slug, owner_phone )")
    .order("created_at", { ascending: false });
  if (filter !== "all") {
    query = query.eq("status", filter);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function revokeSubscription(id) {
  const { error } = await sb
    .from("subscriptions")
    .update({ status: "expired" })
    .eq("id", id);
  if (error) throw error;
}
async function fetchSubStats() {
  const nowIso = new Date().toISOString();
  const in7days = new Date(Date.now() + 7 * 86400000).toISOString();
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  ).toISOString();
  const [printersRes, activeRes, expiringRes, revenueRes] = await Promise.all([
    sb.from("printers").select("id", { count: "exact", head: true }),
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gt("expires_at", nowIso),
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .lte("expires_at", in7days),
    sb
      .from("subscriptions")
      .select("amount")
      .eq("status", "active")
      .gte("activated_at", monthStart)
      .not("activated_at", "is", null),
  ]);
  const totalRevenue = (revenueRes.data || []).reduce(
    (s, r) => s + (Number(r.amount) || 0),
    0,
  );
  return {
    totalPrinters: printersRes.count ?? 0,
    active: activeRes.count ?? 0,
    expiring: expiringRes.count ?? 0,
    revenue: totalRevenue,
  };
}
