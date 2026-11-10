import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { planMessages } from "../supabase/functions/auth-send-email/plan.mjs";

/**
 * Writes rendered auth emails (default/fitness/mazer x recovery/signup) as
 * static HTML + text for local inspection. Output stays OUTSIDE the repo
 * (default C:/ATLAS/tmp/wt/email-preview, override with the first argument) and
 * is never committed. Uses dummy tokens and a dummy recipient; no network.
 */
const outputDirectory = resolve(process.argv[2] ?? "C:/ATLAS/tmp/wt/email-preview");
const supabaseUrl = "https://dummyref.supabase.co";
const origin = "https://account.fawxzzy.com";
const apps = [
  { name: "default", query: "" },
  { name: "fitness", query: "&app=fitness" },
  { name: "mazer", query: "&app=mazer" },
];

function redirectFor(type, app) {
  if (type === "recovery") return `${origin}/reset-password?recovery=1${app.query}`;
  const params = app.query ? `?${app.query.slice(1)}&returnTo=${encodeURIComponent(`https://${app.name}.fawxzzy.com/`)}&state=preview-state` : "";
  return `${origin}/auth/confirm${params}`;
}

await mkdir(outputDirectory, { recursive: true });
const written = [];
for (const app of apps) {
  for (const type of ["recovery", "signup"]) {
    const [message] = planMessages(
      {
        user: { email: "preview@example.test" },
        email_data: {
          token: "123456",
          token_hash: "PREVIEW_TOKEN_HASH",
          token_new: "",
          token_hash_new: "",
          redirect_to: redirectFor(type, app),
          email_action_type: type,
          site_url: origin,
        },
      },
      { supabaseUrl },
    );
    const base = resolve(outputDirectory, `${app.name}-${type}`);
    await writeFile(`${base}.html`, message.html, "utf8");
    await writeFile(`${base}.txt`, message.text, "utf8");
    written.push(`${base}.html`);
  }
}
console.log(`Wrote ${written.length} previews to ${outputDirectory}`);
for (const file of written) console.log(file);
