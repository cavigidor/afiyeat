-- E0 containment for the ISOLATED project. Runs as the LAST statement group of the baseline load, inside
-- the same transaction, so no scheduled job is ever active and no secret can be stored after commit.
-- Touches nothing the fingerprint covers except cron jobs' active flag (compare.mjs --contained expects it).
-- Never run in production.

-- 1. Every pg_cron job stays inactive. Jobs keep their schedule and command, so definitions still compare.
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job LOOP
    PERFORM cron.alter_job(j.jobid, active := false);
  END LOOP;
END $$;

-- 2. No secret can be stored in private.secrets. notify_user() and any older variant post to production's
--    push endpoint only when a secret is present; with this table empty they log a warning and return.
--    The guard lives in schema e0_containment, outside fingerprint coverage.
CREATE SCHEMA IF NOT EXISTS e0_containment;
REVOKE ALL ON SCHEMA e0_containment FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION e0_containment.refuse_secrets() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'E0 containment: no secrets may be stored in the isolated project (private.secrets is sealed)';
END $$;
DROP TRIGGER IF EXISTS e0_refuse_secrets ON private.secrets;
CREATE TRIGGER e0_refuse_secrets BEFORE INSERT OR UPDATE ON private.secrets
  FOR EACH ROW EXECUTE FUNCTION e0_containment.refuse_secrets();
DELETE FROM private.secrets;

-- 3. A job scheduled later (for example by a pending migration) is switched off as it is created.
CREATE OR REPLACE FUNCTION e0_containment.cron_inactive() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.active := false;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS e0_cron_inactive ON cron.job;
CREATE TRIGGER e0_cron_inactive BEFORE INSERT OR UPDATE ON cron.job
  FOR EACH ROW EXECUTE FUNCTION e0_containment.cron_inactive();

-- 4. Row count of a table that may not exist (pg_net's queue tables), for check.sql.
CREATE OR REPLACE FUNCTION e0_containment.row_count(p_table text) RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE n bigint;
BEGIN
  IF to_regclass(p_table) IS NULL THEN RETURN 0; END IF;
  EXECUTE format('SELECT count(*) FROM %s', p_table) INTO n;
  RETURN n;
END $$;

-- 5. Record what was done, with the plan it belongs to (set by the loader).
CREATE TABLE IF NOT EXISTS e0_containment.load_log (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), phase text NOT NULL,
  plan_sha256 text NOT NULL, manifest_sha256 text NOT NULL
);
REVOKE ALL ON e0_containment.load_log FROM PUBLIC, anon, authenticated;
