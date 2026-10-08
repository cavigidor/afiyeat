import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Every private image bucket that stores files under a {userId}/... prefix.
const IMAGE_BUCKETS = ["restaurant-images", "custom-list-images"] as const;

// Storage's list() returns one directory level per call and at most
// PAGE_SIZE entries per page, so walk every page of every level until each
// leaf file under the user's folder is found. Entries with a null id are
// pseudo-folders (no object of their own). Throws on any listing error so
// the caller can record the failure instead of treating it as "no files".
const PAGE_SIZE = 1000;
const REMOVE_BATCH = 500;

type AdminClient = SupabaseClient;

async function collectUserFilePaths(
  admin: AdminClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: PAGE_SIZE, offset });
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

async function removeUserFiles(admin: AdminClient, bucket: string, userId: string): Promise<number> {
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
async function recordCleanupFailure(
  admin: AdminClient,
  userId: string,
  step: string,
  detail: string,
): Promise<void> {
  console.error(`Account deletion cleanup failed (${step}):`, detail);
  try {
    const { error } = await admin
      .from("account_deletion_cleanup")
      .insert({ deleted_user_id: userId, step, detail: detail.slice(0, 2000) });
    if (error) console.error("Could not record cleanup failure:", error.message);
  } catch (err) {
    console.error("Could not record cleanup failure:", err);
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: userData, error: userError } = await anonClient.auth.getUser(jwt);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const email = userData.user.email?.trim().toLowerCase() ?? null;

    // 1. Delete the auth user first. This cascades (via each table's own
    //    ON DELETE CASCADE back to auth.users) through profiles, folders,
    //    restaurants, restaurant_images, follows, device_tokens,
    //    engagement_reminders, custom_lists and their items/types/statuses/
    //    images, blocks, reports, roles and passport stamps. Referrals keep
    //    their row with the user reference set to NULL.
    //
    //    Doing this first means a failure here leaves everything intact and
    //    the user can simply try again - nothing has been half-deleted.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("Failed to delete user:", deleteError);
      return new Response(JSON.stringify({ error: "Failed to delete account" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 2. Rows with no foreign key back to auth.users, which the cascade
    //    above doesn't reach. Each is checked; failures are recorded rather
    //    than ignored, because the account is already gone and can't retry.
    //   - shared_lists (user_a/user_b): a two-person list can't meaningfully
    //     survive one member leaving, so the whole list goes, cascading to
    //     its items and comments.
    //   - recipes, cellar_items (user_id): no FK on this column.
    //   - email_otp / otp_rate_limits: keyed by email, not user id.
    const rowCleanups: Array<{ step: string; run: () => PromiseLike<{ error: { message: string } | null }> }> = [
      {
        step: "shared_lists",
        run: () => admin.from("shared_lists").delete().or(`user_a.eq.${userId},user_b.eq.${userId}`),
      },
      { step: "recipes", run: () => admin.from("recipes").delete().eq("user_id", userId) },
      { step: "cellar_items", run: () => admin.from("cellar_items").delete().eq("user_id", userId) },
    ];
    if (email) {
      rowCleanups.push(
        { step: "email_otp", run: () => admin.from("email_otp").delete().eq("email", email) },
        { step: "otp_rate_limits", run: () => admin.from("otp_rate_limits").delete().eq("email", email) },
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

    // 3. Image files. Every page of every folder level is listed, and any
    //    listing or removal error is recorded for follow-up.
    for (const bucket of IMAGE_BUCKETS) {
      try {
        await removeUserFiles(admin, bucket, userId);
      } catch (err) {
        await recordCleanupFailure(admin, userId, `storage:${bucket}`, String(err));
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("Error in delete-account function:", error);
    return new Response(JSON.stringify({ error: "An unexpected error occurred" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
