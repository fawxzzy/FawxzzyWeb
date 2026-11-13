import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  PRESENCE_CHANNEL, countPresence, formatOnline, isPresenceOrigin, realtimeUrl,
} from '../src/lib/presence/presence-contract.mjs';

const require = createRequire(import.meta.url);

test('only the two production site origins run presence', () => {
  assert.equal(isPresenceOrigin('https://fawxzzy.com'), true);
  assert.equal(isPresenceOrigin('https://account.fawxzzy.com'), true);
  for (const origin of ['https://www.fawxzzy.com', 'http://fawxzzy.com', 'https://fawxzzy.com/', 'http://127.0.0.1:3210',
    'http://localhost:3000', 'https://fawxzzyweb-gm1apxx80-fawxzzy.vercel.app', 'https://fawxzzy.com.evil.example',
    'https://evilfawxzzy.com', '', undefined, null]) {
    assert.equal(isPresenceOrigin(origin), false, String(origin));
  }
});

test('the count is the number of distinct presence keys in the current snapshot', () => {
  assert.equal(countPresence({}), 0);
  assert.equal(countPresence({ a: [{ v: 1 }], b: [{ v: 1 }], c: [{ v: 1 }] }), 3);
  assert.equal(countPresence({ a: [{ v: 1 }, { v: 1 }] }), 1, 'one key with several metas is one tab');
  assert.equal(countPresence({ a: [], b: [{ v: 1 }] }), 1, 'a key with no metas does not count');
  for (const bad of [undefined, null, 'x', 5, [], [{ v: 1 }]]) assert.equal(countPresence(bad), 0, String(bad));
  assert.equal(countPresence({ a: 'not-an-array', b: { v: 1 } }), 0);
});

test('the header text is a number only for a real positive count', () => {
  assert.equal(formatOnline(1), '1');
  assert.equal(formatOnline(12), '12');
  assert.equal(formatOnline(999), '999');
  assert.equal(formatOnline(1000), '1k');
  assert.equal(formatOnline(1234), '1.2k');
  assert.equal(formatOnline(9999), '9.9k');
  assert.equal(formatOnline(12345), '12k');
  for (const bad of [0, -1, 1.5, Number.NaN, Infinity, null, undefined, '12', Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(formatOnline(bad), null, String(bad));
  }
});

test('the realtime url is derived only from an https supabase project origin', () => {
  assert.equal(realtimeUrl('https://bxtcuhkotumitoqtrcej.supabase.co'), 'wss://bxtcuhkotumitoqtrcej.supabase.co/realtime/v1');
  assert.equal(realtimeUrl('https://bxtcuhkotumitoqtrcej.supabase.co/'), 'wss://bxtcuhkotumitoqtrcej.supabase.co/realtime/v1');
  for (const bad of [undefined, '', 'not a url', 'http://bxtcuhkotumitoqtrcej.supabase.co', 'https://evil.example',
    'https://bxtcuhkotumitoqtrcej.supabase.co.evil.example', 'https://bxtcuhkotumitoqtrcej.supabase.co/rest/v1',
    'https://user:pw@bxtcuhkotumitoqtrcej.supabase.co', 'https://bxtcuhkotumitoqtrcej.supabase.co?x=1']) {
    assert.equal(realtimeUrl(bad), null, String(bad));
  }
  assert.equal(PRESENCE_CHANNEL, 'web-presence-v1');
});

// The header view, compiled from the real component source (same harness style as the board tests).
async function renderView(count) {
  const typescript = require('typescript');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const source = await readFile('src/components/site/presence-counter.tsx', 'utf8');
  const compiled = typescript.transpileModule(source, { compilerOptions: {
    esModuleInterop: true, jsx: typescript.JsxEmit.ReactJSX, module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020,
  } }).outputText;
  const component = { exports: {} };
  const componentRequire = (specifier) => {
    if (specifier === 'react') return React;
    if (specifier === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (specifier === '@/lib/presence/presence-contract.mjs') return { formatOnline, isPresenceOrigin };
    throw new Error(`Unexpected import: ${specifier}`);
  };
  new Function('require', 'module', 'exports', compiled)(componentRequire, component, component.exports);
  return renderToStaticMarkup(React.createElement(component.exports.PresenceView, { count }));
}

test('the header view is a dim dot until a real count exists, and never shows zero or an unknown number', async () => {
  for (const count of [null, undefined, 0, -3, 2.5, Number.NaN]) {
    const html = await renderView(count);
    assert.match(html, /data-state="idle"/u, String(count));
    assert.doesNotMatch(html, /\d/u, `no digits for ${String(count)}`);
    assert.doesNotMatch(html, /online/u, `no label for ${String(count)}`);
  }
  const live = await renderView(12);
  assert.match(live, /data-state="live"/u);
  assert.match(live, />12</u);
  assert.match(live, /site-nav__presence-word"> online</u);
  assert.match(await renderView(1234), />1\.2k</u);
});

test('the header view is decorative-dot plus text only: no link, no live region, nothing focusable', async () => {
  for (const count of [null, 7]) {
    const html = await renderView(count);
    assert.doesNotMatch(html, /<a[\s>]|role=|aria-live|tabindex|<button/u);
    assert.match(html, /aria-hidden="true" class="site-nav__presence-dot"/u);
  }
});
