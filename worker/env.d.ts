/// <reference types="@cloudflare/workers-types" />

/** Bindings and vars, as declared in wrangler.jsonc and .dev.vars. */
declare global {
  interface Env {
    DB: D1Database;
    PHOTOS: R2Bucket;
    ASSETS: Fetcher;
    ORIGIN: string;
    ALLOWED_DOMAIN: string;
    ADMIN_EMAILS: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    /** Bearer token for the photo ingest route. Unset means the route is shut. */
    INGEST_TOKEN?: string;
    /** "1" enables /auth/dev, which signs in without Google. Local only. */
    DEV_LOGIN?: string;
  }
}

export {};
