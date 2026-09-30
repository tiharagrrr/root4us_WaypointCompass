#!/bin/sh
# Runs once, when the Compose postgres volume is first created
# (docker-entrypoint-initdb.d). Creates compass_owner, compass_app and
# compass_readonly with development passwords; see deploy/db/roles.sql.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v owner_password="${COMPASS_OWNER_PASSWORD:-compass_owner}" \
  -v app_password="${COMPASS_APP_PASSWORD:-compass_app}" \
  -v readonly_password="${COMPASS_READONLY_PASSWORD:-compass_readonly}" \
  -f /waypoint/roles.sql
