// Which websites may call the API from a browser (US-34). Only the origins listed in
// CLIENT_ORIGIN get CORS headers, so a page on any other site can't read the API's
// responses. Requests without an Origin header (curl, Render's health check, the Vite
// dev proxy's GET requests) aren't affected: CORS is enforced by browsers only.
//
// CORS is not access control: every /api route still needs a valid Bearer token.

import cors from 'cors';

// The methods and headers the front-end sends. Accept is always allowed by browsers.
const ALLOWED_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'DELETE']);
const ALLOWED_HEADERS = Object.freeze(['Authorization', 'Content-Type']);

// Browsers may reuse a preflight answer for this long, so a page doesn't send an
// extra OPTIONS request before every call. Chrome caps it at 2 hours.
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * Reads a comma-separated list of origins, e.g.
 * "http://localhost:5173, https://finora.vercel.app".
 *
 * @param {string|undefined} value Usually process.env.CLIENT_ORIGIN.
 * @returns {string[]} Each origin as browsers send it ("https://host[:port]"). Empty
 *   when nothing is set, so no other site is allowed.
 * @throws {Error} If an entry isn't a plain http(s) origin. The message names the entry,
 *   which is a public URL, not a secret.
 */
export function parseAllowedOrigins(value) {
  if (!value?.trim()) return [];

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(toOrigin);
}

function toOrigin(entry) {
  if (entry === '*') {
    throw new Error('CLIENT_ORIGIN must list the allowed sites, not "*".');
  }

  let url;
  try {
    url = new URL(entry);
  } catch {
    url = null;
  }
  const hasExtras = url && ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username);
  if (!url || !['http:', 'https:'].includes(url.protocol) || hasExtras) {
    throw new Error(
      `CLIENT_ORIGIN entry "${entry}" is not an origin. Use the scheme and host only, e.g. https://finora.vercel.app (no path).`
    );
  }
  // url.origin lowercases the host and drops a default port, as browsers do.
  return url.origin;
}

/**
 * @param {string[]} allowedOrigins From parseAllowedOrigins.
 * @returns {import('express').RequestHandler} Answers preflight (OPTIONS) requests
 *   itself, with 204, and adds CORS headers to every other response from an allowed origin.
 */
export function corsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return cors({
    // false leaves the CORS headers off without failing the request, so the browser
    // blocks the page from reading the response and the API logs nothing.
    origin: (origin, callback) => callback(null, origin !== undefined && allowed.has(origin)),
    methods: [...ALLOWED_METHODS],
    allowedHeaders: [...ALLOWED_HEADERS],
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  });
}
