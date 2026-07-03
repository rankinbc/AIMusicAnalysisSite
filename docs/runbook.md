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

Set `SPECTR_REQUIRE_EMAIL=1` on BOTH services in prod:
- BFF: boot fails unless `Resend__ApiKey` AND `Resend__WebhookSecret` are set.
- Worker: dramatiq startup fails unless `RESEND_API_KEY` is set — the worker
  is the component that actually sends; without this gate a configured-BFF /
  unconfigured-worker deploy silently stubs every email.

### Operational notes

- **Dead letters**: after `max_retries=3` transient failures, dramatiq moves
  the message to the `dramatiq:maintenance.XQ` dead-letter queue (7-day TTL).
  A lost dunning/retention email is recoverable from there — check XQ depth
  when Resend has an outage. (Monitoring hook: 10.2.)
- **Latency**: `send_email` shares the maintenance lane with `sweep_retention`
  on a 1-process worker — an email enqueued mid-sweep waits. Fine for today's
  producers (retention warnings); REVISIT before 4.3 puts time-sensitive
  reset links ("expires in N minutes") on this lane.
- **Queue payload visibility**: enqueued messages carry recipient + rendered
  HTML in Redis until consumed, and dramatiq failure logs include actor args.
  Today's producers embed no secrets; 4.3 (verification/reset links) must
  either accept short-token-expiry exposure or move to an outbox-reference
  pattern. Decision recorded in story 4.2 review.
- **Suppressed = unreachable**: a suppressed address silently receives
  NOTHING — including password resets. Support diagnosis: check
  `email_suppressions` for the user's address; removal only with the user's
  explicit re-consent (complaints especially).

## Secret rotation (stub — 10.1 expands)

- JWT signing key (`Jwt__Key`): rotation invalidates all access tokens
  (≤15 min blast radius); refresh tokens are DB-hashed and unaffected.
- `Anon__SigningKey`: rotation orphans anonymous device cookies — rotate
  only with a migration plan (Epic 4.5+).
- `RESEND_API_KEY` / `Resend__WebhookSecret`: rotate freely; update env and
  restart worker/BFF.
