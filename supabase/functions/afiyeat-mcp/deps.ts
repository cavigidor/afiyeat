// Every third-party import for afiyeat-mcp, pinned to exact versions in one
// place so a deploy is reproducible and an upgrade is a one-line change.
export { createClient } from "npm:@supabase/supabase-js@2.119.0";
export type { SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";
export {
  fromSupabaseUrl,
  withOAuthProtectedResource,
} from "npm:@supabase/server@1.9.2/oauth-protected-resource";
export { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.4.0";
export { z } from "npm:zod@4.6.7";
