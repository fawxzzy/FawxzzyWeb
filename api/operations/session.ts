import { operationsHandler } from '../../src/server/operations/consumer-http.mjs';

export const POST = (request: Request) => operationsHandler(request, 'session');
export const DELETE = (request: Request) => operationsHandler(request, 'session');
