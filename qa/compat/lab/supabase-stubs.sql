-- Local stand-ins for what Supabase provides, for the isolated compatibility
-- lab only (never applied to any hosted project). Based on
-- e0/lib/supabase-stubs.sql, extended so a real PostgREST can serve the app:
-- an `authenticator` login role, and auth.uid()/auth.role()/auth.jwt() that
-- read the JWT claims PostgREST sets per request (request.jwt.claims).
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE ROLE supabase_storage_admin NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'lab-only-authenticator';
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA cron; CREATE SCHEMA net;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text,
  raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  email_confirmed_at timestamptz, last_sign_in_at timestamptz,
  aud text DEFAULT 'authenticated', role text DEFAULT 'authenticated'
);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt() ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role', 'anon') $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'email' $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, owner uuid, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now(),
  UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab: buckets readable" ON storage.buckets FOR SELECT USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON storage.buckets TO service_role;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT reverse(split_part(reverse(storage.filename(name)), '.', 1)) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text,
  active boolean NOT NULL DEFAULT true, database text NOT NULL DEFAULT current_database());
CREATE UNIQUE INDEX cron_job_jobname_key ON cron.job (jobname);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = coalesce($2, schedule), command = coalesce($3, command), database = coalesce($4, database), active = coalesce($6, active) WHERE jobid = $1 $$;
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job(jobname, schedule, command) VALUES ($1,$2,$3) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = $1 RETURNING true $$;
CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = $1 RETURNING true $$;
-- Outbound HTTP never leaves the lab: every call is recorded, nothing is sent.
CREATE TABLE net.lab_outbox (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, at timestamptz DEFAULT now());
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 1000)
  RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.lab_outbox(url, body, headers) VALUES ($1, $2, $4) RETURNING id $$;
CREATE PUBLICATION supabase_realtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
