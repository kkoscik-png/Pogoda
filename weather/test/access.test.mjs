import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/index.mjs';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const issuer = 'https://test-team.cloudflareaccess.com';
const audience = 'test-weather-audience';
const handler = createHandler(() => createLocalJWKSet({ keys: [jwk] }));
let assetCalls = 0;
const env = { ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com', ACCESS_AUD: audience, ASSETS: { async fetch() { assetCalls++; return new Response('private weather app'); } } };
const request = (jwt, host = 'weather.seasync.co', path = '/') => new Request('https://' + host + path, { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} });
const token = overrides => new SignJWT({ sub: 'owner', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('10m').sign(privateKey);

test('configuration missing denies HTML and assets without reading the asset binding', async () => {
  const before = assetCalls;
  for (const path of ['/', '/app.js', '/assets/leaflet.js']) assert.equal((await handler(request(null, 'weather.seasync.co', path), { ...env, ACCESS_AUD: '' })).status, 503);
  assert.equal(assetCalls, before);
});
test('a missing or forged token never releases assets', async () => {
  const before = assetCalls;
  assert.equal((await handler(request(null), env)).status, 401);
  assert.equal((await handler(request('forged.jwt.token'), env)).status, 403);
  assert.equal(assetCalls, before);
});
test('valid signature, issuer and audience allow the configured hostname only', async () => {
  const jwt = await token();
  const response = await handler(request(jwt), env);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'private weather app');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await handler(request(jwt, 'other.workers.dev'), env)).status, 403);
});
test('expired and wrong-audience tokens are rejected', async () => {
  const expired = await new SignJWT({ sub: 'owner' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey);
  const wrong = await new SignJWT({ sub: 'owner' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience('another-app').setIssuedAt().setExpirationTime('10m').sign(privateKey);
  assert.equal((await handler(request(expired), env)).status, 403);
  assert.equal((await handler(request(wrong), env)).status, 403);
});

test('Stormglass API is protected by the same JWT gate as private assets', async () => {
  const before = assetCalls;
  assert.equal((await handler(request(null, 'weather.seasync.co', '/api/stormglass/status'), env)).status, 401);
  const response = await handler(request(await token(), 'weather.seasync.co', '/api/stormglass/status'), env);
  assert.equal(response.status, 200);assert.equal((await response.json()).configured, false);assert.equal(assetCalls, before);
});
