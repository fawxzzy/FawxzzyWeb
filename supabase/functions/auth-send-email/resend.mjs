/** Resend HTTP API sender. No SDK; fetch is injected so tests stay hermetic. */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export class SendError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SendError";
    this.status = status;
  }
}

/** A From value must be one line and contain an address; blocks header injection. */
export function isSafeFromAddress(value) {
  return typeof value === "string" && !/[\r\n]/.test(value) && /<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(value);
}

/**
 * Send one message. Throws SendError with a secret-free message. The Resend
 * response body is never echoed to callers (it can contain recipient data).
 */
export async function sendViaResend({ fetchImpl, apiKey, from, message, idempotencyKey }) {
  let response;
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    throw new SendError("Email provider unreachable", 502);
  }
  if (!response.ok) throw new SendError(`Email provider returned HTTP ${response.status}`, 502);
}
