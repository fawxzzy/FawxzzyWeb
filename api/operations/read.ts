import { operationsHandler } from '../../src/server/operations/consumer-http.mjs';

export const GET = (request: Request) => operationsHandler(request, 'read');
