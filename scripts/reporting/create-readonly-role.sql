-- Run after migrations, connected as the role that applies them (the database
-- owner: `sww` on the VPS, the DIRECT_URL user elsewhere), so later reporting
-- views are granted automatically. Safe to re-run; it also rotates the password.
--   psql "$DIRECT_URL" -v reporting_password='choose-a-long-random-password' -f scripts/reporting/create-readonly-role.sql
-- Re-run it after `npm run db:restore`, which restores without grants.
-- Metabase connects with this role. It can read only the reporting views, never the base tables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sww_reporting') THEN
    CREATE ROLE sww_reporting LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

ALTER ROLE sww_reporting PASSWORD :'reporting_password';
ALTER ROLE sww_reporting SET default_transaction_read_only = on;
ALTER ROLE sww_reporting SET statement_timeout = '30s';

REVOKE ALL ON SCHEMA public FROM sww_reporting;
SELECT format('GRANT CONNECT ON DATABASE %I TO sww_reporting', current_database()) \gexec
GRANT USAGE ON SCHEMA reporting TO sww_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO sww_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO sww_reporting;
