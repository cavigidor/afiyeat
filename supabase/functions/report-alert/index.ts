import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Emails support@afiyeat.com about a new report, so a moderator hears about
// it right away instead of having to check the queue.
//
// Called by the app straight after a report is filed, with the report id.
// It only ever sends for the caller's own report, only once per report
// (content_reports.alerted_at), and only within a few minutes of filing,
// so it can't be used to send arbitrary or repeated email.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALERT_TO = "support@afiyeat.com";
const ALERT_FROM = "Afiyeat <noreply@afiyeat.com>";
const MAX_AGE_MINUTES = 15;
const QUEUE_URL = "https://afiyeat.com/moderation";

const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  dangerous: "Dangerous or illegal",
  copyright: "Copyright",
  other: "Something else",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  content_type: string | null;
  content_id: string | null;
  reason: string;
  description: string | null;
  created_at: string;
  alerted_at: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: userData, error: userError } = await anon.auth.getUser(jwt);
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const reportId = typeof body?.reportId === "string" ? body.reportId : "";
    if (!/^[0-9a-f-]{36}$/i.test(reportId)) return json({ error: "Invalid report." }, 400);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Claim the alert atomically: only one request can flip alerted_at.
    const since = new Date(Date.now() - MAX_AGE_MINUTES * 60_000).toISOString();
    const { data: claimed, error: claimError } = (await admin
      .from("content_reports")
      .update({ alerted_at: new Date().toISOString() })
      .eq("id", reportId)
      .eq("reporter_id", userData.user.id)
      .is("alerted_at", null)
      .gte("created_at", since)
      .select("id, reporter_id, reported_user_id, content_type, content_id, reason, description, created_at, alerted_at")
      .maybeSingle()) as unknown as { data: ReportRow | null; error: { message: string } | null };

    if (claimError) {
      console.error("report-alert claim failed:", claimError.message);
      return json({ error: "Couldn't send the alert." }, 500);
    }
    // Not the caller's report, too old, or already alerted: nothing to do.
    if (!claimed) return json({ ok: true, sent: false });

    const [{ data: people }, { data: hidden }, { count: totalAgainst }] = (await Promise.all([
      admin
        .from("profiles")
        .select("user_id, username, display_name")
        .in("user_id", [claimed.reporter_id, claimed.reported_user_id]),
      claimed.content_id
        ? admin
            .from("moderation_hidden")
            .select("reason")
            .eq("content_type", claimed.content_type ?? "")
            .eq("content_id", claimed.content_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("content_reports")
        .select("id", { count: "exact", head: true })
        .eq("reported_user_id", claimed.reported_user_id),
    ])) as unknown as [
      { data: { user_id: string; username: string | null; display_name: string | null }[] | null },
      { data: { reason: string } | null },
      { count: number | null },
    ];

    const nameOf = (id: string) => {
      const p = (people ?? []).find((x) => x.user_id === id);
      return p?.username ? `@${p.username}` : p?.display_name || "unknown";
    };

    const reason = REASON_LABELS[claimed.reason] ?? claimed.reason;
    const what = claimed.content_type && claimed.content_type !== "user" ? claimed.content_type.replace(/_/g, " ") : "account";
    const autoHidden = hidden?.reason === "auto_reports";

    const subject = `${autoHidden ? "[Auto-hidden] " : ""}New report: ${reason} (${what})`;
    const rows: [string, string][] = [
      ["Reason", reason],
      ["Reported", `${what} by ${nameOf(claimed.reported_user_id)}`],
      ["Reported by", nameOf(claimed.reporter_id)],
      ["Reports against this account", String(totalAgainst ?? 1)],
      ["Status", autoHidden ? "Hidden automatically after several reports" : "Visible, waiting for review"],
    ];
    if (claimed.description) rows.push(["Details", claimed.description]);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px;">
        <h2 style="margin: 0 0 12px;">New report on Afiyeat</h2>
        <table style="border-collapse: collapse; width: 100%;">
          ${rows
            .map(
              ([k, v]) =>
                `<tr><td style="padding: 6px 8px; color: #666; vertical-align: top; white-space: nowrap;">${escapeHtml(k)}</td>` +
                `<td style="padding: 6px 8px;">${escapeHtml(v)}</td></tr>`,
            )
            .join("")}
        </table>
        <p style="margin-top: 16px;">
          <a href="${QUEUE_URL}" style="background: #b8452f; color: #fff; padding: 10px 16px; border-radius: 8px; text-decoration: none;">Open the moderation queue</a>
        </p>
        <p style="color: #888; font-size: 12px;">Apple expects reports to be handled promptly, ideally within 24 hours.</p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY") ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject, html }),
    });

    if (!resp.ok) {
      console.error("report-alert email failed:", resp.status, (await resp.text()).slice(0, 300));
      // Release the claim so a retry can try again.
      await admin.from("content_reports").update({ alerted_at: null }).eq("id", reportId);
      return json({ error: "Couldn't send the alert." }, 502);
    }

    return json({ ok: true, sent: true });
  } catch (err) {
    console.error("report-alert error:", err);
    return json({ error: "Something went wrong." }, 500);
  }
});
