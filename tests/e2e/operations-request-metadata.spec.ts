import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createConsumerHandler } from '../../src/server/operations/consumer-http.mjs';
import { COOKIE, newHandle } from '../../src/server/operations/consumer-auth.mjs';

test('real browser same-origin GET metadata reaches the guarded reader without Origin', async ({ page }) => {
  const observed: Array<Record<string, string | null>> = [];
  let authCalls = 0; let readCalls = 0;
  const handle = newHandle();
  const view = { health: 'stale', authoritative: false, actions_enabled: false,
    projection_revision: null, source_watermark: [], cards: [] };
  const handler = createConsumerHandler({
    ownerSubject: '11111111-1111-4111-8111-111111111111',
    authenticate: async () => { authCalls++; return {
      subject: '11111111-1111-4111-8111-111111111111',
      session: '22222222-2222-4222-8222-222222222222',
    }; },
    store: { read: async () => { readCalls++; return view; } },
  });
  // Only URL, opaque cookie and Auth/store are fixture substitutions. Origin and
  // Fetch Metadata reach the production guard exactly as the browser sent them.
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><title>Operations request fixture</title><p>Local fixture</p>');
        return;
      }
      if (req.url !== '/read' || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      observed.push(Object.fromEntries(['origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']
        .map((key) => [key, headers.get(key)])));
      headers.set('cookie', `${COOKIE}=${handle}`);
      const result = await handler(new Request('https://account.fawxzzy.com/api/operations/read', { headers }), 'read');
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text());
    } catch { res.writeHead(500); res.end('Fixture failed'); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await page.goto(origin);
    for (const mode of ['cors', 'same-origin'] as const) {
      const result = await page.evaluate(async (fetchMode) => {
        const response = await fetch('/read', { mode: fetchMode, cache: 'no-store',
          headers: { 'X-Fawxzzy-Operations': '1', Authorization: 'Bearer local-fixture' } });
        return { status: response.status, body: await response.json() };
      }, mode);
      expect(observed.at(-1)).toEqual({ origin: null, 'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': mode, 'sec-fetch-dest': 'empty' });
      expect(result).toEqual({ status: 200, body: view });
    }
    expect(authCalls).toBe(2); expect(readCalls).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
