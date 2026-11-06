// Source selection for the first (and only) private project card. The mapping
// is ACCEPTED so the server route may call the reader RPC, but the route stays
// fail-closed: it also needs OPERATIONS_READER_ENABLED, the verified owner
// subject, and a reader RPC whose response matches this exact mapping
// (stable id, board, board revision, source revision). If the RPC is not
// installed or returns anything else, the browser shows nothing.
//
// boardRevision is the reviewed R129 digest of the Fawxzzy Web board mapping;
// it must equal the constant inside the installed reader SQL (R112).
export const selectedPrivateCard = Object.freeze({
  status: 'ACCEPTED',
  sourceId: 'FW-ANALYTICS-001',
  proposedStableId: 'FF-WEB-ANALYTICS-001',
  board: 'fawxzzyweb',
  sourceRevision: '4495db9c42dcba75adf8ddeaf87ababd6485417f',
  boardRevision: 'sha256:39f3fd99ab531bd576dce3618e033d33762ba0d738bd23274eac97e9d2a921ad',
});
