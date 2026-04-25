# Gridworld Streaming Next

Modern rebuild of the old Gridworld Streaming React app using Next.js, Clerk, Cloudflare D1, Cloudflare R2, and Stripe.

## Local Setup

1. Add Clerk, Stripe, and app settings to `.env.local`.
2. Replace the placeholder D1 `database_id` in `wrangler.jsonc` after creating the remote database.
3. Apply the schema locally with `npm run db:migrate:local`.
4. Run `npm run dev` for the Next dev server or `npm run preview` to test in the Cloudflare Workers runtime.

## Scripts

- `npm run dev` starts the Next.js dev server.
- `npm run preview` builds and serves through OpenNext in Wrangler.
- `npm run deploy` builds and deploys to Cloudflare Workers.
- `npm run db:migrate:local` applies D1 migrations locally.
- `npm run db:migrate:remote` applies D1 migrations remotely.
- `npm run auth:migrate:apply` imports legacy users into the configured Clerk environment.
- `CLERK_SECRET_KEY=sk_live_... npm run auth:migrate:prod:apply` imports legacy users into live Clerk.

## Migration Notes

See `docs/migration-plan.md`, `docs/auth-migration.md`, and `docs/media-migration.md`.
For production Clerk, rerun the auth migration with a live `sk_live_...` key and
use the newly generated production `profiles.sql`; test Clerk user ids do not
exist in the live environment.
