import { exactOrder } from '../../lib/operations/ordering.mjs';
export { exactOrder } from '../../lib/operations/ordering.mjs';
function reject(code) { throw Object.assign(new Error(`OPS_${code}`), { code: `OPS_${code}` }); }

// This profile is narrower than the general immutable RFC3339 schemas.
// Leap seconds, unknown UTC offsets and >256 fraction digits cannot be ordered
// by this installed protocol. Reject them before accepting a trusted source;
// do not normalize them into a different instant or rewrite retained rows.
export function assertTimestampProfile(envelope) {
  const names = {
    'socials-os.development-card.v1.schema.json': ['created_at', 'updated_at'],
    'socials-os.development-board.v1.schema.json': ['generated_at'],
    'socials-os.development-board.v2.schema.json': ['generated_at'],
    'socials-os.development-event.v1.schema.json': ['occurred_at'],
    'socials-os.development-event.v2.schema.json': ['occurred_at'],
  }[envelope.schema_identity];
  if (!names) reject('TIMESTAMP_PROFILE');
  try { for (const name of names) exactOrder(envelope.payload[name]); }
  catch { reject('TIMESTAMP_PROFILE'); }
}
