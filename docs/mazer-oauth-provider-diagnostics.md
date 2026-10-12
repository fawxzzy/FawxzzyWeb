# Mazer OAuth provider diagnostics

The pending-authorization gateway returns an empty `502` when its provider
dependency fails. The browser retains its generic unavailable message. Do not
diagnose this as an expired request: a missing or expired local carrier returns
`404`, and a missing bearer or mismatched auth generation returns `401`.

Server warnings use the fixed event `mazer_oauth_provider_failure`. Each warning
contains an operation (`read`, `approve`, or `deny`) and a fixed failure stage:

| Stage | Boundary |
| --- | --- |
| `configuration` | Required server configuration is missing or outside the exact master binding. |
| `transport` | The one upstream fetch failed, including a timeout. |
| `upstream_status` | Upstream returned a non-success HTTP status; `upstreamStatus` is its numeric status. |
| `response_read` | Reading a successful response failed. |
| `response_size` | The existing maximum response size was exceeded. |
| `response_json` | A successful response was not valid JSON. |
| `response_contract` | Parsed data did not match the expected authorization or consent contract. |
| `redirect_contract` | The provider redirect failed the existing exact destination/query checks. |
| `unexpected` | An unclassified exception reached the existing failure boundary. |

For a rejected authorization read, `response_contract` also includes one fixed
`contractIssue`: `response_object`, `authorization_id`, `redirect_uri`, `scope`,
`client_object`, `client_id`, `client_name`, `user_object`, `user_id`, or
`unclassified`. This identifies the first missing, mistyped, or mismatched
boundary using constant labels. It contains no observed values, arbitrary keys,
identity comparisons, or provider-supplied diagnostic text. Validation and the
empty failure response remain unchanged; a label never authorizes accepting a
different provider shape. Consent diagnostics remain unchanged.

Logs contain no raw exception text, provider response, URL, authorization handle,
user identity, cookie, token, or key. Public responses contain no diagnostic stage
or upstream status. Logging failure cannot change the response or cause a retry.
Failed consent still clears the local carrier because the provider may already
have consumed the decision. Diagnostic warnings never authorize replay.

Before a live reproduction, check the exact master project's health and any
operator-owned resize or restart. A working static application does not prove
Auth health. Once healthy, one fresh app-originated request can establish the
remaining failure stage. Query only the exact deployment, route and observation
window. Do not recover user credentials or pending handles to replay requests.

Use the supported function-log interface for application warnings. The installed
CLI's historical log path projects request summaries and selects only the first
application entry per request; an empty result there does not prove that the
function emitted no warning. Accept either documented text or structured tool
responses, and retain only the fixed fields above.

Synthetic tests replace fetch completely and assert the warning allowlist,
failure stages, absence of private values, unchanged responses, and no retries.
This source change alone neither fixes nor proves live authenticated handoff.
