import { privateCardHandler } from '../../src/server/projects/private-card-http.mjs';

export const GET = (request: Request) => privateCardHandler(request);
