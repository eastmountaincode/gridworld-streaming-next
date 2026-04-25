# Media Migration

The legacy app stores media URLs in MongoDB as Firebase Storage URLs and stores downloadable bundle paths on `downloadables.formats`.

The R2 migration keeps object keys aligned with the old Firebase Storage object paths:

- Track audio: `audio_files/.../*.mp3`
- Album artwork: `album_artwork/*.png`
- Download bundles: `compresed_download_files/*.zip`

Keeping these keys stable makes the D1 content migration simple because Mongo records can be mapped directly from Firebase paths to R2 keys.

## Inspect

```bash
npm run media:inspect
```

This builds `migration-output/media/manifest.json` without downloading or uploading.

## Download Missing Firebase Objects

```bash
npm run media:download
```

Local files under `../object_storage_files` are reused. Firebase objects missing locally are downloaded to `migration-output/media/cache`.

## Upload To R2

```bash
npm run media:upload
```

This uploads every manifest object to the remote `gridworld-streaming-media` R2 bucket with content-type metadata.

Wrangler currently rejects object uploads above 300 MiB. Larger ZIP bundles need to be uploaded through R2's S3-compatible multipart API or the Cloudflare dashboard.

For local multipart uploads, create an R2 API token with Object Read & Write access for `gridworld-streaming-media`, then provide credentials through environment variables or `.env.local`:

```bash
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_ACCOUNT_ID=073abd4ee247f9cf77d6a08d9fa12f12
```

Then run:

```bash
npm run media:upload:large
```

The script uses AWS CLI against R2's S3-compatible endpoint, ignores the regular `~/.aws` credential files, uploads only failed manifest objects above 300 MiB, verifies each remote object size with `head-object`, and updates `migration-output/media/manifest.json`.

If Firebase returns HTTP 402 during `media:download`, restore Firebase billing/quota access or provide the missing files locally under `../object_storage_files` with the same object paths.
