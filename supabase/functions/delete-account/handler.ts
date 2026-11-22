// delete-account request handling. index.ts wires it to Deno (env, supabase-js, serve); this
// file has no Deno or URL imports so the Node test suite can run it with fake clients.
//
// Request body (JSON, all optional - the app's existing call with no body still works for
// every account without an Apple identity):
//   mode: "delete" (default) | "discard_new_account"
//   apple: { authorization_code, client_id, nonce, redirect_uri? }   fresh Sign in with Apple
//   continue_without_apple_revocation: true   delete even though Apple couldn't be revoked
//
// Order of operations, and why:
//   1. Who is asking (their own JWT) and what the account is (admin lookup of identities).
//   2. discard_new_account only: refuse unless public.social_account_discard_check says the
//      account is brand new and untouched (no data, other sign-in methods or relationships).
//   3. Apple identity only: revoke the Apple authorization BEFORE deleting, while the
//      account still exists to check the Apple subject against. If revocation can't be done,
//      nothing is deleted and the app is told why; the person may then choose to delete
//      anyway (TN3194: the deletion must still be honoured) and remove Afiyeat from their
//      Apple Account settings themselves.
//      If revocation succeeds but deletion then fails, the account is intact and the person
//      can simply try again (they'll be asked to confirm with Apple once more).
//   4. Delete the auth user (cascades through the user's rows), then the rows and files the
//      cascade doesn't reach - unchanged from before.
import { revokeAppleAuthorization, validateReauth, type AppleConfig } from './apple.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-afiyeat-probe',
};

/**
 * What this version supports. The app asks first (header x-afiyeat-probe: capabilities,
 * sent with the publishable key instead of a user session) before any call that relies on
 * the new behaviour. The previous version of this function answers that request with 401
 * "Invalid authorization" WITHOUT deleting anything (the publishable key isn't a user), so
 * an app that ships before this function is deployed never sends a discard request to a
 * function that would ignore the safeguard and delete.
 */
export const CAPABILITIES = ['apple_revocation', 'discard_new_account'] as const;

// supabase-js clients, typed structurally so this file needs no supabase-js import.
// Kept loose on purpose: the fakes in tests/deleteAccount.handler.test.ts implement only the
// calls used here.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface DeleteAccountDeps {
  createAnonClient: () => Client;
  createAdminClient: () => Client;
  appleConfig: AppleConfig | null;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

// Every private image bucket that stores files under a {userId}/... prefix.
const IMAGE_BUCKETS = ['restaurant-images', 'custom-list-images'] as const;

// Storage's list() returns one directory level per call and at most
// PAGE_SIZE entries per page, so walk every page of every level until each
// leaf file under the user's folder is found. Entries with a null id are
// pseudo-folders (no object of their own). Throws on any listing error so
// the caller can record the failure instead of treating it as "no files".
const PAGE_SIZE = 1000;
const REMOVE_BATCH = 500;

async function collectUserFilePaths(admin: Client, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE_SIZE, offset });
    if (error) throw new Error(`list ${bucket}/${prefix} failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const entryPath = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        paths.push(...(await collectUserFilePaths(admin, bucket, entryPath)));
      } else {
        paths.push(entryPath);
      }
    }
    if (data.length < PAGE_SIZE) break;
  }
  return paths;
}

async function removeUserFiles(admin: Client, bucket: string, userId: string): Promise<number> {
  const paths = await collectUserFilePaths(admin, bucket, userId);
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`remove from ${bucket} failed: ${error.message}`);
  }
  return paths.length;
}

// Writes a failed follow-up step to account_deletion_cleanup so it can be
// finished later. Never throws: a logging failure must not turn a
// completed deletion into an error response.
async function recordCleanupFailure(admin: Client, userId: string, step: string, detail: string): Promise<void> {
  console.error(`Account deletion cleanup failed (${step}):`, detail);
  try {
    const { error } = await admin
      .from('account_deletion_cleanup')
      .insert({ deleted_user_id: userId, step, detail: detail.slice(0, 2000) });
    if (error) console.error('Could not record cleanup failure:', error.message);
  } catch (err) {
    console.error('Could not record cleanup failure:', err);
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

/** Provider subject ids of the account's Apple identities (GoTrue stores them several ways). */
export function appleSubjectsOf(user: { identities?: Array<Record<string, unknown>> | null }): string[] {
  const subjects = new Set<string>();
  for (const identity of user.identities ?? []) {
    if (identity.provider !== 'apple') continue;
    const data = (identity.identity_data ?? {}) as Record<string, unknown>;
    for (const v of [data.sub, data.provider_id, identity.provider_id, identity.id]) {
      if (typeof v === 'string' && v) subjects.add(v);
    }
  }
  return [...subjects];
}

type DiscardCheck = { eligible: boolean; reasons: string[] };

async function discardCheck(admin: Client, userId: string): Promise<DiscardCheck | null> {
  const { data, error } = await admin.rpc('social_account_discard_check', { p_user_id: userId });
  if (error || !data || typeof data.eligible !== 'boolean') {
    if (error) console.error('Discard check failed:', error.message);
    return null;
  }
  return { eligible: data.eligible, reasons: Array.isArray(data.reasons) ? data.reasons : [] };
}

export function createDeleteAccountHandler(deps: DeleteAccountDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (req.headers.get('x-afiyeat-probe') === 'capabilities') {
      return json(200, { capabilities: CAPABILITIES });
    }

    try {
      const authHeader = req.headers.get('authorization') ?? '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '');
      if (!jwt) return json(401, { error: 'Missing authorization' });

      const anonClient = deps.createAnonClient();
      const { data: userData, error: userError } = await anonClient.auth.getUser(jwt);
      if (userError || !userData?.user) return json(401, { error: 'Invalid authorization' });
      const userId: string = userData.user.id;

      // An empty or non-JSON body is the original call shape: plain delete.
      let body: Record<string, unknown> = {};
      try {
        const text = await req.text();
        if (text) body = JSON.parse(text);
      } catch {
        return json(400, { error: 'Invalid request body' });
      }
      const mode = body.mode === 'discard_new_account' ? 'discard_new_account' : 'delete';
      if (body.mode !== undefined && body.mode !== 'delete' && body.mode !== 'discard_new_account') {
        return json(400, { error: 'Unknown mode' });
      }
      const continueWithoutApple = body.continue_without_apple_revocation === true;

      const admin = deps.createAdminClient();
      const email = userData.user.email?.trim().toLowerCase() ?? null;

      // 1. The account as the server sees it (identities can't be trusted from the client).
      const { data: adminData, error: adminError } = await admin.auth.admin.getUserById(userId);
      if (adminError || !adminData?.user) {
        console.error('Failed to load user for deletion:', adminError?.message);
        return json(500, { error: 'Failed to delete account' });
      }
      const appleSubjects = appleSubjectsOf(adminData.user);

      // 2. "Already have an Afiyeat account?" may only remove a brand-new, untouched account.
      if (mode === 'discard_new_account') {
        const check = await discardCheck(admin, userId);
        if (!check) return json(503, { error: 'discard_check_unavailable' });
        if (!check.eligible) return json(409, { error: 'account_not_discardable', reasons: check.reasons });
      }

      // 3. Revoke Sign in with Apple before anything is deleted.
      let appleRevocation: 'not_applicable' | 'revoked' | 'skipped' = 'not_applicable';
      if (appleSubjects.length > 0) {
        if (body.apple === undefined) {
          if (!continueWithoutApple) return json(409, { error: 'apple_reauth_required' });
          appleRevocation = 'skipped';
        } else {
          let failure: { status: number; error: string } | null = null;
          if (!deps.appleConfig) {
            failure = { status: 503, error: 'apple_not_configured' };
          } else {
            const reauth = validateReauth(body.apple, deps.appleConfig);
            if (typeof reauth === 'string') {
              failure = { status: 400, error: 'apple_request_invalid' };
              console.error('Apple revocation request invalid:', reauth);
            } else {
              const result = await revokeAppleAuthorization(reauth, appleSubjects, deps.appleConfig, deps.fetch);
              if (result.ok === false) {
                console.error(`Apple revocation failed (${result.error}):`, result.detail);
                const status = result.error === 'apple_revoke_failed' ? 502
                  : result.error === 'apple_not_configured' ? 503 : 400;
                failure = { status, error: result.error };
              }
            }
          }
          if (failure && !continueWithoutApple) return json(failure.status, { error: failure.error });
          appleRevocation = failure ? 'skipped' : 'revoked';
        }
      }

      // Re-check right before deleting, in case anything was added meanwhile.
      if (mode === 'discard_new_account') {
        const check = await discardCheck(admin, userId);
        if (!check) return json(503, { error: 'discard_check_unavailable', apple_revocation: appleRevocation });
        if (!check.eligible) {
          return json(409, { error: 'account_not_discardable', reasons: check.reasons, apple_revocation: appleRevocation });
        }
      }

      // 4. Delete the auth user first. This cascades (via each table's own
      //    ON DELETE CASCADE back to auth.users) through profiles, folders,
      //    restaurants, restaurant_images, follows, device_tokens,
      //    engagement_reminders, custom_lists and their items/types/statuses/
      //    images, blocks, reports, roles, passport stamps and terms
      //    acceptances. Referrals keep their row with the user reference set
      //    to NULL.
      //
      //    Doing this first means a failure here leaves everything intact and
      //    the user can simply try again - nothing has been half-deleted.
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) {
        console.error('Failed to delete user:', deleteError);
        return json(500, { error: 'Failed to delete account', apple_revocation: appleRevocation });
      }

      // 5. Rows with no foreign key back to auth.users, which the cascade
      //    above doesn't reach. Each is checked; failures are recorded rather
      //    than ignored, because the account is already gone and can't retry.
      //   - shared_lists (user_a/user_b): a two-person list can't meaningfully
      //     survive one member leaving, so the whole list goes, cascading to
      //     its items and comments.
      //   - recipes, cellar_items (user_id): no FK on this column.
      //   - email_otp / otp_rate_limits: keyed by email, not user id.
      const rowCleanups: Array<{ step: string; run: () => PromiseLike<{ error: { message: string } | null }> }> = [
        {
          step: 'shared_lists',
          run: () => admin.from('shared_lists').delete().or(`user_a.eq.${userId},user_b.eq.${userId}`),
        },
        { step: 'recipes', run: () => admin.from('recipes').delete().eq('user_id', userId) },
        { step: 'cellar_items', run: () => admin.from('cellar_items').delete().eq('user_id', userId) },
      ];
      if (email) {
        rowCleanups.push(
          { step: 'email_otp', run: () => admin.from('email_otp').delete().eq('email', email) },
          { step: 'otp_rate_limits', run: () => admin.from('otp_rate_limits').delete().eq('email', email) },
        );
      }

      for (const { step, run } of rowCleanups) {
        try {
          const { error } = await run();
          if (error) await recordCleanupFailure(admin, userId, step, error.message);
        } catch (err) {
          await recordCleanupFailure(admin, userId, step, String(err));
        }
      }

      // 6. Image files. Every page of every folder level is listed, and any
      //    listing or removal error is recorded for follow-up.
      for (const bucket of IMAGE_BUCKETS) {
        try {
          await removeUserFiles(admin, bucket, userId);
        } catch (err) {
          await recordCleanupFailure(admin, userId, `storage:${bucket}`, String(err));
        }
      }

      return json(200, { success: true, apple_revocation: appleRevocation });
    } catch (error) {
      console.error('Error in delete-account function:', error);
      return json(500, { error: 'An unexpected error occurred' });
    }
  };
}
