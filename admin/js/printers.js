/**
 * Imprimeurs — aligné avec la table `printers` + abonnements (saas.md).
 * Si `owner_phone` est absent, exécuter admin/sql/optional_printer_owner_phone.sql
 */
async function fetchPrinters(search = "") {
  let query = sb
    .from("printers")
    .select(
      `
      id, slug, name, owner_phone, created_at,
      subscriptions ( id, status, expires_at, activation_code )
    `,
    )
    .order("created_at", { ascending: false });

  const raw = search.trim().replace(/[%_,]/g, "");
  if (raw) {
    query = query.or(`name.ilike.%${raw}%,slug.ilike.%${raw}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function getPrinterSubStatus(printer) {
  const subs = printer.subscriptions || [];
  const now = new Date();
  const active = subs.find(
    (s) =>
      s.status === "active" && s.expires_at && new Date(s.expires_at) > now,
  );
  if (active) {
    const days = Math.ceil(
      (new Date(active.expires_at) - now) / 86400000,
    );
    return { label: `Actif · ${days} j`, cls: "badge-active" };
  }
  const pending = subs.find((s) => s.status === "pending");
  if (pending) return { label: "Code en attente", cls: "badge-pending" };
  const hadActive = subs.some((s) => s.status === "active");
  if (hadActive) return { label: "Expiré", cls: "badge-expired" };
  return { label: "Sans abo", cls: "badge-muted" };
}
