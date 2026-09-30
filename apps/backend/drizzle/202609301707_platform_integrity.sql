-- What Drizzle can't declare: the append-only audit trigger and the grants for the
-- three database roles, which ops/db/roles.sql creates before the first migration.
-- Hand-written; never edit after merge.

-- audit_events is append-only: UPDATE, DELETE and TRUNCATE raise, whoever runs them.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP
    USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();
--> statement-breakpoint

-- compass_app (API and worker): reads and writes business tables, no DDL, and only
-- INSERT and SELECT on audit_events. Tables added by later migrations inherit the
-- same grants from the role that runs them (compass_owner).
GRANT USAGE ON SCHEMA public TO compass_app, compass_readonly;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO compass_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO compass_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO compass_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO compass_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM compass_app;
--> statement-breakpoint

-- compass_readonly (Grafana, reporting): SELECT everywhere except credentials,
-- sessions, idempotency keys, push keys and webhook secrets, and only the
-- non-sensitive columns of users.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO compass_readonly;
--> statement-breakpoint
REVOKE SELECT ON accounts, sessions, verifications, idempotency_keys, devices, webhook_endpoints
  FROM compass_readonly;
--> statement-breakpoint
REVOKE SELECT ON users FROM compass_readonly;
--> statement-breakpoint
GRANT SELECT (id, name, role, "depotId", "outletId", "defaultVehicleId", "createdAt")
  ON users TO compass_readonly;
--> statement-breakpoint

-- Supabase: nothing in public is reachable through the project's public API key.
-- (Also turn the Data API off in the dashboard.) No-op on plain Postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END $$;
