-- Optionnel : colonne pour WhatsApp / relances depuis l’admin (voir admin/js/printers.js)
ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS owner_phone text;

COMMENT ON COLUMN public.printers.owner_phone IS 'Téléphone boutique (relances admin, WhatsApp)';
