-- READ ONLY. E0 containment check for the ISOLATED project. Every row must say ok = true.
-- Run after the baseline load, after each pending migration, and after every test session.
WITH known_outbound(sig) AS (VALUES ('notify_user(uuid,text,text,jsonb)')),
checks(name, ok, detail) AS (
  SELECT 'no active cron job', NOT EXISTS (SELECT 1 FROM cron.job WHERE active),
         coalesce((SELECT string_agg(jobname, ', ') FROM cron.job WHERE active), '')
  UNION ALL
  SELECT 'cron insert/update forces inactive', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'e0_cron_inactive' AND tgrelid = 'cron.job'::regclass AND tgenabled <> 'D'), ''
  UNION ALL
  SELECT 'private.secrets is empty', NOT EXISTS (SELECT 1 FROM private.secrets),
         (SELECT count(*)::text || ' row(s)' FROM private.secrets)
  UNION ALL
  SELECT 'private.secrets is sealed', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'e0_refuse_secrets' AND tgrelid = 'private.secrets'::regclass AND tgenabled <> 'D'), ''
  UNION ALL
  SELECT 'only known functions call net.http_post',
         NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.prosrc ILIKE '%net.http%' AND p.oid::regprocedure::text NOT IN (SELECT sig FROM known_outbound)),
         coalesce((SELECT string_agg(p.oid::regprocedure::text, ', ') FROM pg_proc p WHERE p.prosrc ILIKE '%net.http%' AND p.oid::regprocedure::text NOT IN (SELECT sig FROM known_outbound)), '')
  UNION ALL
  SELECT 'every outbound function needs a secret that is absent',
         NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.prosrc ILIKE '%net.http%' AND p.prosrc NOT ILIKE '%private.secrets%'), ''
  UNION ALL
  SELECT 'no outbound request queued or sent',
         e0_containment.row_count('net.http_request_queue') = 0 AND e0_containment.row_count('net._http_response') = 0,
         e0_containment.row_count('net.http_request_queue') || ' queued, ' || e0_containment.row_count('net._http_response') || ' responses'
  UNION ALL
  SELECT 'load log present', EXISTS (SELECT 1 FROM e0_containment.load_log),
         coalesce((SELECT string_agg(phase || ' ' || left(plan_sha256, 12), '; ' ORDER BY id) FROM e0_containment.load_log), '')
)
SELECT name, ok, detail FROM checks;
