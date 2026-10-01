# SPECTR on Azure — What's Done, What's Left

_Status as of 2026-09-14. Full technical plan: `PRPs/archive/2026-09-30_azure-deploy-spectr.md`. Work branch: `infra/azure-deploy`._

**Goal:** the full SPECTR product (analysis, AI Coach chat, specialists, stems, Listen rack, anonymous try-it flow, email, dashboards, backups, CI/CD) live at a real domain on one Azure VM, for ~$46/mo steady-state. Public surface is single-user — see `PRPs/archive/2026-09-19_solo-fork-strip-social.md`.

---

## 1. Where things stand

### Done
| What | Details |
|---|---|
| Deployment plan | `PRPs/archive/2026-09-30_azure-deploy-spectr.md` — architecture, decisions, all tasks |
| Production compose fixes (Task 1) | Commit `83292dc`, reviewed clean. Fixes the anonymous-upload storage bug, makes Stripe optional at boot, caps LLM spend ($10/mo), gives the AI Coach its own worker so chat never waits behind an analysis |
| Azure VM (Task 2) | `spectr-vm` — Standard_D2als_v7 (2 vCPU / 4 GB), Ubuntu 24.04, **centralus**, public IP **`<vm-public-ip>`** (`az vm list-ip-addresses -g spectr-rg -o table`), resource group `spectr-rg`. Ports 80/443 open. SSH key: `~/.ssh/spectr_azure` |
| Domain research | **spectrmix.com** recommended (available, ~$11/yr). Runner-up: usespectr.com |

### Fixed, awaiting review
- **CI green (Task 6.5)** — commit `16a0ed6` on `infra/azure-deploy`. CI had been red since July, so no images had been built since then. Two checks were failing: raw hex colors in CSS modules (swapped for identical tokens, no visual change) and a second, previously hidden check. The Listen Rack sliders removed their keyboard focus outline without any replacement, so they now show a focus ring when tabbed to (mouse clicks look unchanged). All 8 frontend CI steps pass locally (1,088 tests). Still to do: a diff review, and a quick look at the new focus ring on the Listen Rack page.

### Things you should know
- **The VM is running and billing** (~$2/day pay-as-you-go). To pause billing while nothing is happening: `az vm deallocate -g spectr-rg -n spectr-vm` (keeps disk + IP, ~$7/mo). `az vm start -g spectr-rg -n spectr-vm` resumes it.
- **Your subscription blocks cheap B-series VMs** in every US region, and Azure's self-serve quota increase was refused. That's why the VM is a D2als_v7 ($59/mo pay-as-you-go → ~$39/mo on a 1-year savings plan).
- **SSH is locked to one IP (your home IP)**, but your internet connection shows up from more than one address (two different addresses were seen). Expect intermittent SSH lockouts until the rule is widened — see decision D1 below.
- The plan file has uncommitted edits (VM size change, the new CI task, fixes to the bootstrap steps).

---

## 2. Decisions needed from you

| # | Decision | Recommendation |
|---|---|---|
| D1 | SSH access rule: widen from `<home-ip>/32` to `<home-ip-prefix>.0/24`? | **Yes.** Login is key-only, so the wider range is low-risk and ends the random lockouts |
| D2 | How should GitHub Actions reach the VM to auto-deploy? GitHub's runners use thousands of changing IPs, so the SSH lockdown blocks them | **Option A:** CI logs into Azure (OIDC, no stored password), opens SSH for its own IP only during the deploy, then closes it. Best security, strong resume detail. **Option B:** open SSH to the internet (key-only + fail2ban) — simplest. **Option C:** skip auto-deploy; deploy manually over SSH |
| D3 | Domain name | **spectrmix.com** |
| D4 | Add allin1 structure detection (Phase 7 arrangement grade)? | **Not for launch.** Reports show "not assessed" for that one section; ~1 day of work to add later |
| D5 | OK to merge `infra/azure-deploy` into `solo` and push? | Required for CI to build images — confirm when Task 6.5 is green |

---

## 3. Your to-do list (accounts and secrets only you can create)

Do not paste secret values into chat. Keep them handy; Section 5 explains how they get onto the server.

- [ ] **Buy the domain** at Cloudflare Registrar (cloudflare.com → Domain Registration). Keep DNS on Cloudflare.
- [ ] **Cloudflare R2** (same account): create bucket `spectr`, then three API tokens (Object Read & Write, scoped to that bucket) named `spectr-bff`, `spectr-worker`, `spectr-backups`. Save each Access Key ID + Secret, and note your account ID (the endpoint is `https://<account-id>.r2.cloudflarestorage.com`).
- [ ] **Resend** (resend.com, free): sign up, add your domain, and add the DNS records it shows you in Cloudflare. Create an API key. Add a webhook to `https://<domain>/api/email/webhook` and save its signing secret.
- [ ] **Anthropic** (console.anthropic.com): create an API key and **set a monthly spend limit (~$15)**.
- [ ] **GitHub token**: Settings → Developer settings → Personal access tokens (classic) → only the `read:packages` scope. The server uses it to pull the private images.
- [ ] **Alerts (free)**: create a healthchecks.io check named `spectr-backup` (period 1 day, grace 6 h) and save its ping URL. Install the ntfy app and pick a private topic name, e.g. `spectr-<random>`.
- [ ] **Azure budget alert**: Portal → Cost Management → Budgets → `spectr-monthly`, $75, email at 80% and 100%.
- [ ] **Demo track**: one WAV file you own the rights to. Every new account gets a sample report built from it.
- [ ] _(Optional)_ Azure Portal support ticket: request `Basv2` family quota (2 vCPUs, centralus). If approved, the VM can drop to ~$18/mo.

---

## 4. Claude's to-do list (ready to run once you say go)

Listed in order; each line notes what it waits on.

| Step | Work | Waits on |
|---|---|---|
| Task 3 — VM bootstrap | Install Docker + compose, 2 GB swap, `/opt/spectr` folders, copy infra files to the server | D1 (reliable SSH) |
| Task 6.5 — CI green | Finish the CSS lint fix, run every frontend check, review the diff | Nothing (running now) |
| Commit plan updates | Commit the pending `PRPs/archive/2026-09-30_azure-deploy-spectr.md` edits | Task 6.5 finishing (avoid clashing commits) |
| Task 5 — DNS | A record `<domain>` → `<vm-public-ip>`; `www` CNAME → apex; **Cloudflare proxy OFF** (grey cloud) | Domain purchase (you can add these two records yourself in 1 minute) |
| Task 6 — Server secrets file | Create `/opt/spectr/.env` (chmod 600) with generated keys + your secrets | Section 3 items |
| Task 7 — First deploy | Merge to solo → CI builds + scans + pushes images → run `deploy.sh <sha>` on the VM → verify `https://<domain>/healthz` and that workers are processing jobs | D5, Tasks 3/5/6/6.5, GitHub token |
| Task 8 — Post-boot setup | Upload demo track, schedule nightly backups + weekly restore test, fire a test backup and a test phone alert, check the Grafana dashboards | Task 7, demo WAV, alert URLs |
| Task 9 — Auto-deploy | Configure GitHub secrets so every merge to solo deploys | D2 |
| Task 10 — Live validation | Walk the whole product on the real site: anonymous upload → register → full analysis → AI Coach chat → specialist → stems → Listen rack → rollback drill → memory/cost check | Task 8 |
| After 1 stable week | Buy the 1-year Azure Compute Savings Plan (~$59 → ~$39/mo) | Task 10 |

---

## 5. How secrets get onto the server (without going through chat)

Once Task 3 is done, you'll run one command from PowerShell that opens a secure prompt on the VM. You type or paste each value there, and it's written straight into `/opt/spectr/.env` with owner-only permissions. Nothing appears in chat, logs, or git. Claude generates the internal keys (database password, JWT and signing keys, admin key, Grafana password) on the server itself.

---

## 6. Open follow-ups (not blocking launch)

- `infra/compose.prod.yml` header comment still lists Stripe keys as required — stale doc line.
- Legacy BFF endpoint `/api/coach/{jobId}/chat` calls a `claude` binary that doesn't exist in the container. It's unused by the app; delete it.
- Phase 2 options: allin1 structure detection (D4), a Stripe test-mode billing showcase, and resizing to B-series if the support ticket is approved.

---

## 7. Guest demo and guest uploads

Two guest flows are live on `solo`: the one-click `/demo` sandbox (a
pre-analyzed sample report, no upload) and `/analyze` (a logged-out visitor
drops their own track and gets the full product — report, coach, Listen
rack — as a capped, 24-hour guest account). Both are gated so they can be
turned on in production deliberately, not by accident.

### Guest/demo feature flags

All of these live in the `feature_flags` table and are live-tunable — an
`UPDATE feature_flags SET value=... WHERE name=...` takes effect within 60 s
(the same cache TTL every other flag in this app uses), no redeploy, no
restart. **`demo_enabled` must stay `false` in production until a real
snapshot is installed** (see below) — with it on and no snapshot, a fresh
guest falls back to a generated sine-tone sample report instead of a real
one.

| Flag | Seeded default | What it bounds |
|---|---|---|
| `demo_enabled` | `false` | Whole `/demo` one-click sandbox, on/off |
| `guest_ttl_hours` | `24` | How long a guest's account and data live before the nightly retention sweep removes them |
| `demo_guests_per_ip_hourly` | `5` | New guest sandboxes minted, per IP, per hour |
| `demo_guests_daily_cap` | `300` | New guest sandboxes minted globally, per day |
| `guest_uploads_max` | `2` | Mix uploads one guest can make |
| `guest_analyses_max` | `6` | Analyses (across all their uploads) one guest can dispatch |
| `guest_analyses_per_hour` | `10` | Guest-lane analysis dispatch rate, global |
| `guest_analyses_per_ip_hourly` | `2` | Analysis dispatch rate, per IP (checked before the global guest-lane limit above) |
| `guest_stems_max_files` | `12` | Stem files one guest can stage per version |
| `guest_stems_max_mb` | `300` | Total stem upload size (MB) per guest version |
| `guest_references_max` | `1` | Reference tracks one guest can attach |
| `guest_track_max_seconds` | `720` | Track duration (seconds) a guest can upload |
| `guest_classify_max` | `6` | Stem-classification calls one guest can make |
| `guest_ref_analyze_max` | `3` | Reference re-analyze calls one guest can make |
| `guest_attachment_mints_max` | `30` | Presigned attachment URL mints one guest can request |
| `guest_fix_racks_max` | `2` | Fix Rack (Coach Mix) generations one guest can request |
| `coach_guest_messages` | `20` | Coach chat messages one guest can send |
| `llm_budget_guest_usd` | `30` | Monthly USD LLM spend ceiling for the whole guest lane (separate from the free/pro/global budgets — a guest can never burn a real user's spend cap) |
| `anon_sample_per_hour_global` | `20` | Legacy anon-funnel rate limit — candidate for removal alongside `/api/anon/*`, see `PRPs/deferred-work.md` |

`guest_ttl_hours`, `guest_uploads_max`, and `llm_budget_guest_usd` were each
seeded once and then advanced by a later guarded `UPDATE ... WHERE
value = '<old default>'` (72→24, 1→2, 5→30) — that guard means an
operator's own live tuning of these three is never silently overwritten by
a future migration.

### Guest lifetime

A guest's account and everything it created live for `guest_ttl_hours` (24
by default) from creation, then the nightly retention sweep removes them —
so in practice a guest can outlive its stated TTL by up to a day, depending
on when in the sweep window it was created.

### Installing a real demo snapshot

Do this in order:

1. Analyze the chosen track in production, as a real (non-guest) account.
2. Open its report once, so Triage runs and the analysis gets a routing
   plan — the exporter refuses a version with no routing plan or a
   degraded analysis.
3. Re-do the source conversation with the coach on that analysis and let it
   generate the opening brief, so the exported conversation's brief is the
   good one (a fresh guest never gets a live brief from an exported
   conversation — it's exported as an ordinary message).
4. Export it:
   ```bash
   curl -X POST "https://<domain>/api/admin/demo/snapshot" \
     -H "X-Admin-Key: $ADMIN_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"versionId": "<the analyzed version id>", "reason": "install demo snapshot"}'
   ```
5. **Read the response's `freeText` before going live.** It lists every
   user-authored string the export is about to ship to every visitor: the
   song title, every rack preset name, and every message the owner typed to
   the coach. Nothing in it is filtered — that's deliberate (it's exported
   verbatim by design), so this is the one manual check that stands between
   a private-sounding message and every future visitor reading it.
6. Verify `/demo` in a private/incognito window.
7. Flip `demo_enabled` to `true`.

### Re-export retention

A later re-export doesn't delete the previous export's audio and image
assets immediately — a guest already mid-session against the old export
keeps working against it for the rest of their guest lifetime. The old
keys are staged in a manifest (`audio/demo/snapshot/retired.json`, next to
`snapshot.json`) and only actually deleted by a *later* export, once they've
sat past `guest_ttl_hours + 1 h`.

### `ALLIN1_MEMORY_LIMIT`

See "Sizing the structure-detection memory cap" in `docs/runbook.md` — same
flag, same sizing rule of thumb, not duplicated here.

### Structure detection does not run in production today

The worker image installs no Docker CLI (`components/worker/Dockerfile`)
and `infra/compose.prod.yml` mounts no `docker.sock` on either worker
service, so the `allin1` structure-detection container cannot actually be
launched from a production worker — every report's arrangement phase marks
"Not assessed for this track" regardless of the `ALLIN1_MEMORY_LIMIT`
setting above (which is still set defensively, for if/when prod ever gets
Docker access — see D4 in section 2).

### Presigned uploads are live from the first deploy — bound the orphans

`infra/compose.prod.yml` requires `Storage__S3__ServiceUrl` (R2) at boot, and
a configured `ServiceUrl` is what switches the presigned direct-upload path on
(`S3StorageOptions.IsConfigured`). So presigned uploads (mix `audio/`, and the
`stems/`, `als/`, `reference/` attachments) are ON in production from day one.
An attachment is registered with the server only when the CLIENT calls back to
confirm it, so an abandoned upload can leave bytes in the bucket that no DB row
points at. Guests are bounded by the attachment-mint caps (`GuestLimits`), not
by storage cleanup.

Before launch:
- Add an **abort-incomplete-multipart-upload** lifecycle rule to the bucket
  (R2 supports this rule type; check whether the bucket already has a default
  one). It only ever removes unfinished multipart uploads — never a completed
  object — so it is safe under the "results forever" pledge.
- Do **not** add an expiry rule on `stems/`, `als/` or `reference/`: confirmed
  uploads live under the same prefixes, and a prefix expiry would delete users'
  files (the launch checklist's "NO blanket lifecycle rule" still holds).
  Completed-but-never-confirmed objects need a server-side orphan sweep (keys
  with no DB row after N hours); that sweep is not built yet — see
  `PRPs/deferred-work.md`.
