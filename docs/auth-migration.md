# Auth Migration

The legacy app stores users in MongoDB with bcrypt password hashes. Clerk can import bcrypt digests, so users should be able to keep their existing passwords after migration.

## Inputs

- Legacy MongoDB collection: `main_db.users`
- Required user fields: `_id`, `email`, `password`, `date_created`, `has_access_token`
- Clerk secret: `CLERK_SECRET_KEY`

## Dry Run

```bash
npm run auth:migrate:dry-run
```

This connects to MongoDB, validates user records, and prints aggregate counts only. It does not create Clerk users.

Legacy users without valid email addresses or bcrypt password hashes are skipped and reported. The current legacy database has test users in that category; they should not block migration of real users.

If the old `.env` Mongo URI is stale, pass a current URI without committing it:

```bash
MONGODB_URI='mongodb+srv://...' npm run auth:migrate:dry-run
```

## Apply

```bash
CLERK_SECRET_KEY='sk_live_or_test_...' MONGODB_URI='mongodb+srv://...' npm run auth:migrate:apply
```

The apply step:

- Creates missing Clerk users with `passwordDigest` and `passwordHasher: "bcrypt"`
- Reuses existing Clerk users by `externalId` or email
- Sets `externalId` to the old Mongo `_id`
- Adds private metadata with the legacy user id and access-token state
- Writes `migration-output/auth/profiles.sql` for D1 profile import
- Writes `migration-output/auth/skipped-users.jsonl` for users that were intentionally skipped

After review, apply the generated profile SQL to D1:

```bash
npx wrangler d1 execute DB --local --file migration-output/auth/profiles.sql
npx wrangler d1 execute DB --remote --file migration-output/auth/profiles.sql
```

Run the remote command only after confirming the Clerk import results.

## Production Clerk Import

The Clerk test and live environments are separate. A successful import into the
development/test instance does not create users in production, and the generated
`profiles.sql` contains Clerk user ids for only the environment used during that
run.

Set `CLERK_SECRET_KEY` in `.env.local` to the live `sk_live_...` key, then run
the production import into a separate output directory:

```bash
npm run auth:migrate:prod:apply
```

The script is idempotent for Clerk users:

- Reuses users already matched by `externalId`
- Reuses users already matched by email
- Creates missing users with imported bcrypt password digests
- Writes production Clerk ids to `migration-output/auth-production/profiles.sql`

After reviewing the output counts and any errors, apply the production profile
SQL to D1:

```bash
npx wrangler d1 execute DB --remote --file migration-output/auth-production/profiles.sql
```

Use the older `migration-output/auth/profiles.sql` only for the Clerk
environment that generated it. In the current local setup, that file was
generated from the test Clerk instance.
