# SPECTR Operations Runbook

Operational checklists the architecture references (architecture.md "Repo
additions"). Sections land with the story that creates the concern; 10.1
(production topology) extends this file.

## Email deliverability (story 4.2 / NFR25)

The email pathway: producer → `IEmailSender` (BFF: template render +
suppression check) → `send_email` dramatiq actor (`maintenance` queue,
3 retries) → Resend HTTP API. Without `RESEND_API_KEY` the actor logs
instead of sending (dev default).

### Resend account setup

1. Create the Resend account; generate an API key (`re_...`).
   - Worker env: `RESEND_API_KEY=re_...`
   - BFF env: `Resend__ApiKey=re_...` (gating/visibility only — the BFF never
     calls Resend directly).
2. Add the sending domain in Resend (Domains → Add). Until DNS verifies,
   keep the default `Resend__FromAddress` (`onboarding@resend.dev` sandbox —
   sends only to the account owner's address).

### DNS checklist (SPF / DKIM / DMARC — complete BEFORE launch)

Resend shows the exact records under Domains → your domain. Verify each:

- [ ] **SPF**: TXT on the Resend-provided `send` subdomain, value
      `v=spf1 include:amazonses.com ~all` (Resend rides SES). Verify:
      `nslookup -type=TXT send.<domain>`
- [ ] **DKIM**: the `resend._domainkey.<domain>` TXT record (p=... public key).
      Verify: `nslookup -type=TXT resend._domainkey.<domain>`
- [ ] **DMARC**: TXT at `_dmarc.<domain>`, start with
      `v=DMARC1; p=none; rua=mailto:<ops-address>` and tighten to
      `p=quarantine` after 2 clean weeks of reports.
- [ ] Resend dashboard shows the domain **Verified** (it checks SPF+DKIM).
- [ ] Send a test through the pipeline (`send_email` actor with a real key)
      to a Gmail address; confirm `PASS` for SPF, DKIM, and DMARC in the
      "show original" headers.
- [ ] Update `Resend__FromAddress` to the real domain sender
      (e.g. `SPECTR <noreply@spectr.app>`) in prod env only.

### Bounce/complaint webhook

1. Resend dashboard → Webhooks → Add endpoint:
   `https://<prod-host>/api/email/webhook`, events `email.bounced`,
   `email.complained`.
2. Copy the signing secret (`whsec_...`) → BFF env `Resend__WebhookSecret`.
   Unconfigured secret → the endpoint answers 503 and Resend retries.
3. Suppressions land in the `email_suppressions` table; `QueueEmailSender`
   skips suppressed addresses at enqueue time. Rows are never auto-deleted —
   remove manually only with the user's explicit re-consent.

### Prod boot gate

Set `SPECTR_REQUIRE_EMAIL=1` in prod: boot then fails unless
`Resend__ApiKey` AND `Resend__WebhookSecret` are configured
(same pattern as `SPECTR_REQUIRE_STRIPE`).

## Secret rotation (stub — 10.1 expands)

- JWT signing key (`Jwt__Key`): rotation invalidates all access tokens
  (≤15 min blast radius); refresh tokens are DB-hashed and unaffected.
- `Anon__SigningKey`: rotation orphans anonymous device cookies — rotate
  only with a migration plan (Epic 4.5+).
- `RESEND_API_KEY` / `Resend__WebhookSecret`: rotate freely; update env and
  restart worker/BFF.
