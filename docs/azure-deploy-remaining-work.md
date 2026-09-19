# SPECTR on Azure — What's Done, What's Left

_Status as of 2026-09-14. Full technical plan: `PRPs/azure-deploy-spectr.md`. Work branch: `infra/azure-deploy`._

**Goal:** the full SPECTR product (analysis, AI Coach chat, specialists, stems, Listen rack, anonymous try-it flow, email, dashboards, backups, CI/CD) live at a real domain on one Azure VM, for ~$46/mo steady-state. Public surface is single-user — see `PRPs/solo-fork-strip-social.md`.

---

## 1. Where things stand

### Done
| What | Details |
|---|---|
| Deployment plan | `PRPs/azure-deploy-spectr.md` — architecture, decisions, all tasks |
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
| Commit plan updates | Commit the pending `PRPs/azure-deploy-spectr.md` edits | Task 6.5 finishing (avoid clashing commits) |
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
