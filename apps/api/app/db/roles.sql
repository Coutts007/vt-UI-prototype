-- Database roles (backend-spec 7). Run by the migration, as the database owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vt_app') THEN
    CREATE ROLE vt_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vt_retention') THEN
    CREATE ROLE vt_retention LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vt_readonly') THEN
    CREATE ROLE vt_readonly LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO vt_app, vt_retention, vt_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vt_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vt_app, vt_retention;
REVOKE UPDATE, DELETE ON audit_log, reference_measurement, reference_correction FROM vt_app;
-- Deleting a client would cascade to its profiles. The API marks it and retention removes it.
-- Migration 0003 gives the API DELETE on measurement_profile, for deletion requests only.
REVOKE DELETE ON measurement_profile, client FROM vt_app;
REVOKE ALL ON alembic_version FROM vt_app;
GRANT SELECT ON alembic_version TO vt_app;

GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA public TO vt_retention;
GRANT UPDATE ON client, deletion_request, consent, capture_session TO vt_retention;
GRANT INSERT ON audit_log TO vt_retention;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO vt_readonly;
REVOKE SELECT ON user_account, revoked_token FROM vt_readonly;
