-- ════════════════════════════════════════════════════════
-- SQL #3 -> stratosai project (eodmgkcjytkhilxfyvrr)
-- Daily streak + check-in system
-- Copy all -> SQL Editor -> Run
-- ════════════════════════════════════════════════════════

-- Add streak columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_count       INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longest_streak      INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_checkin        TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_checkins      INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shield_active       BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shield_used_at      TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_bonus_count  INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_notified       TIMESTAMPTZ;

-- Index to quickly find users needing a reminder
CREATE INDEX IF NOT EXISTS idx_users_last_checkin ON users(last_checkin);
CREATE INDEX IF NOT EXISTS idx_users_last_notified ON users(last_notified);

-- DONE.
