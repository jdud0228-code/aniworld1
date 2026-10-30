# ANIWorld product MVP setup

## What's implemented

- Supabase Auth: email/password signup, sign-in, and password recovery.
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

The app uses the current origin as emailRedirectTo for signup and password reset, so the matching origin must be in the allowed redirect list. Keep email confirmation enabled for production accounts.

## Email delivery — required before public launch

The project's current built-in Supabase SMTP service is for development/testing only. Supabase documents that it sends only to email addresses belonging to members of the Supabase organization; messages to other addresses are rejected. Delivery is best-effort and subject to project-wide rate limits.

For public ANIWorld users, configure a custom SMTP provider in Supabase Dashboard → Authentication → SMTP Settings. A provider such as Resend, Postmark, Brevo, Amazon SES or SendGrid can be used. Set the SMTP host, port, username, password and sender address there, and verify the sending domain (SPF/DKIM/DMARC) with the provider. Never put SMTP credentials in frontend code or Vercel public variables.

Until custom SMTP is configured, signup confirmations and password-reset emails are not available to arbitrary public email addresses. The app's API calls are wired, but successful API acceptance does not prove email delivery.

## Vercel environment

These variables have been added to the Vercel project for Production, Preview and Development:

- SUPABASE_URL — https://ovqjgpynlgazhjunosmc.supabase.co
- SUPABASE_PUBLISHABLE_KEY — the project's Supabase publishable key

No service_role key is required by the browser or by this MVP.

After changing environment variables, create a fresh deployment.

## Verification

1. GET /api/config should return configured: true.
2. Supabase REST GET /rest/v1/watchlist?select=user_id&limit=1 should return 200 and an empty array for a new database.
3. A POST to watchlist without a signed-in user must be rejected by RLS.
4. After custom SMTP is configured, create a test account using an address you control, complete email confirmation, and sign in.
5. Add a title, change its watchlist status, save a video position, reload/sign in on another browser, and verify the list and progress sync.
6. Verify RLS prevents one user from reading/modifying another user's records.

## Production status

- Supabase Auth Site URL and production/preview redirect allow-list were entered and saved by the project owner on 2026-10-30.
- Account MVP is merged into `main` and deployed to the production Vercel alias.
- Password recovery sends a reset email to the user and handles the `PASSWORD_RECOVERY` event so a new password can be saved inside ANIWorld.

## Security hardening

The Supabase Security Advisor currently reports **Leaked Password Protection Disabled**. Supabase documents this built-in HaveIBeenPwned check as available on Pro Plan and above, so it cannot be enabled on this project's current Free plan. The signup and password-reset UI enforce an 8-character minimum, but that is not equivalent to breached-password screening. Revisit this control after upgrading the Supabase organization to Pro.
