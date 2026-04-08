-- Harden push notification pipeline for production use.
-- Adds token lifecycle fields, multi-device support, and delivery logs.

ALTER TABLE IF EXISTS push_tokens
    DROP CONSTRAINT IF EXISTS push_tokens_user_id_key;

ALTER TABLE IF EXISTS push_tokens
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token_unique
    ON push_tokens(token);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
    ON push_tokens(user_id, is_active);

CREATE TABLE IF NOT EXISTS push_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    ticket_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_logs_user_created
    ON push_delivery_logs(user_id, created_at DESC);
