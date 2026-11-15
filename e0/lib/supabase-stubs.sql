-- Stand-ins for what Supabase provides. Fixtures only; not part of any proposal.
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA cron; CREATE SCHEMA net;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text, raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text, active boolean NOT NULL DEFAULT true, database text NOT NULL DEFAULT current_database());
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = coalesce($2, schedule), command = coalesce($3, command), database = coalesce($4, database), active = coalesce($6, active) WHERE jobid = $1 $$;
-- Like pg_cron >= 1.3: scheduling an existing job name replaces that job (it does not add a second one).
CREATE UNIQUE INDEX cron_job_jobname_key ON cron.job (jobname);
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname, schedule, command) VALUES ($1,$2,$3) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = $1 RETURNING true $$;
CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 1000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE PUBLICATION supabase_realtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
