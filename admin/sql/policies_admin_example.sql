-- Exemple de policies pour l’admin (Supabase Auth : un compte « admin »).
-- À exécuter seulement si tu n’as pas encore de lecture/écriture pour `authenticated`.
-- Vérifie les conflits avec tes policies PWA / DerewolPrint existantes.

-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY; -- si besoin

-- DROP POLICY IF EXISTS "admin_select_printers" ON public.printers;
-- CREATE POLICY "admin_select_printers"
--   ON public.printers FOR SELECT TO authenticated USING (true);

-- Idem pour INSERT/UPDATE si tu gères les imprimeurs depuis l’admin.

-- DROP POLICY IF EXISTS "admin_all_subscriptions" ON public.subscriptions;
-- CREATE POLICY "admin_all_subscriptions"
--   ON public.subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);
