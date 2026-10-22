const COOKIE = 'warm_admin_session';
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
const SERVICES = new Set(['family', 'office', 'packing']);
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
async function keyFor(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hmac(secret, message) {
  return hex(await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(message)));
}
async function passwordMatches(supplied, expected) {
  const [a, b] = await Promise.all([supplied, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}
function requireAuthConfig(env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(503, 'Admin access is not configured. Set ADMIN_PASSWORD and SESSION_SECRET.');
  }
}
async function issueSession(env) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const version = await hmac(env.SESSION_SECRET, `password:${env.ADMIN_PASSWORD}`);
  const payload = `${expires}.${crypto.randomUUID()}.${version}`;
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}
async function authenticated(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return false;
  const cookies = request.headers.get('Cookie') || '';
  const token = cookies.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || token.length > 256) return false;
  const pieces = token.split('.');
  if (pieces.length !== 4) return false;
  const [expires, nonce, version, signature] = pieces;
  if (!/^\d{10,11}$/.test(expires) || !/^[a-f0-9-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(version) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (+expires <= now || +expires > now + SESSION_SECONDS + 60) return false;
  const signatureBytes = Uint8Array.from(signature.match(/../g), part => parseInt(part, 16));
  if (!await crypto.subtle.verify('HMAC', await keyFor(env.SESSION_SECRET), signatureBytes, encoder.encode(pieces.slice(0, 3).join('.')))) return false;
  return version === await hmac(env.SESSION_SECRET, `password:${env.ADMIN_PASSWORD}`);
}
function cookie(request, token, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
function sameOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, 'This request must come from this website.');
}
async function readJSON(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, 'Use a JSON request.');
  if (+request.headers.get('Content-Length') > 16384) throw new HttpError(413, 'Request is too large.');
  if (!request.body) throw new HttpError(400, 'A request body is required.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new HttpError(413, 'Request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Invalid request.');
  return data;
}
async function rateLimit(binding, request, category) {
  if (!binding) return;
  const key = `${category}:${request.headers.get('CF-Connecting-IP') || 'local'}`;
  const { success } = await binding.limit({ key });
  if (!success) throw new HttpError(429, 'Too many attempts. Please wait one minute and try again.');
}
function validateBooking(data) {
  if (!SERVICES.has(data.service)) throw new HttpError(400, 'Choose a valid service.');
  const record = { service: data.service };
  for (const field of ['fromAddress', 'toAddress']) {
    if (typeof data[field] !== 'string' || data[field].trim().length < 3 || data[field].trim().length > 300 || /[\x00-\x1f]/.test(data[field])) throw new HttpError(400, 'Enter a full address between 3 and 300 characters.');
    record[field] = data[field].trim();
  }
  const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
  const digits = phone.replace(/\D/g, '');
  if (phone.length > 30 || !/^[+\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) throw new HttpError(400, 'Enter a valid contact number.');
  record.phone = phone;
  const day = data.moveDate;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Choose a valid moving date.');
  const parsed = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day || day < today) throw new HttpError(400, 'Choose today or a future moving date (UK time).');
  record.moveDate = day;
  return record;
}
async function staticFile(request, env, path) {
  const url = new URL(request.url);
  url.pathname = path;
  url.search = '';
  const response = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: request.headers }));
  const assetBase = validAssetBase(env.ASSET_BASE_URL);
  if (!assetBase || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  return new HTMLRewriter()
    .on('link[href^="/css/"]', { element(element) { element.setAttribute('href', assetBase + element.getAttribute('href')); } })
    .on('img[src^="/images/"]', { element(element) { element.setAttribute('src', assetBase + element.getAttribute('src')); } })
    .on('meta[name="asset-base-url"]', { element(element) { element.setAttribute('content', assetBase); } })
    .transform(response);
}
function validAssetBase(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/bookings' && request.method === 'POST') {
    sameOrigin(request);
    await rateLimit(env.BOOKING_RATE_LIMITER, request, 'booking');
    const body = await readJSON(request);
    const data = validateBooking(body);
    if (!env.BOOKINGS) throw new HttpError(503, 'Bookings are temporarily unavailable. Please call us.');
    const created = new Date();
    const match = typeof body.submissionId === 'string' ? body.submissionId.match(/^(\d{13})-([a-f0-9-]{36})$/) : null;
    if (body.submissionId !== undefined && (!match || +match[1] > created.getTime() + 300000 || +match[1] < created.getTime() - 7 * 86400000)) throw new HttpError(400, 'The request has expired. Refresh the page and try again.');
    const id = match ? match[2] : crypto.randomUUID();
    const orderingTime = match ? +match[1] : created.getTime();
    const record = { id, createdAt: created.toISOString(), ...data, status: 'new' };
    // R2 lists keys lexicographically. Reverse timestamps make every page newest-first.
    const key = `bookings/${String(9999999999999 - orderingTime).padStart(13, '0')}-${id}.json`;
    const stored = await env.BOOKINGS.put(key, JSON.stringify(record), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
    if (!stored) {
      const existingObject = await env.BOOKINGS.get(key);
      if (!existingObject) throw new HttpError(503, 'Your booking could not be confirmed. Please try again.');
      const existing = await existingObject.json();
      if (Object.keys(data).some(field => existing[field] !== data[field])) throw new HttpError(409, 'This request reference was already used. Refresh the form before making a different booking.');
      return json({ id: existing.id, createdAt: existing.createdAt }, 200);
    }
    return json({ id, createdAt: record.createdAt }, 201);
  }
  if (path === '/api/admin/login' && request.method === 'POST') {
    sameOrigin(request);
    requireAuthConfig(env);
    await rateLimit(env.ADMIN_LOGIN_RATE_LIMITER, request, 'login');
    const body = await readJSON(request);
    if (typeof body.password !== 'string' || body.password.length > 256 || !await passwordMatches(body.password, env.ADMIN_PASSWORD)) throw new HttpError(401, 'Incorrect password.');
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, await issueSession(env)) });
  }
  if (path === '/api/admin/logout' && request.method === 'POST') {
    sameOrigin(request);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (path === '/api/admin/bookings' && request.method === 'GET') {
    if (!await authenticated(request, env)) throw new HttpError(401, 'Please sign in.');
    if (!env.BOOKINGS) throw new HttpError(503, 'R2 storage is not configured.');
    const cursor = url.searchParams.get('cursor') || undefined;
    if (cursor?.length > 2048) throw new HttpError(400, 'Invalid page cursor.');
    const page = await env.BOOKINGS.list({ prefix: 'bookings/', limit: 25, ...(cursor ? { cursor } : {}) });
    const items = await Promise.all(page.objects.map(async object => {
      const entry = await env.BOOKINGS.get(object.key);
      if (!entry) return null;
      return entry.json();
    }));
    return json({ bookings: items.filter(Boolean), cursor: page.truncated ? page.cursor : null });
  }
  if (path.startsWith('/api/')) throw new HttpError(404, 'Endpoint not found.');
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
  if (path === '/admin' || path.startsWith('/admin/')) {
    requireAuthConfig(env);
    const loggedIn = await authenticated(request, env);
    const page = await staticFile(request, env, loggedIn ? '/admin/index.html' : '/admin/login.html');
    const response = new Response(page.body, page);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }
  return staticFile(request, env, path === '/' ? '/index.html' : path);
}
export default {
  async fetch(request, env) {
    let response;
    try { response = await route(request, env); }
    catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
      else {
        // Do not log addresses, phone numbers, passwords, or R2 object bodies.
        console.error('Worker request failed.');
        response = json({ error: 'The service is temporarily unavailable. Please try again.' }, 503);
      }
    }
    const result = new Response(response.body, response);
    for (const [name, value] of Object.entries(securityHeaders)) result.headers.set(name, value);
    const assetBase = validAssetBase(env.ASSET_BASE_URL);
    const assetOrigin = assetBase ? new URL(assetBase).origin : '';
    result.headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' ${assetOrigin}; img-src 'self' data: ${assetOrigin}; connect-src 'self'; frame-src https://maps.google.com https://www.google.com https://google.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`);
    return result;
  }
};
