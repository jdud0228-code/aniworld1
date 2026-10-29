# ANIWorld product MVP setup

## What's implemented

- Supabase Auth: email/password signup and sign-in.
- User profiles created by an auth.users trigger.
- Per-user watchlist with statuses (planned, watching, completed, on hold, dropped).
- Per-user watch progress keyed by title, episode and voice; progress imports into the existing local-resume mechanism.
- Row Level Security (RLS) on every product table. Anonymous write attempts must be rejected.
- Runtime browser configuration is provided by GET /api/config; only a publishable key is sent to the client. Never expose a Supabase service-role key.

## Supabase project

Project: ANIWorld  
Region: eu-west-1  
Project ref: ovqjgpynlgazhjunosmc

The product MVP schema migration is in supabase/migrations/20261030000100_aniworld_product_mvp.sql.

## Required Auth URL settings

In Supabase Dashboard → Authentication → URL Configuration set:

- **Site URL:** https://aniworld1-anime-world1.vercel.app
- **Redirect URLs:** https://aniworld1-anime-world1.vercel.app/**
- To test preview deployments, add: https://aniworld1-*-anime-world1.vercel.app/**

The app uses the current origin as emailRedirectTo, so the matching origin must be in the allowed redirect list. Keep email confirmation enabled for production accounts.

## Vercel environment

The Vercel project should have these variables in Production, Preview and Development:

- SUPABASE_URL — https://ovqjgpynlgazhjunosmc.supabase.co
- SUPABASE_PUBLISHABLE_KEY — the project's Supabase publishable key

No service_role key is required by the browser or by this MVP.

After changing environment variables, create a fresh deployment.

## Verification

1. GET /api/config should return configured: true.
2. Supabase REST GET /rest/v1/watchlist?select=user_id&limit=1 should return 200 and an empty array for a new database.
3. A POST to watchlist without a signed-in user must be rejected by RLS.
4. Create a test account using an address you control, complete email confirmation, and sign in.
5. Add a title, change its watchlist status, save a video position, reload/sign in on another browser, and verify the list and progress sync.
6. Verify RLS prevents one user from reading/modifying another user's records.

## Current account setup note

The Auth URL Configuration is a dashboard-level project setting; it is not part of the SQL migration. It must be reviewed against the actual production alias before relying on confirmation-email redirects.