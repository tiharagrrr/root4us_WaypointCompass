-- deploy/db/roles.sql: the three Waypoint database roles.
--
--   compass_owner     migrations, the seed, demo reset (DIRECT_URL); owns every table
--   compass_app       the API and the worker (DATABASE_URL); filtered by row-level security
--   compass_readonly  Grafana and reporting
--
-- Once per environment, by an admin, with passwords from the secret store:
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -v db=waypoint \
--     -v owner_password=... -v app_password=... -v readonly_password=... \
--     -f deploy/db/roles.sql
-- Compose runs it through deploy/db/init/00-roles.sh with development passwords.
-- Idempotent: re-running only resets the passwords. Table grants come from the
-- *_platform_integrity migration, not from here.

SELECT format('CREATE ROLE %I', r)
FROM unnest(ARRAY['compass_owner', 'compass_app', 'compass_readonly']) AS r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
\gexec

ALTER ROLE compass_owner LOGIN PASSWORD :'owner_password';
ALTER ROLE compass_app LOGIN PASSWORD :'app_password';
ALTER ROLE compass_readonly LOGIN PASSWORD :'readonly_password';

-- compass_owner creates the tables (public) and the migration journal (drizzle schema).
GRANT CONNECT, CREATE ON DATABASE :"db" TO compass_owner;
GRANT USAGE, CREATE ON SCHEMA public TO compass_owner;
GRANT CONNECT ON DATABASE :"db" TO compass_app, compass_readonly;
