/**
 * Même projet Supabase que la PWA / DerewolPrint.
 * Renseigner URL + clé anon (compte admin : policies RLS « authenticated » sur printers + subscriptions).
 */
const SUPABASE_URL = "https://bmkvhplsekddrqivpxyy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJta3ZocGxzZWtkZHJxaXZweHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MjQxODIsImV4cCI6MjA4NzAwMDE4Mn0.BeQVYSBkI9Q_Au0ZBzu7LfYg9cwnxBJL5Y5vYvPZfEQ";

/** CDN @supabase/supabase-js@2 — API globale `createClient` */
// IMPORTANT: utiliser `var` pour exposer `window.sb` (les autres scripts s’attendent à `sb`)
var sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
