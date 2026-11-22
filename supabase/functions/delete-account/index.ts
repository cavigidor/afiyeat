import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readAppleConfig } from "./apple.ts";
import { createDeleteAccountHandler } from "./handler.ts";

// Deno wiring only. The request handling (unchanged deletion steps, plus Sign in with Apple
// revocation and the discard_new_account safeguard) lives in handler.ts; Apple's REST calls
// in apple.ts. Both are covered by tests/deleteAccount*.test.ts.
//
// Secrets (Edge Function environment):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   as before
//   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (.p8 contents), APPLE_CLIENT_IDS (comma
//   list: bundle id(s) and web Services ID), APPLE_WEB_REDIRECT_URIS (comma list, website
//   only). Without the APPLE_* secrets, accounts with no Apple identity delete exactly as
//   before; accounts with one get "apple_not_configured" and may delete anyway.
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(
  createDeleteAccountHandler({
    createAnonClient: () => createClient(supabaseUrl, supabaseAnonKey),
    createAdminClient: () => createClient(supabaseUrl, supabaseServiceKey),
    appleConfig: readAppleConfig((name) => Deno.env.get(name)),
    fetch: (input, init) => fetch(input, init),
  }),
);
