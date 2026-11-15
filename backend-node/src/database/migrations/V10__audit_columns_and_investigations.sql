-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V10: Audit Log Columns & Investigations Table
--
-- Purpose:
--   1. Extend audit_log_entries with the columns the audit module has always
--      written (details, user_id, user_agent). The original V1 table only had
--      (id, timestamp, action, plate, remote_address), which made every audit
--      write fail silently. Additive-only: no existing column is modified.
--   2. Promote the investigations (case management) table into version-controlled
--      schema. It previously existed only as an ad-hoc CREATE TABLE IF NOT EXISTS
--      executed at module load with swallowed errors.
-- Rollback limitation: DROP COLUMN / DROP TABLE would discard audit history and
--   case data; not automated. Reverse manually only with explicit approval.
-- ==============================================================================

-- 1. Audit log enrichment (additive)
ALTER TABLE audit_log_entries ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE audit_log_entries ADD COLUMN IF NOT EXISTS user_id VARCHAR(100);
ALTER TABLE audit_log_entries ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log_entries (action);

-- 2. Investigation cases (case management)
CREATE TABLE IF NOT EXISTS investigations (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    assigned_to VARCHAR(100),
    linked_plate VARCHAR(50),
    notes JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations (status);
CREATE INDEX IF NOT EXISTS idx_investigations_updated ON investigations (updated_at DESC);
