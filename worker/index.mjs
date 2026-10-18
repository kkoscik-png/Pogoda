import { handleStormglass } from './stormglass.mjs';
import { handleForecast } from './forecast.mjs';

const deny = (message, status) => new Response(message, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
});

export function createHandler() {
  return async function fetch(request, env, ctx) {
    // The owner selected public access without a PIN or login.
    if (new URL(request.url).hostname !== 'weather.seasync.co') return deny('Niedozwolony adres aplikacji.', 403);
    if (!env.ASSETS?.fetch) return deny('Aplikacja oczekuje na dokończenie wdrożenia.', 503);
    const api = await handleStormglass(request, env, ctx);
    if (api) return api;
    const forecast = await handleForecast(request, env, ctx);
    if (forecast) return forecast;
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return response;
  };
}

export default { fetch: createHandler() };
