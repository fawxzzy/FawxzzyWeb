// Source selection only. The Platform writer must first confirm canonical
// equivalence and install the exact one-card mapping and reader RPC. Keeping
// this disabled also prevents the existing Operations env flags from enabling
// a private-card read by accident.
export const selectedPrivateCard = Object.freeze({
  status: 'PENDING_CANONICAL_EQUIVALENCE',
  sourceId: 'FW-ANALYTICS-001',
  proposedStableId: 'FF-WEB-ANALYTICS-001',
  board: 'fawxzzyweb',
  sourceRevision: '4495db9c42dcba75adf8ddeaf87ababd6485417f',
  boardRevision: null,
});
