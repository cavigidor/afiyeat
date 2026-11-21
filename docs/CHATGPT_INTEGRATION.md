# ChatGPT → Afiyeat recipe connection

ChatGPT can save finished recipes straight into an Afiyeat account. They show
up in **Foodie → Recipes → My Recipes**, private, in the normal recipe UI,
and can be edited or made public there like any other recipe.

**Status:** built and tested locally (see [Tests](#tests)). **Not live yet.**
It is not complete until a recipe saved from a real ChatGPT conversation has
been seen in My Recipes ([live verification](#live-verification-test-plan)).

---

## How it works

```
ChatGPT ──MCP over HTTPS──▶ afiyeat-mcp edge function ──user's token──▶ PostgREST ──RLS──▶ public.recipes
   │                               │
   │ 401 + WWW-Authenticate        │ GET …/afiyeat-mcp/oauth-protected-resource
   ▼                               ▼
Supabase Auth OAuth 2.1 server ──▶ afiyeat.com/oauth/consent  (sign in, Allow / Deny)
```

| Piece | Where |
|---|---|
| MCP server (remote, Streamable HTTP, stateless) | `supabase/functions/afiyeat-mcp/` |
| Consent screen | `src/pages/OAuthConsent.tsx`, route `/oauth/consent` |
| Duplicate protection | `supabase/migrations/20261108120000_recipe_import_keys.sql` |
| Tests | `supabase/tests/afiyeat-mcp/` |

- **Sign-in** uses Supabase Auth's OAuth 2.1 server, so ChatGPT signs in
  with the user's existing Afiyeat account. No new accounts, no passwords
  shared with ChatGPT.
- **Every request** must carry a valid access token from this project, minted
  for an OAuth client (`client_id` claim), for a real signed-in user. The user
  id comes only from the verified token, never from tool input.
- **Database access** uses that same token with the public (anon/publishable)
  key, so the existing RLS policies apply. The function never reads the
  service-role or any secret key. Queries also filter by the caller's id,
  because RLS alone would let any user read other people's *public* recipes.
- **Private by default:** every recipe the connector creates is written with
  `is_public = false`. The connector cannot change visibility; the user does
  that in the app, where the content filter runs on publish.
- **No duplicates:** each save carries a fingerprint of the recipe's content,
  unique per user. A retry, a repeated tool call or a concurrent duplicate
  returns the recipe already saved (`status: "already_saved"`) instead of
  creating another. Whitespace, title case and step numbers don't count as
  differences.
- **Readback:** after writing, the function re-reads the row in a separate
  query and checks every field before reporting success, then returns the
  saved recipe ID.

### Tools

| Tool | Does | Notes |
|---|---|---|
| `create_recipe` | Saves one finished recipe, privately | Requires `user_confirmed: true`. Title, ingredients (list) and steps (list) required; description, servings, prep/cook minutes, temperature + unit, difficulty, tags optional. Unknown fields are rejected (so `user_id`, `is_public` can't be passed). |
| `list_my_recipes` | The user's own recipes, newest first | Title search, paging, "only from ChatGPT" filter. |
| `get_recipe` | One of the user's own recipes in full | Other users' recipes (even public ones) are "not found". |
| `update_recipe` | Changes fields of the user's own recipe | Only the fields passed; can't change visibility. |

There is no delete tool.

**Only finalized recipes are saved.** The server instructions and tool
descriptions tell ChatGPT to save only when the user explicitly asks to save
a specific finished recipe, never brainstorming, drafts, options the user
hasn't picked, or older recipes from the conversation unless named and asked
for. `user_confirmed: true` is required on every write, and ChatGPT
additionally asks the user to confirm each write call before it runs.

Fields map one to one onto the existing columns, in the shapes
`AddRecipeDialog` writes: ingredients and steps are lists of strings
(`"2 cups (250 g) flour, sifted"`), tags a text array. No new recipe fields
were added. Images are not supported from ChatGPT.

---

## One-time setup (needs approval; nothing here has been done)

These change the live backend, so they wait for the PR to be approved.

### 1. Apply the migration

Paste `supabase/migrations/20261108120000_recipe_import_keys.sql` into
Lovable exactly as written. It only adds two nullable columns (`source`,
`import_key`) and a per-user unique constraint. Existing rows keep `NULL`,
which never collides, so recipes made in the app behave exactly as before.
It does not change RLS or modify any data.

### 2. Deploy the edge function

Deploy `afiyeat-mcp` through Lovable. `supabase/config.toml` sets
`verify_jwt = false` for it (OAuth discovery requests carry no token; the
function verifies every other request itself). It needs no new secrets.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `MCP_ALLOWED_CLIENT_IDS` | empty (any OAuth client) | Comma-separated OAuth client ids allowed to call. Set it to ChatGPT's client id after connecting (step 5). |
| `MCP_REQUIRE_OAUTH_CLIENT` | `true` | Reject ordinary app session tokens; only OAuth-issued tokens. |
| `MCP_RESOURCE_URL` | derived | Override the advertised resource URL if the function is ever behind a custom domain. |

After deploying, this should return JSON (no sign-in needed):

```
https://dmlkjpjubneqhbqoxlct.supabase.co/functions/v1/afiyeat-mcp/oauth-protected-resource
```

```json
{
  "resource": "https://dmlkjpjubneqhbqoxlct.supabase.co/functions/v1/afiyeat-mcp",
  "authorization_servers": ["https://dmlkjpjubneqhbqoxlct.supabase.co/auth/v1"],
  "bearer_methods_supported": ["header"]
}
```

### 3. Turn on Supabase Auth's OAuth 2.1 server

In Supabase this is **Authentication → OAuth Server**:

| Setting | Value |
|---|---|
| OAuth 2.1 server | **Enabled** |
| Authorization path | `/oauth/consent` |
| Dynamic client registration | **Enabled** (ChatGPT registers itself) |
| Site URL (Authentication → URL Configuration) | must be `https://afiyeat.com` (check; it is likely already set, and it also drives auth email links) |

Recommended: switch the project's JWT signing key to an **asymmetric key
(ES256)** under JWT signing keys. The function works with either, but
Supabase cannot issue OpenID ID tokens with the legacy HS256 key, so if
ChatGPT requests the `openid` scope the token exchange fails on HS256.

Then check that this returns JSON listing `authorization_endpoint`,
`token_endpoint`, `registration_endpoint` and `S256`:

```
https://dmlkjpjubneqhbqoxlct.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

> **Lovable Cloud blocker.** The backend is Supabase via Lovable Cloud, with
> no direct Supabase dashboard. Lovable's docs say auth settings are
> "configured through Lovable" and don't mention the OAuth server or signing
> keys. Ask in the Lovable project chat (or Lovable support) to enable the
> OAuth 2.1 server with the settings above. If Lovable can't, the options are
> moving to a Supabase project you control (Lovable has no automatic
> migration) or a self-built OAuth server, which I don't recommend.

### 4. Publish the consent page

The `/oauth/consent` route ships with the website. It must be live on
afiyeat.com before connecting (Lovable publishes from `main`, so this
happens when the PR is merged and published).

---

## Connect ChatGPT

Developer mode works on ChatGPT Plus, Pro, Business, Enterprise and Edu, on
the **web** only. In Business/Enterprise/Edu an admin may need to allow it.

1. Go to **chatgpt.com → Settings → Apps → Advanced settings** and turn on
   **Developer mode**.
2. Back in **Settings → Apps**, click **Create app**.
3. Fill in:
   - **Name:** `Afiyeat`
   - **Description:** `Save finished recipes to my Afiyeat account.`
   - **MCP server URL:** `https://dmlkjpjubneqhbqoxlct.supabase.co/functions/v1/afiyeat-mcp`
   - **Authentication:** **OAuth**. Leave client ID/secret empty so ChatGPT
     registers itself.
   - Tick the box confirming you trust the server.
4. Click **Create**. ChatGPT opens the Afiyeat sign-in:
   - sign in with your existing Afiyeat account if asked;
   - on **"Allow ChatGPT to access your Afiyeat recipes?"** check it says
     you're signed in as your account, then click **Allow**;
   - you're sent back to ChatGPT, which lists the four tools.
5. **Lock it to ChatGPT (recommended).** In Supabase **Authentication → OAuth
   Apps**, find the client ChatGPT just registered and copy its client id.
   Set the function's `MCP_ALLOWED_CLIENT_IDS` to it. You can then turn
   dynamic client registration off; ChatGPT keeps using the client it
   registered. (If you later delete and re-add the app in ChatGPT, turn it
   on again for the reconnect and update the allowed id.)

**One-time account authorization:** step 4 is the only authorization needed.
ChatGPT keeps a refresh token and won't ask again unless the connection is
removed or the grant is revoked.

**Using it:** in a new chat, click **+ → More → Afiyeat** (or mention
Afiyeat), finish a recipe together, then say *"Save this recipe to
Afiyeat."* ChatGPT shows the `create_recipe` call for you to confirm.

**Alternative without dynamic registration:** create an OAuth client by hand
in **Authentication → OAuth Apps** (public client, redirect URI exactly as
shown on the app's page in ChatGPT, usually
`https://chatgpt.com/connector_platform_oauth_redirect`), then enter its
client ID in ChatGPT's OAuth settings when creating the app.

**Disconnecting:** delete the app in ChatGPT's settings. To also revoke the
grant server-side, delete or disable the client in Supabase **OAuth Apps**.

---

## Live verification test plan

Do this once the setup above is live. Use a throwaway recipe; delete it in
the app afterwards. Record each result.

| # | Do | Expect |
|---|---|---|
| 1 | Open the `oauth-protected-resource` URL above | The JSON shown in step 2 |
| 2 | Connect ChatGPT (steps 1–4) | Consent screen on afiyeat.com names your account; after **Allow**, ChatGPT shows `create_recipe`, `list_my_recipes`, `get_recipe`, `update_recipe` |
| 3 | In a new chat: *"Brainstorm three quick lentil soup ideas."* | Ideas only. **No** tool call |
| 4 | *"Let's go with the second one. Write the full recipe, 4 servings."* | A full recipe. **No** tool call |
| 5 | *"Save this recipe to Afiyeat."* | ChatGPT asks to confirm a `create_recipe` call; inputs show title, ingredients, steps, servings, times. Confirm. Reply gives the title, a recipe ID and says it's in My Recipes |
| 6 | Afiyeat (web or iPhone) → Foodie → Recipes → **My Recipes** | The recipe is at the top. Open it: title, description, servings, prep/cook times, temperature, ingredients and steps all match the chat |
| 7 | Same recipe, check visibility | **Make Public** is off. It is **not** in **Discover** |
| 8 | Back in ChatGPT: *"Save it again."* | Reply says it was already saved, same recipe ID. My Recipes still shows **one** copy |
| 9 | *"List my Afiyeat recipes."* | Includes the saved recipe (and your other recipes) |
| 10 | *"Change it to 6 servings in Afiyeat."* | `update_recipe` with only `servings`; the app shows 6 servings, nothing else changed |
| 11 | Sign in to Afiyeat with a **second** account: My Recipes and Discover | The recipe appears in neither |
| 12 | In Afiyeat, edit the recipe and make it public, then private again | Works as for any recipe (content filter runs on publish) |
| 13 | Delete the test recipe in the app | Gone from My Recipes; *"list my Afiyeat recipes"* no longer shows it |

Pass = all 13 as expected. Only then mark the integration complete.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| ChatGPT: "couldn't connect" before any sign-in | Function not deployed, or `verify_jwt` is on (discovery gets the gateway's 401 without the challenge) |
| Error about registration / `invalid_client` | Dynamic client registration is off, or the client was deleted |
| Redirected to afiyeat.com but a 404 | `/oauth/consent` not published yet |
| Consent page: "request has expired" | Authorization codes last 10 minutes; start again from ChatGPT |
| Token exchange fails right after **Allow** | Project still on HS256 and ChatGPT asked for `openid`; switch to an ES256 signing key |
| Tool calls return 401 `invalid_token` | Token expired and refresh failed, or `MCP_ALLOWED_CLIENT_IDS` doesn't include ChatGPT's client id |

Function logs (Lovable → Logs) record `tool_ok` / `tool_error` per call with
the first 8 characters of the user id. No recipe content or tokens are
logged.

---

## Security notes

- **Token scope.** Supabase OAuth access tokens are ordinary user tokens at
  the database level. The connector only exposes the four recipe tools, but
  a client holding the token could in principle call the REST API directly
  with the user's normal permissions. That's acceptable for ChatGPT, which
  only calls the tools. Hardening later: restrictive RLS on other tables that
  rejects tokens carrying `client_id`, or a custom access token hook.
- **Client names are self-declared** under dynamic registration, so the
  consent screen tells people to allow only a connection they just started.
  Step 5 (allow-list, then registration off) closes this.
- **Audience.** Supabase sets `aud` to `authenticated`, so tokens can't be
  bound to this one endpoint. The function instead pins the issuer to this
  project and requires an OAuth `client_id`.
- **Privacy policy.** Recipes saved from ChatGPT come from a conversation
  with OpenAI. If this is offered to other users, mention it in the privacy
  policy.

## Rolling back

Delete the app in ChatGPT, then undeploy `afiyeat-mcp`. The migration can
stay (two unused nullable columns). To remove it as well:

```sql
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_user_import_key_key;
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_import_key_check;
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_source_check;
ALTER TABLE public.recipes DROP COLUMN IF EXISTS import_key;
ALTER TABLE public.recipes DROP COLUMN IF EXISTS source;
```

## Tests

`supabase/tests/afiyeat-mcp/` (see its README). Locally against a database
built from every migration in the repo, with synthetic users and recipes:

- **Unit (8):** validation, normalisation, fingerprints, update patches.
- **End-to-end (38 steps):** OAuth discovery and challenges; rejection of
  missing, malformed, forged, expired, wrong-issuer, non-OAuth, anonymous,
  anon-role and service-role tokens; legacy HS256 support; tool listing and
  security schemes; private save with exact readback from Postgres and via
  the app's own query; duplicate saves (sequential, cosmetic variants, six
  concurrent) give one row; invalid input writes nothing; another user can't
  list, read, update or see (even via raw REST) someone else's recipes;
  search, paging and wildcard escaping; partial updates; visibility can't be
  changed; both MCP protocol generations; request size cap.
