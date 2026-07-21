# FawxzzyWeb account-subdomain readback

Observed: `2026-07-21T20:47:48Z`

Status: domain, DNS, TLS, and passive route postimage verified. This receipt records read-only
evidence; it performed no provider, repository, environment, Auth, data, or production mutation.

## Identity

- Vercel team: `fawxzzy`.
- Existing project: `fawxzzyweb`.
- Existing project ID: `prj_vhUyajI4AL6BgCF40VnKtdxrBLuV`.
- Account origin: `https://account.fawxzzy.com`.
- Current READY production deployment: `dpl_BUsjRvDPpBqqtMoZyupdeFcPp7VM`.
- Deployed source revision: `9d892a73fb8fc6df7440a18c4b8ea71064604a15`.

## Provider and public readback

- `vercel domains inspect account.fawxzzy.com --scope fawxzzy` found the domain under the
  `fawxzzy` team and listed project `fawxzzyweb` as its attached project.
- Public DNS read through Google Public DNS returned one A record:
  `account.fawxzzy.com -> 76.76.21.21`.
- `https://account.fawxzzy.com/auth/callback` returned HTTP 200 from `76.76.21.21` with successful
  TLS verification.
- `https://account.fawxzzy.com/reset-password?recovery=1` returned HTTP 200 from `76.76.21.21`
  with successful TLS verification.
- `https://fawxzzy.com/` independently remained HTTP 200 with successful TLS verification.

These checks prove route delivery and the existing domain postimage. They do not prove that the
target Supabase environment, publishable key, Auth policy, SMTP, CAPTCHA, schema, or user data is
installed or ready. The source continues to fail closed when those separately governed
capabilities are absent.

## Mutation accounting and rollback

- Repository writes during readback: none; this receipt is the subsequent durable record.
- Vercel deployments, promotions, rollbacks, aliases, domains, or configuration changed: none.
- Cloudflare DNS, nameservers, DNSSEC, email, Workers, R2, or registrar state changed: none.
- Supabase/Auth/schema/data/provider state changed: none.
- Existing production deployment and its rollback chain were not altered.
