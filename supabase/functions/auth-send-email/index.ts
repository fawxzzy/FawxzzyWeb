import { handleAuthEmailRequest } from "./handler.mjs";

// Supabase Auth "Send Email" hook. Authenticated by Standard Webhooks signature
// (verify_jwt = false in supabase/config.toml), not by a JWT.
Deno.serve((request: Request) =>
  handleAuthEmailRequest(request, {
    env: {
      SEND_EMAIL_HOOK_SECRET: Deno.env.get("SEND_EMAIL_HOOK_SECRET"),
      RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
      AUTH_EMAIL_FROM: Deno.env.get("AUTH_EMAIL_FROM"),
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    },
    fetchImpl: fetch,
  }),
);
