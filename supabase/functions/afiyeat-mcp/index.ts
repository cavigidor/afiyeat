// afiyeat-mcp: a private, remote MCP server that lets an assistant the user
// has connected (ChatGPT) save finished recipes into their own Afiyeat
// account. See docs/CHATGPT_INTEGRATION.md.
//
// Request flow:
//   1. withOAuthProtectedResource answers OAuth discovery
//      (GET .../afiyeat-mcp/oauth-protected-resource) and adds the
//      `WWW-Authenticate: Bearer resource_metadata=...` challenge to 401s,
//      which is how ChatGPT finds this project's Supabase Auth and starts
//      the OAuth 2.1 sign-in.
//   2. authenticate() verifies the access token and builds a database client
//      that acts as that user (RLS applies). Every MCP request needs it,
//      including initialize and tools/list.
//   3. The MCP handler serves the request statelessly (Streamable HTTP, JSON
//      responses) with a server built for that user.
//
// verify_jwt is false for this function in supabase/config.toml because the
// discovery request carries no token; step 2 does the verification instead.

import { createMcpHandler, fromSupabaseUrl, withOAuthProtectedResource } from "./deps.ts";
import { authenticate, loadAuthConfig } from "./auth.ts";
import { buildServer } from "./server.ts";

const MAX_BODY_BYTES = 256 * 1024;

const config = loadAuthConfig();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Expose-Headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonError(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

/** Quoted-string safe value for a WWW-Authenticate parameter. */
const quote = (s: string) => s.replace(/["\\]/g, "");

async function handle(req: Request, metadataUrl: string | undefined): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return jsonError(413, { error: "Request too large." });
  }

  const auth = await authenticate(req, config);
  if (!auth.ok) {
    // A missing token gets the bare challenge (the middleware adds it); a bad
    // one says why, so the client knows to refresh or sign in again.
    const extra: Record<string, string> = {};
    if (auth.reason === "invalid_token" && metadataUrl) {
      extra["WWW-Authenticate"] =
        `Bearer error="invalid_token", error_description="${quote(auth.description)}", ` +
        `resource_metadata="${metadataUrl}"`;
    }
    return jsonError(401, { error: auth.reason, error_description: auth.description }, extra);
  }

  // Buffer the body once, under the size cap, and hand the MCP handler a
  // fresh request carrying it (a chunked request has no Content-Length).
  let mcpRequest = req;
  if (req.body) {
    const body = await readCapped(req.body, MAX_BODY_BYTES);
    if (!body) return jsonError(413, { error: "Request too large." });
    mcpRequest = new Request(req.url, { method: req.method, headers: req.headers, body });
  }

  const store = { client: auth.client, userId: auth.userId };
  const handler = createMcpHandler(() => buildServer(store), {
    responseMode: "json",
    onerror: (error) => console.error(JSON.stringify({ event: "mcp_error", message: error.message })),
  });
  return await handler.fetch(mcpRequest);
}

/** The whole body, or null once it exceeds `max` bytes (reading stops there). */
async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.byteLength;
  }
  return body;
}

const resourceUrl = Deno.env.get("MCP_RESOURCE_URL")?.trim() || undefined;

const app = withOAuthProtectedResource(
  {
    // On Supabase Edge Functions both are derived from the request when
    // unset; the issuer is pinned to this project's Auth explicitly.
    resourceServer: resourceUrl,
    authorizationServer: fromSupabaseUrl(config.supabaseUrl),
  },
  (req: Request, ctx: { oauthProtectedResource?: { resourceMetadataUrl?: string } }) =>
    handle(req, ctx?.oauthProtectedResource?.resourceMetadataUrl),
);

Deno.serve(async (req) => {
  try {
    return withCors(await app(req));
  } catch (error) {
    console.error(JSON.stringify({ event: "unhandled", message: (error as Error)?.message }));
    return withCors(jsonError(500, { error: "Internal error." }));
  }
});
