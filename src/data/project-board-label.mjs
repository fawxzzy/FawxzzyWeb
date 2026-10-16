// The Web board is a product display label, independent of the source's
// historical Trove board ID and any stale name in an unapproved preview.
export function projectBoardLabel(board, publicName) {
  return board.id === "trove" ? `${publicName} Web` : board.name;
}
