import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * supabase-js's functions.invoke() turns ANY non-2xx response from an edge
 * function into a FunctionsHttpError whose .message is always the generic
 * "Edge Function returned a non-2xx status code" - the actual reason our
 * edge functions put in the JSON body (e.g. "Invalid verification code.
 * 3 attempts remaining.") gets silently thrown away unless the caller
 * re-reads the response body via error.context (the raw fetch Response).
 *
 * Without this, every 4xx our edge functions return - wrong OTP, expired
 * code, account already exists, rate-limited, etc. - surfaces to the user
 * as the same unhelpful generic message, indistinguishable from a real
 * server failure.
 */
export async function getEdgeFunctionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // Body wasn't JSON, or has already been read once - fall through.
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
