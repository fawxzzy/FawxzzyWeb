import { readFileSync } from 'node:fs';

// The owner's full project board is committed as a plain ES module
// (`export default <snapshot>;`) so the board function can import it eagerly:
// a bundling problem then crashes the function at load, which the release gate's
// unauthenticated probe sees, instead of failing quietly for the owner later.
// Node-only helpers for the builder, the release gate and tests; never import
// this or the generated module from client or static-page code.
const PREFIX = 'export default ';
const SUFFIX = ';\n';

export const OWNER_BOARD_MODULE = new URL('./owner-board.generated.mjs', import.meta.url);

export const renderOwnerBoardModule = (snapshot) => `${PREFIX}${JSON.stringify(snapshot, null, 2)}${SUFFIX}`;

export function parseOwnerBoardModule(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n');
  if (!normalized.startsWith(PREFIX) || !normalized.endsWith(SUFFIX)) throw new Error('owner board module has an unexpected shape');
  return JSON.parse(normalized.slice(PREFIX.length, -SUFFIX.length));
}

export const readOwnerBoardSnapshot = (url = OWNER_BOARD_MODULE) => parseOwnerBoardModule(readFileSync(url, 'utf8'));
