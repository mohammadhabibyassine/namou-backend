\set ON_ERROR_STOP on

-- Run after the application login/group role has been provisioned. Keeping
-- the role name outside migrations makes the same migration history portable
-- across local, CI, staging, and production environments.
\if :{?application_role}
GRANT EXECUTE ON FUNCTION place_order(
  UUID,
  UUID,
  JSONB,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  TEXT
) TO :"application_role";
\else
\echo 'Missing psql variable: --set=application_role=<trusted_role>'
\quit 3
\endif
