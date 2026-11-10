import { HookPayloadError, planMessages } from "./plan.mjs";
import { isSafeFromAddress, sendViaResend, SendError } from "./resend.mjs";
import { verifyWebhook, WebhookVerificationError } from "./standard-webhooks.mjs";

/**
 * Supabase Auth "Send Email" hook handler.
 *
 * Contract: 200 `{}` on success; any failure is
 * `{ "error": { "http_code": <status>, "message": <string> } }` with the same
 * HTTP status. Messages are generic and never contain secrets, tokens or the
 * provider response body; specifics go to console.error (names only).
 */

const MAX_BODY_BYTES = 64 * 1024;
const JSON_HEADERS = { "Content-Type": "application/json" };

function failure(status, message) {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: JSON_HEADERS,
  });
}

function configError(env) {
  const missing = ["SEND_EMAIL_HOOK_SECRET", "RESEND_API_KEY", "AUTH_EMAIL_FROM", "SUPABASE_URL"].filter(
    (name) => !env[name],
  );
  if (missing.length > 0) return `missing ${missing.join(", ")}`;
  if (!isSafeFromAddress(env.AUTH_EMAIL_FROM)) return "AUTH_EMAIL_FROM is not a single-line address";
  try {
    if (new URL(env.SUPABASE_URL).protocol !== "https:") return "SUPABASE_URL is not https";
  } catch {
    return "SUPABASE_URL is not a URL";
  }
  return null;
}

/**
 * @param {Request} request
 * @param {{ env: Record<string,string|undefined>, fetchImpl: typeof fetch, nowSeconds?: number }} deps
 */
export async function handleAuthEmailRequest(request, { env, fetchImpl, nowSeconds }) {
  if (request.method !== "POST") return failure(405, "Method not allowed");

  const problem = configError(env);
  if (problem) {
    console.error(`auth-send-email: configuration problem: ${problem}`);
    return failure(500, "Email hook is not configured");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return failure(413, "Payload too large");

  try {
    await verifyWebhook({
      secret: env.SEND_EMAIL_HOOK_SECRET,
      headers: request.headers,
      body,
      nowSeconds,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error(`auth-send-email: webhook rejected: ${error.reason}`);
      // A malformed configured secret is our fault, not the caller's.
      if (error.reason === "secret_malformed" || error.reason === "secret_missing") {
        return failure(500, "Email hook is not configured");
      }
      return failure(401, "Invalid webhook signature");
    }
    throw error;
  }

  let messages;
  try {
    messages = planMessages(JSON.parse(body), { supabaseUrl: env.SUPABASE_URL });
  } catch (error) {
    if (error instanceof HookPayloadError || error instanceof SyntaxError) {
      console.error(`auth-send-email: payload rejected: ${error.message}`);
      return failure(400, "Invalid hook payload");
    }
    throw error;
  }

  const webhookId = request.headers.get("webhook-id");
  try {
    for (const [index, message] of messages.entries()) {
      await sendViaResend({
        fetchImpl,
        apiKey: env.RESEND_API_KEY,
        from: env.AUTH_EMAIL_FROM,
        message,
        idempotencyKey: `${webhookId}/${index}`,
      });
    }
  } catch (error) {
    if (error instanceof SendError) {
      console.error(`auth-send-email: send failed: ${error.message}`);
      return failure(error.status, "Could not send email");
    }
    throw error;
  }

  return new Response("{}", { status: 200, headers: JSON_HEADERS });
}
