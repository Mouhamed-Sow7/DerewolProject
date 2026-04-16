-- SQL MIGRATIONS FOR SUPABASE
-- Execute FIRST before deploying code changes

-- 1. Fix trial duration from 15 days → 7 days
UPDATE subscriptions
SET duration_days = 7,
    expires_at = activated_at + INTERVAL '7 days'
WHERE plan = 'trial' AND duration_days = 15;

-- 2. Ensure create_trial_subscription function uses 7 days
-- 🔥 FIX: Check for existence explicitly (NO ON CONFLICT needed)
CREATE OR REPLACE FUNCTION create_trial_subscription(p_printer_id UUID)
RETURNS void AS $$
DECLARE
  v_trial_code TEXT;
  v_existing_id UUID;
BEGIN
  -- Check if trial subscription already exists for this printer
  SELECT id INTO v_existing_id
  FROM subscriptions
  WHERE printer_id = p_printer_id
  LIMIT 1;
  
  -- If subscription already exists, don't create
  IF v_existing_id IS NOT NULL THEN
    RAISE LOG 'Trial subscription already exists for printer %', p_printer_id;
    RETURN;
  END IF;
  
  -- First time: create trial
  v_trial_code := 'TRIAL-' || UPPER(SUBSTRING(p_printer_id::text, 1, 8));
  
  INSERT INTO subscriptions (
    printer_id, activation_code, plan, duration_days, amount,
    payment_method, status, activated_at, expires_at
  ) VALUES (
    p_printer_id,
    v_trial_code,
    'trial', 7, 0, 'manual', 'active',
    NOW(), NOW() + INTERVAL '7 days'
  );
  
  RAISE LOG 'Trial subscription created for printer % with code %', p_printer_id, v_trial_code;
END;
$$ LANGUAGE plpgsql;

-- 3. Ensure history table has printed_at not null constraint
ALTER TABLE history
ALTER COLUMN printed_at SET DEFAULT NOW();

-- 4. Create index for faster expiration queries
CREATE INDEX IF NOT EXISTS idx_print_jobs_expires_at 
ON print_jobs(expires_at) 
WHERE status IN ('queued', 'printing');

CREATE INDEX IF NOT EXISTS idx_file_groups_status 
ON file_groups(status) 
WHERE status IN ('waiting', 'printing', 'expired');
