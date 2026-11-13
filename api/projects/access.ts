import { ownerAccessHandler } from '../../src/server/projects/owner-projects-http.mjs';

export const GET = (request: Request) => ownerAccessHandler(request);
