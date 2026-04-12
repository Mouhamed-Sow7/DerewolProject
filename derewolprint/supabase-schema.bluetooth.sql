-- ============================================================
-- SUPABASE SCHEMA - BLUETOOTH FILES SYNC
-- ============================================================
-- Exécuter ce script dans l'éditeur SQL de Supabase
-- ou via https://supabase.com/dashboard/project/[ID]/sql
-- ============================================================

-- Table pour enregistrer les fichiers reçus par Bluetooth
CREATE TABLE IF NOT EXISTS bluetooth_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_id text UNIQUE NOT NULL, -- ID du fichier BT (bt-reception-{id})
  original_file_name text NOT NULL,
  storage_path text NOT NULL, -- Chemin dans le bucket Supabase Storage
  encryption_key text NOT NULL, -- Clé AES-256 en hexadécimal (à chiffrer avec RLS)
  file_size bigint NOT NULL,
  file_hash text NOT NULL, -- SHA-256 du fichier original
  received_at timestamp with time zone NOT NULL,
  uploaded_at timestamp with time zone NOT NULL,
  status text DEFAULT 'uploaded', -- uploaded, processed, archived
  printer_id uuid REFERENCES public.printers(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_bluetooth_files_bt_id ON bluetooth_files(bt_id);
CREATE INDEX IF NOT EXISTS idx_bluetooth_files_printer_id ON bluetooth_files(printer_id);
CREATE INDEX IF NOT EXISTS idx_bluetooth_files_received_at ON bluetooth_files(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_bluetooth_files_status ON bluetooth_files(status);

-- RLS - Tous les fichiers BT restent privés au niveau application
ALTER TABLE bluetooth_files ENABLE ROW LEVEL SECURITY;

-- Policy: Application peut lire tous les fichiers BT
CREATE POLICY "App can read BT files" ON bluetooth_files
  FOR SELECT USING (true);

-- Policy: Application peut insérer des fichiers BT
CREATE POLICY "App can insert BT files" ON bluetooth_files
  FOR INSERT WITH CHECK (true);

-- Policy: Application peut mettre à jour le statut
CREATE POLICY "App can update BT files" ON bluetooth_files
  FOR UPDATE USING (true) WITH CHECK (true);

-- Table pour l'historique de sync Bluetooth
CREATE TABLE IF NOT EXISTS bluetooth_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_id text NOT NULL REFERENCES bluetooth_files(bt_id) ON DELETE CASCADE,
  action text NOT NULL, -- 'received', 'encrypted', 'uploaded', 'failed', 'synced'
  status text, -- 'success', 'failed'
  message text,
  error_details text,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(bt_id, action, created_at)
);

CREATE INDEX IF NOT EXISTS idx_bluetooth_sync_log_bt_id ON bluetooth_sync_log(bt_id);
CREATE INDEX IF NOT EXISTS idx_bluetooth_sync_log_created_at ON bluetooth_sync_log(created_at DESC);

-- Bucket Storage (créer via l'interface ou via cette commande)
-- Si vous le faites via CLI:
-- supabase storage create bluetooth-files --public false

-- ============================================================
-- OPTIONAL: Fonction pour nettoyer les anciens fichiers
-- Décommenter et exécuter si vous voulez garder seulement
-- 30 jours de fichiers chiffrés
-- ============================================================
-- CREATE OR REPLACE FUNCTION cleanup_old_bluetooth_files()
-- RETURNS void AS $$
-- BEGIN
--   DELETE FROM bluetooth_files
--   WHERE status = 'synced'
--   AND uploaded_at < NOW() - INTERVAL '30 days';
-- END;
-- $$ LANGUAGE plpgsql;

-- -- Trigger pour nettoyer chaque jour à minuit
-- SELECT cron.schedule('cleanup-old-bluetooth-files', '0 0 * * *', 'SELECT cleanup_old_bluetooth_files()');

-- ============================================================
-- VERIFICATION: Vérifier que le bucket 'bluetooth-files' existe
-- ============================================================
-- SELECT name, public FROM storage.buckets WHERE name = 'bluetooth-files';
