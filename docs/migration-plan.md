# Gridworld Streaming Rebuild Plan

## Current App Reference

The migration reference is `react_app/gridworld_streaming_10_30_2024`, which is the clean Git snapshot synced with `origin/main`.

## Old Stack To Remove

- Create React App and `react-router-dom`
- MongoDB collections for users, albums, tracklists, tracks, album artwork, downloadables, and security questions
- Firebase URLs stored directly on track/artwork/download records
- Custom JWT/bcrypt authentication, localStorage sessions, and security-question password reset
- Express/serverless API duplication

## New Stack

- Next.js App Router
- Cloudflare Workers via `@opennextjs/cloudflare`
- Cloudflare D1 for catalog/profile/payment state
- Cloudflare R2 for audio, artwork, and downloadable files
- Clerk for authentication and account/password flows
- Stripe Checkout plus webhook-driven access-token activation

## Data Mapping

- `users.has_access_token` becomes `profiles.has_access_token`, keyed by `clerk_user_id`
- `albums`, `tracklists`, and `tracks` become normalized `albums`, `tracks`, and `album_tracks`
- `album_artworks.firebaseUrl`, `tracks.firebaseURL`, and downloadable Firebase URLs become R2 object keys
- Stripe checkout metadata should use `clerkUserId`, not Mongo ObjectIds

## Next Steps

- Use `docs/auth-migration.md` to dry-run and import legacy users into Clerk
- Export Mongo data and write a one-time migration script from Mongo documents to D1 rows
- Copy Firebase Storage objects into R2 under stable keys such as `audio/{album-slug}/{track-number}-{slug}.mp3`
- Replace placeholder Wrangler D1 `database_id` after `wrangler d1 create gridworld-streaming`
- Add admin-only content management after the public catalog and checkout flow are verified
