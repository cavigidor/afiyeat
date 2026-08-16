import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Storage's list() only returns one directory level at a time, and both
// buckets nest images under {userId}/{restaurantId or itemId}/{file} - so
// walk down until every leaf file path under the user's folder is found.
// Entries with a null id are pseudo-folders (no object of their own).
async function collectUserFilePaths(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];

  const paths: string[] = [];
  for (const entry of data) {
    const entryPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      const nested = await collectUserFilePaths(admin, bucket, entryPath);
      paths.push(...nested);
    } else {
      paths.push(entryPath);
    }
  }
  return paths;
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

    // Two tables reference the user with no FK back to auth.users, so they
    // won't be cleaned up by deleteUser()'s cascade below - remove them
    // explicitly first:
    //   - shared_lists (user_a/user_b): a two-person list can't meaningfully
    //     survive one member leaving, so the whole list goes. This cascades
    //     to shared_list_items and shared_list_item_comments too, via their
    //     own FKs to shared_lists/shared_list_items.
    //   - recipes (user_id): no FK at all on this column.
    await admin.from("shared_lists").delete().or(`user_a.eq.${userId},user_b.eq.${userId}`);
    await admin.from("recipes").delete().eq("user_id", userId);

    // Best-effort storage cleanup. Never block account deletion on this -
    // an orphaned file in a bucket nobody can list/reach via the API once
    // the account (and every DB row pointing at it) is gone is a much
    // smaller problem than failing to delete the account at all.
    for (const bucket of IMAGE_BUCKETS) {
      try {
        const paths = await collectUserFilePaths(admin, bucket, userId);
        if (paths.length > 0) {
          await admin.storage.from(bucket).remove(paths);
        }
      } catch (err) {
        console.error(`Storage cleanup failed for bucket ${bucket}:`, err);
      }
    }

    // Deleting the auth user cascades (via each table's own
    // ON DELETE CASCADE back to auth.users) to: profiles, folders,
    // restaurants, restaurant_images, follows, device_tokens,
    // engagement_reminders, custom_lists, custom_list_items,
    // custom_list_types, and custom_list_item_images.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("Failed to delete user:", deleteError);
      return new Response(JSON.stringify({ error: "Failed to delete account" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
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
