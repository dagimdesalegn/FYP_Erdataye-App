-- Migration tracking table.
-- This migration bootstraps the _migrations table itself.

CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    version INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);
