import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { authThemeBase } from "../supabase/functions/_shared/auth-theme.mjs";
import { planMessages } from "../supabase/functions/auth-send-email/plan.mjs";

/**
 * Writes every rendered auth email variant for each app skin (default/fitness/mazer)
 * as static HTML + text for local inspection, plus an index.html linking them all.
 * Output stays OUTSIDE the repo (default C:/ATLAS/tmp/wt/email-preview, override
 * with the first argument) and is never committed. Uses dummy tokens and dummy
 * recipients; no network.
 *
 * `--local-assets` points the app icon at this checkout's public/ folder instead
 * of the account host, so new or changed icons can be checked before a deploy.
 */
const args = process.argv.slice(2);
const localAssets = args.includes("--local-assets");
const outputDirectory = resolve(args.find((arg) => !arg.startsWith("--")) ?? "C:/ATLAS/tmp/wt/email-preview");
const supabaseUrl = "https://dummyref.supabase.co";
const origin = "https://account.fawxzzy.com";
const publicFolder = pathToFileURL(resolve(import.meta.dirname, "../public")).href;
const apps = [
  { name: "default", query: "" },
  { name: "fitness", query: "&app=fitness" },
  { name: "mazer", query: "&app=mazer" },
];

/** [file name, email_action_type, extra email_data, extra user fields] */
const VARIANTS = [
  ["signup", "signup", {}, {}],
  ["recovery", "recovery", {}, {}],
  ["email-change-new", "email_change", { token_hash: "PREVIEW_TOKEN_HASH", token_hash_new: "" }, { new_email: "new.address@example.test" }],
  ["email-change-secure", "email_change", { token_hash: "PREVIEW_NEW", token_hash_new: "PREVIEW_CURRENT" }, { new_email: "new.address@example.test" }],
  ["email-changed-notice", "email_changed_notification", { old_email: "preview@example.test" }, { email: "new.address@example.test" }],
  ["password-changed-notice", "password_changed_notification", {}, {}],
  ["reauthentication", "reauthentication", {}, {}],
];

function redirectFor(type, app) {
  if (type === "recovery") return `${origin}/reset-password?recovery=1${app.query}`;
  const params = app.query ? `?${app.query.slice(1)}&returnTo=${encodeURIComponent(`https://${app.name}.fawxzzy.com/`)}&state=preview-state` : "";
  return `${origin}/auth/confirm${params}`;
}

await mkdir(outputDirectory, { recursive: true });
const written = [];
for (const app of apps) {
  for (const [name, type, data, user] of VARIANTS) {
    const messages = planMessages(
      {
        user: { email: "preview@example.test", ...user },
        email_data: {
          token: "123456",
          token_hash: "PREVIEW_TOKEN_HASH",
          token_new: "",
          token_hash_new: "",
          redirect_to: redirectFor(type, app),
          email_action_type: type,
          site_url: origin,
          ...data,
        },
      },
      { supabaseUrl },
    );
    for (const [index, message] of messages.entries()) {
      const suffix = messages.length > 1 ? `-${index === 0 ? "to-current" : "to-new"}` : "";
      const base = resolve(outputDirectory, `${app.name}-${name}${suffix}`);
      const html = localAssets ? message.html.replaceAll(`${authThemeBase.emailAssetOrigin}/`, `${publicFolder}/`) : message.html;
      await writeFile(`${base}.html`, html, "utf8");
      await writeFile(`${base}.txt`, `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`, "utf8");
      written.push({ file: `${base}.html`, subject: message.subject, to: message.to });
    }
  }
}
const index = written
  .map(({ file, subject, to }) => `<li><a href="${pathToFileURL(file).href}">${file.split(/[\\/]/).pop()}</a> - ${subject} (to ${to})</li>`)
  .join("\n");
await writeFile(resolve(outputDirectory, "index.html"), `<!doctype html><meta charset="utf-8"><title>Auth email previews</title><ul>\n${index}\n</ul>\n`, "utf8");
console.log(`Wrote ${written.length} previews to ${outputDirectory}${localAssets ? " (icons from local public/)" : ""}`);
for (const { file } of written) console.log(file);
