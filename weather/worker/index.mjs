import { createRemoteJWKSet, jwtVerify } from 'jose';

const remoteKeys = new Map();
function signingKeys(issuer) {
  if (!remoteKeys.has(issuer)) remoteKeys.set(issuer, createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs')));
  return remoteKeys.get(issuer);
}
const deny = (message, status) => new Response(message, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' },
});

export function createHandler(resolveKeys = signingKeys) {
  return async function fetch(request, env) {
    // All static assets pass this check first (assets.run_worker_first=true).
    // Missing Access configuration fails closed, including on alternate hostnames.
    const team = String(env.ACCESS_TEAM_DOMAIN || '').trim().toLowerCase();
    const audience = String(env.ACCESS_AUD || '').trim();
    if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || !audience || !env.ASSETS?.fetch) {
      return deny('Prywatna aplikacja — konfiguracja Cloudflare Access oczekuje na dokończenie.', 503);
    }
    if (new URL(request.url).hostname !== 'weather.seasync.co') return deny('Niedozwolony adres aplikacji.', 403);
    const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!assertion) return deny('Wymagane logowanie przez Cloudflare Access.', 401);
    try {
      await jwtVerify(assertion, resolveKeys('https://' + team), {
        issuer: 'https://' + team,
        audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'iss', 'aud', 'sub'],
      });
    } catch {
      return deny('Nieprawidłowa lub wygasła sesja Cloudflare Access.', 403);
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
  };
}

export default { fetch: createHandler() };
