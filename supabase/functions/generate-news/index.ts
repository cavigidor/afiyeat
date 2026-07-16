import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FC_BASE = "https://api.firecrawl.dev/v2";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const ARTICLES_PER_SOURCE = 3;

interface SourceRow {
  id: string;
  city: string;
  url: string;
  label: string | null;
}

interface MentionedRestaurant {
  name: string;
  address: string | null;
}

interface CollectedItem {
  city: string;
  type: string;
  title: string;
  summary: string;
  source_name: string | null;
  source_url: string;
  image_url: string | null;
  mentioned_restaurants: MentionedRestaurant[];
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} missing`);
  return v;
}

async function firecrawlScrape(
  url: string,
  formats: string[],
): Promise<any | null> {
  try {
    const resp = await fetch(`${FC_BASE}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getEnv("FIRECRAWL_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats, onlyMainContent: true }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      console.error("Firecrawl scrape failed", url, resp.status, JSON.stringify(json).slice(0, 300));
      return null;
    }
    return json.data ?? json;
  } catch (e) {
    console.error("Firecrawl scrape error", url, (e as Error).message);
    return null;
  }
}

async function callAI(messages: unknown[]): Promise<any | null> {
  try {
    const resp = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getEnv("LOVABLE_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI call failed", resp.status, t.slice(0, 300));
      return null;
    }
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    try {
      return typeof content === "string" ? JSON.parse(content) : content;
    } catch {
      const cleaned = String(content).replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned);
    }
  } catch (e) {
    console.error("AI call error", (e as Error).message);
    return null;
  }
}

function pickImage(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const keys = ["ogImage", "og:image", "twitter:image", "image"];
  for (const k of keys) {
    const v = metadata[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0] as string;
  }
  return null;
}

async function processSource(source: SourceRow): Promise<CollectedItem[]> {
  const out: CollectedItem[] = [];

  // 1. Scrape the landing page to discover article links.
  const landing = await firecrawlScrape(source.url, ["markdown", "links"]);
  if (!landing) return out;

  const links: string[] = Array.isArray(landing.links) ? landing.links : [];
  const markdown: string = landing.markdown ?? "";

  // 2. Ask AI which links are the most recent/relevant article URLs.
  const selection = await callAI([
    {
      role: "system",
      content:
        "You are given a food/restaurant publication's landing page (markdown) and a list of links found on it. " +
        "Select the most recent, substantive ARTICLE URLs (restaurant openings, closings, reviews, food news, where-to-eat guides). " +
        "Exclude navigation, category, tag, author, login, subscribe, social, and homepage links. " +
        `Return ONLY JSON: {"urls": string[]} with at most ${ARTICLES_PER_SOURCE} absolute URLs.`,
    },
    {
      role: "user",
      content: `Base site: ${source.url}\n\nPage markdown (truncated):\n${markdown.slice(0, 4000)}\n\nLinks:\n${links.slice(0, 120).join("\n")}`,
    },
  ]);

  let urls: string[] = Array.isArray(selection?.urls) ? selection.urls : [];
  urls = urls.filter((u) => typeof u === "string" && u.startsWith("http")).slice(0, ARTICLES_PER_SOURCE);
  if (urls.length === 0) return out;

  // 3. Scrape each article and summarize.
  for (const articleUrl of urls) {
    const article = await firecrawlScrape(articleUrl, ["markdown"]);
    if (!article) continue;
    const content: string = article.markdown ?? "";
    if (content.length < 200) continue;

    const summary = await callAI([
      {
        role: "system",
        content:
          "Summarize this food/restaurant article for a city dining digest. " +
          'Return ONLY JSON: {"title": string, "summary": string, "type": "news" | "rec", ' +
          '"restaurants": {"name": string, "address": string | null}[]}. ' +
          "title: a clean, concise headline. summary: 2-3 sentences capturing the key info. " +
          'type: "rec" if it is a recommendation / best-of / where-to-eat guide, otherwise "news". ' +
          "restaurants: every specific, named restaurant/bar/cafe mentioned in the article (up to 8). " +
          "Use the exact name as written in the article. Include a street address only if the article " +
          "explicitly states one (else null) - do not guess or infer an address. " +
          "Skip generic mentions (e.g. \"the neighborhood's restaurants\") and skip the publication itself. " +
          "Return an empty array if no specific restaurant is named. " +
          "Do not invent facts; only use the article content.",
      },
      {
        role: "user",
        content: content.slice(0, 8000),
      },
    ]);

    if (!summary?.title || !summary?.summary) continue;

    const rawRestaurants: unknown[] = Array.isArray(summary.restaurants) ? summary.restaurants : [];
    const mentionedRestaurants: MentionedRestaurant[] = rawRestaurants
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        name: String((r as Record<string, unknown>).name ?? "").slice(0, 200).trim(),
        address:
          typeof (r as Record<string, unknown>).address === "string"
            ? String((r as Record<string, unknown>).address).slice(0, 300).trim() || null
            : null,
      }))
      .filter((r) => r.name.length > 0)
      .slice(0, 8);

    out.push({
      city: source.city,
      type: summary.type === "rec" ? "rec" : "news",
      title: String(summary.title).slice(0, 300),
      summary: String(summary.summary),
      source_name: source.label,
      source_url: articleUrl,
      image_url: pickImage(article.metadata),
      mentioned_restaurants: mentionedRestaurants,
    });
  }

  return out;
}

async function run(targetCity: string | null) {
  const supabase = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  );

  let query = supabase.from("news_sources").select("*").eq("active", true);
  if (targetCity) query = query.eq("city", targetCity);
  const { data: sources, error: srcErr } = await query;
  if (srcErr) throw srcErr;
  if (!sources || sources.length === 0) {
    console.log("No active sources");
    return;
  }

  // Group sources by city.
  const byCity: Record<string, SourceRow[]> = {};
  for (const s of sources as SourceRow[]) {
    (byCity[s.city] ||= []).push(s);
  }

  for (const [city, citySources] of Object.entries(byCity)) {
    // Process this city's sources in parallel for speed.
    const perSource = await Promise.all(citySources.map((s) => processSource(s)));
    const collected = perSource.flat();

    if (collected.length === 0) {
      console.log(`No items collected for ${city}`);
      continue;
    }

    // Replace the city's existing items with the fresh digest.
    await supabase.from("news_items").delete().eq("city", city);
    const { error: insErr } = await supabase.from("news_items").insert(collected);
    if (insErr) {
      console.error("Insert error", city, insErr.message);
    } else {
      console.log(`Inserted ${collected.length} items for ${city}`);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let targetCity: string | null = null;
  try {
    const body = await req.json();
    if (body?.city) targetCity = String(body.city);
  } catch {
    // no body / not JSON -> process all cities
  }

  // Run the (slow) scraping + summarizing work in the background so the
  // HTTP request returns immediately and isn't killed by request timeouts.
  // @ts-ignore EdgeRuntime is available in the Supabase edge runtime.
  EdgeRuntime.waitUntil(
    run(targetCity).catch((e) => console.error("generate-news run error", (e as Error).message)),
  );

  return new Response(
    JSON.stringify({ ok: true, started: true, city: targetCity ?? "all" }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

