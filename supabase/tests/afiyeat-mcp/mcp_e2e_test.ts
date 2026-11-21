// End-to-end tests for afiyeat-mcp against a local Supabase stand-in (see
// harness.ts and README.md). All data is synthetic and created fresh.
//
// What they prove, through the same HTTP interface ChatGPT uses:
//   * OAuth discovery and 401 challenges are what MCP clients expect
//   * only valid, OAuth-issued user tokens for this project are accepted
//   * each user reads and writes only their own recipes (real RLS policies)
//   * saved recipes are private, every field round-trips exactly, and the
//     saved row is re-read and checked before success is reported
//   * retries (sequential and concurrent) never create duplicates
//   * both the 2025 protocol (MCP SDK v1 client) and the current one work

import { assert, assertEquals, assertExists, assertMatch, assertNotEquals } from "./asserts.ts";
import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport } from "npm:@modelcontextprotocol/client@2.4.0";
import { Client as LegacyClient } from "npm:@modelcontextprotocol/sdk@1.32.2/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "npm:@modelcontextprotocol/sdk@1.32.2/client/streamableHttp.js";
import { type Harness, startHarness } from "./harness.ts";

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

interface McpSession {
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  listTools(): Promise<{ name: string; annotations?: Record<string, unknown>; _meta?: Record<string, unknown> }[]>;
  close(): Promise<void>;
}

async function connect(h: Harness, token: string, era: "legacy" | "modern" = "legacy"): Promise<McpSession> {
  const url = new URL(h.functionUrl);
  const requestInit = { headers: { Authorization: `Bearer ${token}` } };
  // The two SDK generations share this surface; that's all the tests use.
  interface CommonClient {
    callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
    listTools(): Promise<{ tools: Awaited<ReturnType<McpSession["listTools"]>> }>;
    close(): Promise<void>;
  }
  let client: CommonClient;
  if (era === "legacy") {
    const legacy = new LegacyClient({ name: "afiyeat-test-legacy", version: "1.0.0" });
    await legacy.connect(new LegacyTransport(url, { requestInit }));
    client = legacy as unknown as CommonClient;
  } else {
    const modern = new ModernClient({ name: "afiyeat-test-modern", version: "1.0.0" });
    await modern.connect(new ModernTransport(url, { requestInit }));
    client = modern as unknown as CommonClient;
  }
  return {
    call: (name, args) => client.callTool({ name, arguments: args }) as Promise<ToolResult>,
    listTools: async () => (await client.listTools()).tools,
    close: () => client.close(),
  };
}

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
});

async function rawInitialize(h: Harness, authorization?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (authorization !== undefined) headers.authorization = authorization;
  return await fetch(h.functionUrl, { method: "POST", headers, body: initializeBody });
}

function syntheticRecipe(tag: string, overrides: Record<string, unknown> = {}) {
  return {
    title: `Test Lentil Soup ${tag}`,
    description: "Synthetic recipe for automated tests.",
    servings: 4,
    prep_time_minutes: 15,
    cook_time_minutes: 40,
    cook_temp: null,
    cook_temp_unit: null,
    difficulty: "easy",
    ingredients: ["1 cup (200 g) red lentils, rinsed", "1 onion, diced", "4 cups (1 L) vegetable stock", "1 tsp cumin"],
    instructions: ["Soften the onion in oil for 5 minutes.", "Add lentils, stock and cumin.", "Simmer 25 minutes, then blend."],
    tags: ["soup", "vegetarian", "test"],
    user_confirmed: true,
    ...overrides,
  };
}

const text = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("\n");

Deno.test({
  name: "afiyeat-mcp end-to-end",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const h = await startHarness();
    const run = crypto.randomUUID().slice(0, 8);
    try {
      const alice = await h.createUser(`alice-${run}@example.test`);
      const bob = await h.createUser(`bob-${run}@example.test`);
      const aliceToken = await h.mint({ sub: alice });
      const bobToken = await h.mint({ sub: bob });
      const countRows = async (where: string) => Number(await h.sql(`SELECT count(*) FROM public.recipes WHERE ${where}`));

      // ------------------------------------------------------------ discovery
      await t.step("serves OAuth protected resource metadata", async () => {
        const res = await fetch(`${h.functionUrl}/oauth-protected-resource`);
        assertEquals(res.status, 200);
        const meta = await res.json();
        assertEquals(meta.resource, h.functionUrl);
        assertEquals(meta.authorization_servers, [h.issuer]);
        assertEquals(meta.bearer_methods_supported, ["header"]);
      });

      await t.step("no token: 401 with a resource_metadata challenge", async () => {
        const res = await rawInitialize(h);
        await res.body?.cancel();
        assertEquals(res.status, 401);
        assertEquals(
          res.headers.get("www-authenticate"),
          `Bearer resource_metadata="${h.functionUrl}/oauth-protected-resource"`,
        );
      });

      // ------------------------------------------------------- authentication
      const rejected: [string, () => Promise<string>][] = [
        ["malformed token", () => Promise.resolve("Bearer not-a-jwt")],
        ["token signed by another key", async () => `Bearer ${await h.mint({ sub: alice }, { foreignKey: true })}`],
        ["expired token", async () => `Bearer ${await h.mint({ sub: alice, expiresInSeconds: -60 })}`],
        ["token from another issuer", async () =>
          `Bearer ${await h.mint({ sub: alice, iss: "https://other-project.supabase.co/auth/v1" })}`],
        ["app session token without client_id", async () => `Bearer ${await h.mint({ sub: alice, client_id: null })}`],
        ["anonymous user", async () => `Bearer ${await h.mint({ sub: alice, is_anonymous: true })}`],
        ["anon role (public key) as token", async () => `Bearer ${await h.mint({ sub: alice, role: "anon" })}`],
        ["service_role claim", async () => `Bearer ${await h.mint({ sub: alice, role: "service_role" })}`],
      ];
      for (const [label, header] of rejected) {
        await t.step(`rejects ${label}`, async () => {
          const res = await rawInitialize(h, await header());
          const body = await res.json();
          assertEquals(res.status, 401, label);
          assertEquals(body.error, "invalid_token");
          const challenge = res.headers.get("www-authenticate") ?? "";
          assertMatch(challenge, /^Bearer error="invalid_token"/);
          assert(challenge.includes(`resource_metadata="${h.functionUrl}/oauth-protected-resource"`));
        });
      }

      await t.step("accepts a valid token on a legacy HS256 project (Auth validates it)", async () => {
        const session = await connect(h, await h.mint({ sub: alice }, { alg: "HS256" }));
        const res = await session.call("list_my_recipes", {});
        assert(!res.isError, text(res));
        await session.close();
      });

      await t.step("lists the four tools with OAuth security schemes", async () => {
        const session = await connect(h, aliceToken);
        const tools = await session.listTools();
        assertEquals(tools.map((x) => x.name).sort(), ["create_recipe", "get_recipe", "list_my_recipes", "update_recipe"]);
        for (const tool of tools) {
          assertEquals(tool._meta?.securitySchemes, [{ type: "oauth2" }], tool.name);
        }
        const byName = Object.fromEntries(tools.map((x) => [x.name, x]));
        assertEquals(byName.list_my_recipes.annotations?.readOnlyHint, true);
        assertEquals(byName.get_recipe.annotations?.readOnlyHint, true);
        assertEquals(byName.create_recipe.annotations?.readOnlyHint, false);
        assertEquals(byName.create_recipe.annotations?.idempotentHint, true);
        await session.close();
      });

      // ---------------------------------------------------- create + readback
      const alicesSession = await connect(h, aliceToken);
      let aliceRecipeId = "";

      await t.step("create_recipe saves privately with every field exact", async () => {
        const input = syntheticRecipe(`A-${run}`, {
          cook_temp: 180,
          cook_temp_unit: "C",
          instructions: ["1. Soften the onion in oil for 5 minutes.", "Step 2: Add lentils, stock and cumin.", "Simmer 25 minutes, then blend."],
          tags: ["soup", "#vegetarian", "Soup", "test"],
        });
        const res = await alicesSession.call("create_recipe", input);
        assert(!res.isError, text(res));
        const out = res.structuredContent as { recipe_id: string; status: string; recipe: Record<string, unknown> };
        assertEquals(out.status, "created");
        aliceRecipeId = out.recipe_id;
        assertMatch(aliceRecipeId, /^[0-9a-f-]{36}$/);
        assert(text(res).includes(aliceRecipeId));

        const expected = {
          title: input.title,
          description: input.description,
          servings: 4,
          prep_time_minutes: 15,
          cook_time_minutes: 40,
          cook_temp: 180,
          cook_temp_unit: "C",
          difficulty: "easy",
          ingredients: input.ingredients,
          instructions: ["Soften the onion in oil for 5 minutes.", "Add lentils, stock and cumin.", "Simmer 25 minutes, then blend."],
          tags: ["soup", "vegetarian", "test"],
          is_public: false,
          saved_from_chatgpt: true,
        };
        for (const [k, v] of Object.entries(expected)) assertEquals(out.recipe[k], v, k);

        // Independent readback straight from Postgres, as the app would see the row.
        const row = JSON.parse(await h.sql(
          `SELECT row_to_json(r) FROM (SELECT user_id, title, description, servings, prep_time_minutes, ` +
            `cook_time_minutes, cook_temp, cook_temp_unit, difficulty, ingredients, instructions, tags, ` +
            `image_url, is_public, source, import_key FROM public.recipes WHERE id = '${aliceRecipeId}') r`,
        ));
        assertEquals(row.user_id, alice);
        assertEquals(row.is_public, false);
        assertEquals(row.source, "chatgpt");
        assertEquals(row.image_url, null);
        assertMatch(row.import_key, /^chatgpt:v1:[0-9a-f]{64}$/);
        for (const k of ["title", "description", "servings", "prep_time_minutes", "cook_time_minutes", "cook_temp",
          "cook_temp_unit", "difficulty", "ingredients", "instructions", "tags"]) {
          assertEquals(row[k], (expected as Record<string, unknown>)[k], `db ${k}`);
        }
      });

      await t.step("get_recipe reads the saved recipe back", async () => {
        const res = await alicesSession.call("get_recipe", { recipe_id: aliceRecipeId });
        assert(!res.isError, text(res));
        const recipe = (res.structuredContent as { recipe: Record<string, unknown> }).recipe;
        assertEquals(recipe.id, aliceRecipeId);
        assertEquals(recipe.is_public, false);
        assertEquals((recipe.ingredients as string[]).length, 4);
      });

      await t.step("the row matches what the app's My Recipes query returns", async () => {
        // Recipes.tsx: from('recipes').select('*').eq('user_id', user.id), as the user.
        const res = await fetch(`${h.baseUrl}/rest/v1/recipes?select=*&user_id=eq.${alice}&order=created_at.desc`, {
          headers: { Authorization: `Bearer ${await h.mint({ sub: alice, client_id: null })}` },
        });
        const rows = await res.json() as Record<string, unknown>[];
        const row = rows.find((r) => r.id === aliceRecipeId);
        assertExists(row);
        assert(Array.isArray(row.ingredients) && Array.isArray(row.instructions) && Array.isArray(row.tags));
        assertEquals(row.is_public, false);
      });

      // -------------------------------------------------- duplicate prevention
      await t.step("saving the same recipe again returns the existing one", async () => {
        const input = syntheticRecipe(`A-${run}`, {
          cook_temp: 180,
          cook_temp_unit: "C",
          instructions: ["1. Soften the onion in oil for 5 minutes.", "Step 2: Add lentils, stock and cumin.", "Simmer 25 minutes, then blend."],
          tags: ["soup", "#vegetarian", "Soup", "test"],
        });
        // Retried with cosmetic differences that don't change the recipe.
        input.title = `  test lentil   soup A-${run} `;
        const res = await alicesSession.call("create_recipe", input);
        assert(!res.isError, text(res));
        const out = res.structuredContent as { recipe_id: string; status: string };
        assertEquals(out.status, "already_saved");
        assertEquals(out.recipe_id, aliceRecipeId);
        assertEquals(await countRows(`user_id = '${alice}' AND title ILIKE '%lentil soup A-${run}%'`), 1);
      });

      await t.step("concurrent identical saves create exactly one row", async () => {
        const input = syntheticRecipe(`race-${run}`);
        const sessions = await Promise.all(Array.from({ length: 6 }, () => connect(h, aliceToken)));
        const results = await Promise.all(sessions.map((s) => s.call("create_recipe", input)));
        await Promise.all(sessions.map((s) => s.close()));
        for (const r of results) assert(!r.isError, text(r));
        const ids = new Set(results.map((r) => (r.structuredContent as { recipe_id: string }).recipe_id));
        assertEquals(ids.size, 1);
        assertEquals(results.filter((r) => (r.structuredContent as { status: string }).status === "created").length, 1);
        assertEquals(await countRows(`user_id = '${alice}' AND title = 'Test Lentil Soup race-${run}'`), 1);
      });

      await t.step("a genuinely different recipe is saved separately", async () => {
        const res = await alicesSession.call("create_recipe", syntheticRecipe(`A-${run}`, { servings: 6 }));
        const out = res.structuredContent as { recipe_id: string; status: string };
        assertEquals(out.status, "created");
        assertNotEquals(out.recipe_id, aliceRecipeId);
      });

      // ------------------------------------------------- input validation
      const before = await countRows(`user_id = '${alice}'`);
      const invalid: [string, Record<string, unknown>][] = [
        ["without user_confirmed", (() => {
          const r = syntheticRecipe(`bad1-${run}`) as Record<string, unknown>;
          delete r.user_confirmed;
          return r;
        })()],
        ["with user_confirmed false", syntheticRecipe(`bad2-${run}`, { user_confirmed: false })],
        ["with no ingredients", syntheticRecipe(`bad3-${run}`, { ingredients: [] })],
        ["with no instructions", syntheticRecipe(`bad4-${run}`, { instructions: [] })],
        ["with a blank title", syntheticRecipe(`bad5-${run}`, { title: "   " })],
        ["with a temperature but no unit", syntheticRecipe(`bad6-${run}`, { cook_temp: 200 })],
        ["trying to set user_id", syntheticRecipe(`bad7-${run}`, { user_id: bob })],
        ["trying to make it public", syntheticRecipe(`bad8-${run}`, { is_public: true })],
        ["with negative servings", syntheticRecipe(`bad9-${run}`, { servings: -2 })],
      ];
      for (const [label, args] of invalid) {
        await t.step(`create_recipe refuses a call ${label}`, async () => {
          const res = await alicesSession.call("create_recipe", args);
          assertEquals(res.isError, true, `${label}: ${text(res)}`);
        });
      }
      await t.step("refused calls wrote nothing", async () => {
        assertEquals(await countRows(`user_id = '${alice}'`), before);
        assertEquals(await countRows(`user_id = '${bob}'`), 0);
      });

      // ------------------------------------------------------ owner isolation
      const alicePublicId = await h.sql(
        `INSERT INTO public.recipes (user_id, title, ingredients, instructions, is_public) VALUES ` +
          `('${alice}', 'Alice Public Test Bread ${run}', '["flour"]', '["bake"]', true) RETURNING id`,
      );
      const bobsSession = await connect(h, bobToken);

      await t.step("another user's list shows none of Alice's recipes, public or private", async () => {
        const res = await bobsSession.call("list_my_recipes", { limit: 50 });
        assert(!res.isError, text(res));
        const out = res.structuredContent as { recipes: { id: string }[]; total: number };
        assertEquals(out.total, 0);
        assertEquals(out.recipes, []);
      });

      await t.step("another user cannot read Alice's private or public recipe by ID", async () => {
        for (const id of [aliceRecipeId, alicePublicId]) {
          const res = await bobsSession.call("get_recipe", { recipe_id: id });
          assertEquals(res.isError, true);
          assert(!text(res).includes("Lentil") && !text(res).includes("Bread"), "no content leaked");
        }
      });

      await t.step("another user cannot update Alice's recipe", async () => {
        const res = await bobsSession.call("update_recipe", { recipe_id: aliceRecipeId, title: "Hijacked", user_confirmed: true });
        assertEquals(res.isError, true);
        assertEquals(await h.sql(`SELECT title FROM public.recipes WHERE id = '${aliceRecipeId}'`), `Test Lentil Soup A-${run}`);
      });

      await t.step("RLS hides Alice's ChatGPT recipe from Bob even via the raw REST API", async () => {
        const res = await fetch(`${h.baseUrl}/rest/v1/recipes?select=id&id=eq.${aliceRecipeId}`, {
          headers: { Authorization: `Bearer ${bobToken}` },
        });
        assertEquals(await res.json(), []);
      });

      await t.step("the same content saved by Bob becomes Bob's own separate recipe", async () => {
        const res = await bobsSession.call("create_recipe", syntheticRecipe(`race-${run}`));
        const out = res.structuredContent as { recipe_id: string; status: string };
        assertEquals(out.status, "created");
        assertEquals(await h.sql(`SELECT user_id FROM public.recipes WHERE id = '${out.recipe_id}'`), bob);
        assertEquals(await countRows(`title = 'Test Lentil Soup race-${run}'`), 2);
      });

      // -------------------------------------------------------- list + update
      await t.step("list_my_recipes filters, pages and escapes search text", async () => {
        const all = (await alicesSession.call("list_my_recipes", { limit: 50 })).structuredContent as {
          recipes: { id: string; saved_from_chatgpt: boolean }[];
          total: number;
        };
        assertEquals(all.total, 4); // 3 from ChatGPT + 1 made "in the app"
        const fromChatgpt = (await alicesSession.call("list_my_recipes", { only_from_chatgpt: true })).structuredContent as {
          recipes: { saved_from_chatgpt: boolean }[];
        };
        assertEquals(fromChatgpt.recipes.length, 3);
        assert(fromChatgpt.recipes.every((r) => r.saved_from_chatgpt));
        const page = (await alicesSession.call("list_my_recipes", { limit: 2, offset: 0 })).structuredContent as {
          recipes: unknown[];
          has_more: boolean;
        };
        assertEquals(page.recipes.length, 2);
        assertEquals(page.has_more, true);
        const search = (await alicesSession.call("list_my_recipes", { query: "race" })).structuredContent as {
          recipes: { id: string }[];
        };
        assertEquals(search.recipes.length, 1);
        const wildcard = (await alicesSession.call("list_my_recipes", { query: "%" })).structuredContent as {
          recipes: unknown[];
        };
        assertEquals(wildcard.recipes.length, 0, "a literal % matches nothing");
      });

      await t.step("update_recipe changes only the given fields and reads them back", async () => {
        const res = await alicesSession.call("update_recipe", {
          recipe_id: aliceRecipeId,
          servings: 8,
          instructions: ["1) Toast the cumin.", "Soften the onion.", "Simmer and blend."],
          user_confirmed: true,
        });
        assert(!res.isError, text(res));
        const recipe = (res.structuredContent as { recipe: Record<string, unknown> }).recipe;
        assertEquals(recipe.servings, 8);
        assertEquals(recipe.instructions, ["Toast the cumin.", "Soften the onion.", "Simmer and blend."]);
        assertEquals(recipe.title, `Test Lentil Soup A-${run}`);
        assertEquals(recipe.cook_temp, 180);
        assertEquals(recipe.is_public, false);
      });

      await t.step("update_recipe cannot change visibility", async () => {
        const res = await alicesSession.call("update_recipe", { recipe_id: aliceRecipeId, is_public: true, user_confirmed: true });
        assertEquals(res.isError, true);
        assertEquals(await h.sql(`SELECT is_public FROM public.recipes WHERE id = '${aliceRecipeId}'`), "f");
      });

      await t.step("current-protocol (2026) clients work too", async () => {
        const modern = await connect(h, aliceToken, "modern");
        const res = await modern.call("get_recipe", { recipe_id: aliceRecipeId });
        assert(!res.isError, text(res));
        assertEquals((res.structuredContent as { recipe: { id: string } }).recipe.id, aliceRecipeId);
        await modern.close();
      });

      await t.step("oversized requests are refused", async () => {
        const res = await fetch(h.functionUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${aliceToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(300 * 1024) } }),
        });
        await res.body?.cancel();
        assertEquals(res.status, 413);
      });

      await alicesSession.close();
      await bobsSession.close();
    } finally {
      await h.stop();
    }
  },
});
