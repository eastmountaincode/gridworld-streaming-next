/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    MEDIA_BUCKET: R2Bucket;
    ASSETS: Fetcher;
    NEXT_PUBLIC_APP_URL?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_ACCESS_PRICE_ID?: string;
    R2_PUBLIC_BASE_URL?: string;
  }
}

export {};
