-- Weekly Reports Dashboard -- WP3 follow-up: fix the api_tokens.org_read INSERT
-- grant, and close two latent anon baseline grants.
--
-- WHY (from the post-deployment scoped-access audit):
--
-- 1) 20260726000018_scoped_access.sql added the `org_read` column to
--    `api_tokens` and an RLS `with check (... org_read = false or
--    has_role_at_least('admin'))` to gate who may mint an org-read token --
--    but it never widened the `authenticated` INSERT column-grant, which was
--    last set by 20260724000010_oauth.sql to exactly
--    `grant insert (id, user_id, token_hash, label)`. Postgres checks the
--    column grant BEFORE RLS, so:
--      * an admin CANNOT mint an org_read token (the feature is inert and its
--        admin-gating RLS is dead code), and
--      * more importantly, `app/api/tokens/route.ts`'s POST now always
--        includes `org_read` in its INSERT, so the moment the WP3 app code is
--        deployed to catch up to this DB, EVERY MCP-token creation fails with
--        42501 -- including ordinary org_read=false tokens. Production (still
--        on the pre-WP3 app) is not broken yet; this migration must be applied
--        BEFORE the app catches up.
--    Granting INSERT on the `org_read` column lets the existing
--    `api_tokens_insert` RLS `with check` do its real job (admin-only org_read).
--
-- 2) `anon` still holds the Supabase baseline table grants on `api_tokens`
--    (including `token_hash`, `org_read`, `refresh_token_hash`) and on
--    `allowed_signup_domains` -- the recurring "baseline grant survived a
--    migration" trap this schema has been bitten by before. Both tables are
--    currently protected only by RLS-with-no-anon-policy (hard deny), so this
--    is NOT exploitable today -- but if any anon-facing policy is ever added
--    (e.g. a future OAuth iteration on api_tokens), those latent grants would
--    immediately expose token hashes / allow self-minting. Revoke them now for
--    the same defense-in-depth posture team_members/reports/projects already
--    have. `authenticated`'s narrow column grants are untouched.

grant insert (org_read) on public.api_tokens to authenticated;

revoke all on public.api_tokens from anon;
revoke all on public.allowed_signup_domains from anon;
