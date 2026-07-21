-- Phase 9 (deploy): set the signup email-domain allowlist to the real
-- production domains, replacing the Phase 7a seed set (arcytex.com,
-- foundationfirst.com, foundationfirst.test).
--
-- The allowlist is enforced by public.before_user_created_hook (Phase 7a),
-- which fires only on user CREATION (password signup / magic-link auto-signup)
-- -- NOT on sign-in of an existing user. The local seed users
-- (dev@/member@foundationfirst.test) are inserted directly into auth.users by
-- supabase/seed.sql and therefore bypass the hook entirely, so removing
-- foundationfirst.test here does not affect `supabase db reset` or
-- existing-user login; it only means a brand-new SIGNUP must use one of the
-- domains below.
--
-- NOTE: the hook must also be ENABLED on each deployment target. Locally that
-- is supabase/config.toml [auth.hook.before_user_created]; on the hosted
-- project it is Authentication -> Hooks (or the Management API -- see
-- scripts/enable-auth-hook.sh). This migration only manages WHICH domains are
-- allowed, not whether the hook runs.

delete from public.allowed_signup_domains;

insert into public.allowed_signup_domains (domain) values
  ('foundationfirstmarketing.com'),
  ('arcytex.com'),
  ('paretotalent.com');
