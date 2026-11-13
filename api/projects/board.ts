import board from '../../src/server/projects/owner-board.generated.mjs';
import { createOwnerProjectsHandler, ownerEnvironmentDependencies } from '../../src/server/projects/owner-projects-http.mjs';

// The snapshot is imported eagerly on purpose: if the bundle cannot include it, this function
// fails at load and the release gate's signed-out probe notices, rather than the owner later.
const handler = createOwnerProjectsHandler('board', ownerEnvironmentDependencies(async () => board));

export const GET = (request: Request) => handler(request);
