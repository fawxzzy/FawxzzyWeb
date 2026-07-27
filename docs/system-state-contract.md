# System-state contract

FawxzzyWeb uses one explicit state language for route recovery, account handoffs,
service availability, compatibility surfaces, and future operational dashboards.
The shared primitive is `src/components/system/system-state.tsx`.

## Variants

| Variant | Meaning | Announcement |
| --- | --- | --- |
| `loading` | Client work has not started or is preparing | polite, busy |
| `pending` | One admitted operation is in progress | polite, busy |
| `success` | The operation completed with observed evidence | polite |
| `empty` | The requested resource or collection has no current result | polite |
| `unavailable` | A required capability is intentionally not connected | polite |
| `unauthorized` | The current browser or session cannot continue | assertive |
| `invalid` | The supplied action or address is structurally invalid | assertive |
| `expired` | A one-time action produced no usable session | assertive |
| `recoverable-error` | A bounded retry or fresh action may recover | assertive |
| `terminal-error` | The current surface cannot recover in place | assertive |

The interface never upgrades an unknown or unavailable state to success. Provider
messages, raw error text, tokens, and internal configuration remain outside the
primary copy. A sanitized reference or operational explanation may appear only
inside the optional technical-details disclosure.

## Composition rules

- Present one state, one concise explanation, and at most one primary recovery
  action.
- Use `compact` states inside an existing panel and the framed state as the
  standalone system surface. Do not nest two visibly bordered panels.
- Loading and pending states use `aria-busy`; action failures use assertive
  announcements; all other states use polite status announcements.
- Buttons and links remain at least 44 CSS pixels high with visible keyboard
  focus.
- State meaning cannot depend on motion. Reduced-motion users receive the same
  information and recovery actions.

## Route ownership

- `not-found.tsx` uses `empty` and offers Apps plus Home recovery.
- `error.tsx` uses `recoverable-error` and retries the current boundary.
- `global-error.tsx` uses `terminal-error`, owns its complete HTML document, and
  never displays an exception message.
- Auth confirmation, callback, recovery, setup, and session notices use the same
  primitive with action-specific variants.
- Account service readback uses `unavailable` or `terminal-error` before showing
  service records; partial or malformed readback never implies active services.
- `/trove` is a lightweight `unavailable` compatibility surface with canonical
  metadata pointing to `/apps`; it does not render the catalog or load trailers.

## Static-export decision

FawxzzyWeb uses Next.js `output: "export"`. Next.js documents route-segment
`loading.tsx` streaming as unsupported for static export, so this repository does
not add a root `loading.tsx`. Client-owned account and handoff operations render
the shared `loading` or `pending` variants directly. This preserves deterministic
static output while keeping browser work visible.

## Verification contract

- The variant denominator and ARIA semantics are deterministic tests.
- Invalid, expired, unauthorized, unavailable, pending, success, and recoverable
  Auth states are exercised with local test adapters only.
- The built static 404 is checked at 320 and 390 pixels and receives an automated
  WCAG A/AA scan.
- `/trove` must contain no product showcase or video element.
- Route and global error files must use the shared recovery variants and must not
  render `error.message`.
- Full repository verification remains `npm run verify` across Chromium and
  iPhone-class WebKit.

## Reusable captures

**Rule — Unknown never becomes partial success.** A malformed or incomplete
operational readback fails closed at the complete state boundary.

**Pattern — One state, one recovery path.** System surfaces expose the current
condition and the safest next action before optional technical detail.

**Failure Mode — Streaming conventions in a static export.** Adding
`loading.tsx` would imply a server-streaming capability the deployed architecture
does not have. Use explicit client state instead.

**Decision — Trove remains provenance, not a second catalog.** Keep the route,
canonical/no-index contract, and rollback identity while rendering only the
compatibility handoff.
