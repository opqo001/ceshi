# Warm Moving — Cloudflare Worker

English removals website with a booking form, one embedded Google map, private R2 booking storage, and a password-protected administration page.

**完整中文部署说明：[DEPLOY-CLOUDFLARE.zh-CN.md](./DEPLOY-CLOUDFLARE.zh-CN.md)**

## Project layout

```text
public/
  index.html              Landing page
  booking.html            Booking form
  admin/                  Admin dashboard and login HTML
  css/styles.css          Website styles
  css/admin.css           Admin styles
  js/script.js            Booking submission
  js/address-maps.js      Shared Google map and driving route
  js/admin.js             Admin login and booking list
  images/                 Background image and service SVG illustrations
src/worker.js             HTTP routes, authentication and R2 persistence
wrangler.jsonc            Worker, static assets, R2 and rate-limit bindings
scripts/                  Validation and local setup helpers
tests/                    Worker unit tests and local integration check
```

## Local development

Use Node.js 22 or later (Node.js 24 was used for verification).

```sh
npm ci
npm run setup:local
npm run dev
```

Website: `http://127.0.0.1:8787/`  
Admin: `http://127.0.0.1:8787/admin`  
Local admin password: `123`.

Local R2 data stays in `.wrangler/`. It is separate from your production bucket. The setup helper generates a random local signing secret in `.dev.vars`; do not upload this file.

## Production resources

| Name | Type | Value / purpose |
| --- | --- | --- |
| `BOOKINGS` | R2 binding | Bucket `warm-moving-bookings` |
| `ASSETS` | Static assets binding | `./public`, supplied automatically by Wrangler |
| `ADMIN_PASSWORD` | Runtime secret | Set to `123` as requested |
| `SESSION_SECRET` | Runtime secret | Independent random value, at least 32 characters |
| `ADMIN_LOGIN_RATE_LIMITER` | Rate-limit binding | Configured in `wrangler.jsonc` |
| `BOOKING_RATE_LIMITER` | Rate-limit binding | Configured in `wrangler.jsonc` |
| `ASSET_BASE_URL` | Optional runtime variable | Alternate HTTPS base for public CSS and images |

Keep the booking bucket private. The Worker uses its R2 binding; no public R2 URL or S3 access key is needed. Runtime secrets belong in Worker **Settings → Variables & Secrets**, not the build-only variables section.

This project is uploaded to GitHub and deployed as a complete Worker + Static Assets project. Copying only `src/worker.js` into the dashboard editor will not deploy the frontend assets.

## Checks

```sh
npm run check
npm test
npx wrangler deploy --dry-run
```

With the local server running, `npm run test:integration` creates a fictional local booking and verifies native R2 writes, duplicate suppression, authenticated reads and the admin password. It is fixed to localhost and does not write to production.

## Behaviour

- A success receipt appears only after R2 confirms the write.
- Repeating the same submission preserves the original record instead of creating duplicates.
- Admin records are paginated in groups of 25, newest submission first.
- Sessions use signed, HttpOnly, SameSite cookies and expire after eight hours. HTTPS sessions also use Secure cookies. Changing the admin password invalidates existing sessions.
- The contact number `+44 20 7946 0123` is a reserved UK example number, not a working business line. Replace it in both public HTML pages before using telephone bookings.
- The Google map does not require an API key. It previews the active address and then the driving route. Google address autocomplete and reading the iframe's internal address fields are not included.
- Booking requests are real persisted records after deployment; availability is still confirmed manually. No email or SMS delivery is configured.
- The requested password `123` is weak. You can replace it through the `ADMIN_PASSWORD` runtime secret without editing frontend code.

No Cloudflare account resources have been created or deployed by this project preparation. Follow the deployment guide to create and bind the production bucket.
