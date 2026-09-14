# SPECTR on Azure — Full-Feature Resume Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the complete SPECTR product (7-phase analysis, AI Coach chat, on-demand specialists, verdicts/Fix Rack, stems flow, Listen rack, anonymous try-it funnel, email verification, observability, backups, CI/CD) live on the public web, hosted on Azure, at minimal monthly cost.

**Architecture:** One Azure Ubuntu VM running the repo's existing production stack (`infra/compose.prod.yml`: Caddy TLS edge + BFF + 2 worker pools + Postgres + Redis + Prometheus/Grafana), deployed by the existing `infra/deploy.sh` (health-gated, auto-rollback) from GHCR images built by the existing CI. Object storage stays on Cloudflare R2 (the code's S3 path; Azure Blob is not S3-compatible and there is no reason to rewrite it). This is deliberately NOT App Service / Container Apps — see "Why a VM" below.

**Tech Stack:** Azure VM (Ubuntu 24.04, B-series), Docker Compose, Caddy (auto-ACME TLS), GHCR, GitHub Actions (existing `ci.yml` deploy job), Cloudflare R2, Resend (email), Anthropic API (coach/specialists), healthchecks.io + ntfy.sh (free alerting).

**Spec:** User directive 2026-09-13 — "Do the whole thing. This is supposed to look impressive. With the chatbot and all that." Nothing feature-cut; "minimal" means smallest Azure footprint/cost that runs everything. Research findings from the 2026-09-13 session are embedded below as constraints.

---

## Why a VM (and not TMOS_AI's pattern, and not Container Apps)

- **TMOS_AI** deploys a single Python zip to App Service + a SPA to Static Web Apps, with zero IaC, zero containers, no DB/Redis/storage — and its commit history is a five-round fight with Kudu/Oryx deploy deadlocks. Nothing there maps to a 5-service containerized stack. Ignored per user instruction, except: its `azure/login@v2` OIDC pattern is noted for future Azure-CLI automation from CI (not needed for v1 — our CI deploys over SSH).
- **This repo already has a complete, tested production design** for exactly one Linux host: `infra/compose.prod.yml` + `deploy.sh` (flock, tag pinning, in-network health probe, auto-rollback) + `backup.sh`/`restore-test.sh` + Caddyfile (HSTS, HTTP/3, SSE-safe proxy, crawler split) + a CI deploy job that scp's infra files and SSHes `deploy.sh <sha>`. An Azure VM **is** that host. Zero re-architecture.
- **Container Apps would actively break things:** the worker's allin1 path shells `docker run` (impossible on ACA forever), Caddy's role is redundant behind ACA ingress, SSE + 24h read timeouts need special-casing, and managed Postgres + managed Redis + ACA vCPU-seconds cost more than one B2-series VM. It buys buzzwords, costs weeks. Flagged as a possible later migration, not v1.
- **Interview story is better on the VM anyway:** "CI builds pinned images, Trivy-scans, pushes to GHCR, SSHes to Azure, health-gates the deploy and auto-rolls back; Prometheus/Grafana + alerting to my phone; nightly pg_dump to R2 with automated restore drills" beats "I clicked Container Apps."

## Decisions made (revisit any of these by editing the relevant task)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Azure VM `Standard_B2s` (2 vCPU / 4 GB), Ubuntu 24.04, 32 GB Standard SSD, static IP | Idle footprint of the full 9-container stack is ~1.5 GB; one running analysis peaks ~+1.5 GB — fits 4 GB + the 2 GB swap **with observability kept**. Two *simultaneous* analyses lean on swap (acceptable at demo traffic). ~$30/mo; `Standard_B2als_v2` is the fallback if capacity-blocked. After a stable week, buy a 1-yr savings plan/reservation (~35% off → ~$19–21/mo). Disk: audio lives in R2; 32 GB covers images + Postgres + rotated logs. |
| D2 | Object storage: **Cloudflare R2** (not Azure Blob) | `S3ObjectStore` + worker boto3 are S3-API; R2 free tier (10 GB, zero egress fees) covers a demo. Azure Blob would require writing a new store implementation — no juice. |
| D3 | **Credits stay OFF** (`credits_enabled` DB seed is already `'false'`) → every visitor/account is tier `pro`: unlimited analyses, unlimited coach, stems/ALS/full verdicts, billing UI hidden | Recruiters hit zero paywalls and see the whole product. Stripe boot-requirement relaxed (`SPECTR_REQUIRE_STRIPE=0`). Flipping billing ON later is Phase 2 (P2-B). |
| D4 | **Email stays ON** (`SPECTR_REQUIRE_EMAIL=1`, real Resend keys) | Free tier (100/day), and working transactional email + DKIM/SPF is an impressive, cheap detail. With credits off the verify *gate* never blocks anyone, but verification emails still flow. |
| D5 | **LLM = Anthropic API key** with two independent spend caps: a hard monthly limit set in the Anthropic console (~$15), plus the worker's own budget gate via `LLM_BUDGET_*` env (global $10/mo default) | The chatbot (coach), triage, and specialists all run the real SDK path (`worker/app/llm/gateway.py`). A full recruiter session (coach chat + several specialists) costs well under $0.50, so $10/mo is a generous ceiling. If the budget trips, the product degrades gracefully to rule-engine findings + a "coach offline" notice — it never breaks. |
| D6 | **allin1 structure detection ships DISABLED in v1** — Phase 7 renders "not assessed" (verified graceful path in `phase1_universal.py:248-257`) | The only feature not in v1. See "Juice vs. squeeze" — it needs docker-socket plumbing + a small code change + 10–20 min CPU/track. Phase 2 task P2-A if wanted. |
| D7 | Keep the full observability stack (Prometheus, Grafana, node-exporter, alert rules → ntfy) | Costs ~300 MB RAM and $0. Grafana reached via SSH tunnel only. Major interview asset. |
| D8 | Domain required (drives Caddy auto-ACME + Resend DKIM + `App:FrontendOrigin`). Any registrar; put DNS on Cloudflare (free) since R2 is there anyway | ~$12/yr. `SPECTR_DOMAIN` is the only place it's configured. **Cloudflare proxy (orange cloud) must be OFF** (DNS-only) or Caddy's ACME + SSE will fight it. |
| D9 | **Demo queue topology**: worker pool A consumes `coach` only; pool B consumes `analysis-paid analysis-free maintenance` | With credits off, everyone's analyses route to `analysis-paid`, which in the stock FR34 topology shares pool W1 with `coach` — the chatbot would stall for the length of any running analysis. Splitting coach onto its own pool keeps it always-responsive. This deliberately abandons the free/paid starvation split (there are no paying users to starve at demo traffic); restore the stock `WORKER_QUEUES` values if P2-B ever turns credits ON for real users. |

## Juice vs. squeeze — flagged for user decision (nothing else is cut)

| Feature | v1 status | What "on" costs | Recommendation |
|---|---|---|---|
| **allin1 structure detection** (Phase 7 arrangement grade, beat grid) | Off; grade shows "N/A — not assessed"; every other phase unaffected; anon jobs never used it anyway | Docker socket mount + docker CLI in worker image + a host-path translation change in `docker_allin1.py`/`structure_actor.py` (~1 day), then 10–20 min CPU per track as a deferred background fill-in (or a GPU VM at ~10× the monthly cost) | Ship without it; add via P2-A only if the arrangement tab matters to the demo story |
| **Billing/paywall demo (Stripe test mode, credits ON)** | Off — everyone premium | Stripe test keys + webhook endpoint config + flip `credits_enabled` flag (~2–3 h). Shows the tier system, checkout, caps chips | Keep off — friction for recruiters outweighs showing the paywall. P2-B if you want to demo the billing engineering |
| **Demucs real stem separation** (`USE_DEMUCS`) | Off (repo default); fast spectral phase 4 runs in ~1–2 s | torch+demucs in the worker image (+~3 GB), 10–20 min CPU/track | Leave off. Uploaded-stems analysis (the real feature) works fully without it |
| **Curated reference library** (`data/reference_library/`) | Empty on server; user-uploaded references work fully | Copying commercial reference tracks to a public server = distributing audio you may not have rights to | Leave empty unless you own cleared tracks; user-upload reference flow covers the demo |
| **Legacy `api/` component** | Not deployed (it isn't in `compose.prod.yml` at all) | — | Nothing to do |

## Global Constraints

- No feature removed beyond D6. Coach chat, specialists, verdicts, Fix Rack, stems stage/classify/confirm, Listen rack DSP, anon funnel, email verification, share links must all work on the live site.
- Reuse `infra/*` unchanged except the three edits in Task 1. All prod config = env vars in `/opt/spectr/.env`, chmod 600 (AR31). No secrets in git, ever.
- Images: `ghcr.io/rankinbc/spectr-{bff,worker,web}` pinned by commit SHA, deployed only via `/opt/spectr/deploy.sh` (never `docker compose up` by hand against `:latest`).
- EF Core migrations apply automatically at BFF boot (`Migrations__ApplyAtBoot=true`, advisory-lock serialized). No manual migration step, no Alembic (frozen legacy).
- Monthly cost target ≈ **$36–45** infra + capped LLM spend (≤$10) + $12/yr domain. Set an Azure Cost Management budget alert at $60.
- Local machine is Windows: `az` CLI + `ssh`/`scp` from PowerShell. The VM is Ubuntu 24.04.
- Known landmine (repo `.env.example`, caps warning): `STORAGE_LOCAL_ROOT=/data` is a COMPOSE-ONLY value. It is already correct in compose; never export it on the host.

---

### Task 1: Repo fixes — shared storage volume, Stripe relax, LLM budget env

The one real bug: in `infra/compose.prod.yml` the BFF mounts `bff_data:/data` but the workers only mount `worker_models:/data/models`, so every anon upload (and legacy proxy upload) written through `LocalDiskFileStorage` is **invisible to the worker** → the anon funnel dead-ends. Fix: one host bind mount shared by BFF + both workers (also gives us a host path for the demo asset in Task 8, and for P2-A later).

**Files:**
- Modify: `infra/compose.prod.yml`

**Interfaces:**
- Produces: all three app services mount host `/opt/spectr/data` at `/data`; compose boots without Stripe secrets; workers receive `LLM_BUDGET_GLOBAL_USD` / `LLM_BUDGET_PRO_USD`.

- [ ] **Step 1: Edit `infra/compose.prod.yml`** — six changes:
  1. `bff` service `volumes:`: replace `- bff_data:/data` with `- /opt/spectr/data:/data`.
  2. `worker-paid` `volumes:`: replace `- worker_models:/data/models` with `- /opt/spectr/data:/data`.
  3. `worker-free` `volumes:`: same replacement.
  4. Top-level `volumes:` block: delete the now-unused `bff_data` and `worker_models` entries.
  5. Billing gate: `SPECTR_REQUIRE_STRIPE: "1"` → `"0"`, and the four `Stripe__*: "${STRIPE_...:?}"` lines → `:-` form, e.g. `Stripe__SecretKey: "${STRIPE_SECRET_KEY:-}"` (compose must boot without Stripe; the checkout endpoint then returns `stripe_not_configured` at request time — verified in `Program.cs:355-377`). Leave `SPECTR_REQUIRE_EMAIL: "1"` and all `Resend__*` `:?` lines alone (D4).
  6. In the `x-worker-env` / `&worker-env` anchor, add two lines:
     ```yaml
     LLM_BUDGET_GLOBAL_USD: "${LLM_BUDGET_GLOBAL_USD:-10}"
     LLM_BUDGET_PRO_USD: "${LLM_BUDGET_PRO_USD:-8}"
     ```
     (`worker/app/llm/budget.py` resolves feature-flag first, env fallback second; with credits off everyone is tier `pro`, so pro + global ceilings are the live guards.)
  7. Queue reshape (D9): `worker-paid` env `WORKER_QUEUES: "coach analysis-paid"` → `"coach"`; `worker-free` env `WORKER_QUEUES: "analysis-free maintenance"` → `"analysis-paid analysis-free maintenance"`. Safe because every worker process loads all actors (declarations are identical; `--queues` only filters what a pool consumes, and dispatch is by actor name — the CLAUDE.md "sole declarer" gotcha is about actor decorators, which this does NOT touch). Trade-off accepted: an on-demand specialist (`analysis-paid`) queues behind a running analysis; the coach never does.
- [ ] **Step 2: Sanity-check the compose file parses**
  Run (PowerShell, repo root): `docker compose -f infra/compose.prod.yml --env-file docker/.env config --quiet` — expect only missing-var `:?` errors for prod-only secrets (SPECTR_DOMAIN etc.), NOT a YAML parse error. Cleaner: create a scratch env file with dummy values for every remaining `:?` var and expect exit 0.
- [ ] **Step 3: Commit**
  ```
  git add infra/compose.prod.yml
  git commit -m "fix(infra): share /data across bff+workers; Stripe optional at boot; LLM spend caps; coach-first queue split for demo"
  ```
  (Use the session's standard commit attribution lines.)

### Task 2: Azure provisioning (from local PowerShell)

**Interfaces:** Produces a running Ubuntu VM with a static public IP, ports 22 (your IP only), 80, 443 open.

- [ ] **Step 1: Login + resource group**
  ```powershell
  az login
  az group create -n spectr-rg -l eastus2
  ```
  (Pick the region closest to you with B-series capacity; eastus2/centralus are usually cheapest US.)
- [ ] **Step 2: SSH key** (skip if you have one you want to reuse)
  ```powershell
  ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\spectr_azure -N '""'
  ```
- [ ] **Step 3: Create the VM**
  ```powershell
  az vm create -g spectr-rg -n spectr-vm `
    --image Ubuntu2404 --size Standard_B2s `
    --admin-username spectr `
    --ssh-key-values $env:USERPROFILE\.ssh\spectr_azure.pub `
    --public-ip-sku Standard --public-ip-address-allocation static `
    --os-disk-size-gb 32 --storage-sku StandardSSD_LRS
  ```
  Record the `publicIpAddress` from the output — it is `<VM_IP>` everywhere below. (If `B2s` is capacity-blocked, `Standard_B2als_v2` is the same shape, slightly cheaper.)
- [ ] **Step 4: Open web ports; restrict SSH to your IP**
  ```powershell
  az vm open-port -g spectr-rg -n spectr-vm --port 80,443 --priority 900
  az network nsg rule list -g spectr-rg --nsg-name spectr-vmNSG -o table   # find the SSH rule name (usually 'default-allow-ssh')
  az network nsg rule update -g spectr-rg --nsg-name spectr-vmNSG -n default-allow-ssh --source-address-prefixes "<your-home-ip>/32"
  ```
- [ ] **Step 5: Budget alert** — Azure Portal → Cost Management → Budgets → create `spectr-monthly`, $60/month, email alert at 80% and 100%. (The CLI for this is subscription-scope JSON gymnastics; portal is 2 minutes.) Also check for free credit first: a Visual Studio / Dev Essentials subscription carries $50–150/mo Azure credit, and a brand-new account gets $200 for 30 days.
- [ ] **Step 6: Verify** — `ssh -i $env:USERPROFILE\.ssh\spectr_azure spectr@<VM_IP> 'echo ok'` prints `ok`.

### Task 3: VM bootstrap

All commands run **on the VM** over SSH.

- [ ] **Step 1: Docker Engine + compose plugin**
  ```bash
  sudo apt-get update && sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" | sudo tee /etc/apt/sources.list.d/docker.list
  sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker spectr && newgrp docker
  docker run --rm hello-world
  ```
- [ ] **Step 2: 2 GB swap** (load-bearing on the 4 GB B2s — absorbs the rare second concurrent analysis; do not skip)
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- [ ] **Step 3: App directories** (uid 10001 = the non-root user in both the BFF and worker images)
  ```bash
  sudo mkdir -p /opt/spectr/data && sudo chown -R spectr:spectr /opt/spectr && sudo chown -R 10001:10001 /opt/spectr/data
  ```
- [ ] **Step 4: GHCR login** — create a GitHub PAT (classic) with `read:packages` only, then on the VM:
  ```bash
  docker login ghcr.io -u rankinbc -p <READ_ONLY_PAT>
  ```
  (Runbook: without this, `deploy.sh` dies at pull with `denied` — the images are private.)
- [ ] **Step 5: Copy infra files** (from local PowerShell, repo root; CI re-copies these on every future deploy):
  ```powershell
  scp -i $env:USERPROFILE\.ssh\spectr_azure infra/compose.prod.yml infra/deploy.sh infra/backup.sh infra/restore-test.sh spectr@<VM_IP>:/opt/spectr/
  scp -i $env:USERPROFILE\.ssh\spectr_azure -r infra/prometheus infra/grafana spectr@<VM_IP>:/opt/spectr/
  ssh -i $env:USERPROFILE\.ssh\spectr_azure spectr@<VM_IP> 'chmod +x /opt/spectr/*.sh'
  ```

### Task 4: External services (all free tiers)

- [ ] **Step 1: Cloudflare R2** — create bucket `spectr`; create **three** API tokens (AR21 posture): `spectr-bff` (Object Read & Write, scoped to bucket), `spectr-worker` (same), `spectr-backups` (same; used only by backup.sh). Record each Access Key ID / Secret. `R2_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`.
- [ ] **Step 2: R2 CORS** (runbook prod checklist) — on the bucket, allow origin `https://<your-domain>`, methods `PUT, GET, HEAD`, `ExposeHeaders: ETag` (multipart upload needs the ETag). No blanket lifecycle-expiry rule on the bucket; add a 30-day expiry rule scoped to the `backups/` prefix only.
- [ ] **Step 3: Resend** — add your domain, publish the SPF/DKIM DNS records it gives you (at your DNS host), verify; create an API key; add a webhook pointed at `https://<your-domain>/api/email/webhook` (events: delivered/bounced/complained) and record its signing secret. `RESEND_FROM` = e.g. `SPECTR <no-reply@<your-domain>>`.
- [ ] **Step 4: Anthropic** — create an API key at console.anthropic.com and **set a monthly spend limit there** (e.g. $30) — the provider-side hard cap backstopping the worker's own budget gate.
- [ ] **Step 5: Alerting plumbing** — healthchecks.io: create a check `spectr-backup` (period 24 h, grace 6 h), record its ping URL. ntfy.sh: pick a private topic (e.g. `ntfy.sh/spectr-<random-suffix>`), subscribe in the phone app; that URL is `NTFY_URL` (used by both backup.sh failures and Grafana's contact point).

### Task 5: DNS

- [ ] **Step 1:** `A` record: `<your-domain>` → `<VM_IP>`. `CNAME`: `www` → apex (Caddy 308s www→apex). **DNS-only / proxy OFF** if the zone is on Cloudflare (D8).
- [ ] **Step 2: Verify** — `nslookup <your-domain>` resolves to `<VM_IP>` before first deploy (Caddy's ACME needs it to issue the cert).

### Task 6: `/opt/spectr/.env`

- [ ] **Step 1:** On the VM, create `/opt/spectr/.env`, then `chmod 600 /opt/spectr/.env`. Generate each secret with `openssl rand -base64 48`. Contents (values redacted here; every line required unless marked optional):
  ```bash
  SPECTR_DOMAIN=<your-domain>                 # no scheme, no trailing slash
  POSTGRES_PASSWORD=<openssl rand>
  JWT_KEY=<openssl rand>                      # ≥32 bytes; must differ from ANON_SIGNING_KEY (boot-enforced)
  ANON_SIGNING_KEY=<openssl rand>
  ANTHROPIC_API_KEY=<from Task 4.4>
  R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
  R2_BUCKET=spectr
  R2_BFF_ACCESS_KEY=<token 1>
  R2_BFF_SECRET_KEY=<token 1>
  R2_WORKER_ACCESS_KEY=<token 2>
  R2_WORKER_SECRET_KEY=<token 2>
  R2_BACKUP_ACCESS_KEY=<token 3>
  R2_BACKUP_SECRET_KEY=<token 3>
  RESEND_API_KEY=<from Task 4.3>
  RESEND_WEBHOOK_SECRET=<from Task 4.3>
  RESEND_FROM=SPECTR <no-reply@<your-domain>>
  ADMIN_API_KEY=<openssl rand>                # enables /api/admin/* + the runbook curl console
  GRAFANA_ADMIN_PASSWORD=<openssl rand>
  NTFY_URL=https://ntfy.sh/<your-topic>
  HEALTHCHECKS_BACKUP_URL=<from Task 4.5>
  # Optional: GRAFANA_PG_PASSWORD, SENTRY_DSN_BFF, SENTRY_DSN_WORKER, LLM_BUDGET_GLOBAL_USD/LLM_BUDGET_PRO_USD overrides
  # NOT set here (Task 1 made them optional): STRIPE_* — add only if executing P2-B
  ```
- [ ] **Step 2: Verify** — `docker compose -f /opt/spectr/compose.prod.yml --env-file /opt/spectr/.env config --quiet` on the VM exits 0 with only the `IMAGE_TAG` complaint remaining (that one is supplied by deploy.sh — by design it is never in .env).

### Task 7: Build images (via CI) + first deploy

- [ ] **Step 1:** Push Task 1's commit to `master`. CI runs the full gates, builds `spectr-bff` / `spectr-worker` / `spectr-web`, Trivy-scans, pushes `:sha` + `:latest` to GHCR. The CI deploy-to-VPS step self-skips (VPS_* secrets not set yet — that's Task 9). Record the green run's commit SHA.
- [ ] **Step 2: First deploy** (on the VM):
  ```bash
  cd /opt/spectr && ./deploy.sh <commit-sha>
  ```
  First boot: image pulls (~2 GB), then EF migrations apply under advisory lock (BFF healthcheck start-period is 120 s for exactly this). deploy.sh polls `/healthz` in-network up to 5 min and auto-rolls-back on failure — but there's no previous tag yet, so if it fails, read `docker compose logs bff`.
- [ ] **Step 3: Verify the edge**
  ```bash
  curl -fsS https://<your-domain>/healthz          # {"status":"ok",...}
  curl -fsSI https://<your-domain> | grep -i strict-transport   # HSTS present = Caddy cert issued
  ```
- [ ] **Step 4: Verify workers are CONSUMING, not just alive** (a heartbeat alone proves nothing — standing project rule):
  ```bash
  cd /opt/spectr
  docker compose -f compose.prod.yml --env-file .env exec redis redis-cli llen dramatiq:analysis-free   # baseline, then confirm it returns to 0 after Task 10's first test upload
  docker compose -f compose.prod.yml --env-file .env logs worker-free --since 5m | tail -20
  ```

### Task 8: Post-boot configuration

- [ ] **Step 1: Demo seed asset** (Story 12.8 — every new account gets an explorable sample report; needs the audio at storage key `audio/demo/source.wav`). From local PowerShell, pick a track you own the rights to:
  ```powershell
  scp -i $env:USERPROFILE\.ssh\spectr_azure <path-to-demo.wav> spectr@<VM_IP>:/tmp/demo.wav
  ```
  On the VM:
  ```bash
  sudo mkdir -p /opt/spectr/data/audio/demo
  sudo mv /tmp/demo.wav /opt/spectr/data/audio/demo/source.wav
  sudo chown -R 10001:10001 /opt/spectr/data/audio
  ```
- [ ] **Step 2: Backup + restore-drill cron** (runbook schedule):
  ```bash
  (crontab -l 2>/dev/null; echo '15 03 * * *  cd /opt/spectr && ./backup.sh >> backup.log 2>&1'; echo '30 04 * * 0  cd /opt/spectr && ./restore-test.sh >> restore-test.log 2>&1') | crontab -
  ```
- [ ] **Step 3: Fire a manual backup now** — `cd /opt/spectr && ./backup.sh`; confirm the object appears under `backups/` in R2 and healthchecks.io shows a ping.
- [ ] **Step 4: Alert test-fire** — `curl -d "spectr alert test" $NTFY_URL` reaches your phone; open Grafana via `ssh -i ... -L 3000:localhost:3000 spectr@<VM_IP>` → `http://localhost:3000`, confirm the SPECTR ops dashboard has data and the 5 provisioned alert rules are green.

### Task 9: Wire CI auto-deploy

- [ ] **Step 1:** GitHub repo → Settings → Secrets and variables → Actions: add `VPS_HOST=<VM_IP>`, `VPS_USER=spectr`, `VPS_SSH_KEY=<contents of ~/.ssh/spectr_azure (private key)>`. (Optional: `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY` — baked into the web bundle at build.)
- [ ] **Step 2: Verify** — push any trivial commit to master; the CI deploy job now scp's infra + runs `deploy.sh <sha>` and the site updates. From here on, **merge to master == deploy** (which is why the repo's destructive-migration rule requires a fresh backup before merging one).

### Task 10: Full live validation (the "impressive demo" pass)

Run in a normal browser + an incognito window against `https://<your-domain>`:

- [ ] **Anon funnel** (incognito): landing → try-it → upload an MP3 → progress → report shows grade/score/danceability + the #1 finding with the rest gated. Confirm the Redis queue from Task 7.4 drained. **This validates the Task 1 storage fix end-to-end.**
- [ ] **Register** from that incognito session: anon report is claimed into the library; the DemoSeeder sample report appears; a verification email actually arrives (Resend).
- [ ] **Full analysis**: upload a real track via UnifiedUploadDialog → completes (expect roughly a minute for a no-stems track per the repo's measured 63 s baseline, on this VM likely 2–4 min) → all results tabs render; Phase 7 shows "not assessed" (expected — D6).
- [ ] **The chatbot**: AI Coach tab → send a message → streamed reply arrives (worker `coach_reply` via Anthropic SDK). Run one on-demand specialist from the roster → verdict card appears; Fix Rack populates.
- [ ] **Listen rack**: playback works (Range-streamed audio), EQ/comp/width tools audibly change the signal, meters move.
- [ ] **Stems**: drag-drop several stems → classify proposals appear → confirm → per-stem findings in the report. **Reference**: upload a reference track → reference tab populates.
- [ ] **Share link**: open a report's share URL in incognito — public page renders.
- [ ] **Ops story**: `./deploy.sh rollback` on the VM, confirm the site downgrades cleanly, then `./deploy.sh <sha>` back. Screenshot Grafana dashboards for the resume/interview.
- [ ] **Memory check** after the first few analyses: `free -m` on the VM — swap usage should be near zero at idle and modest during an analysis. If it's constantly deep in swap, resize to `B2ms` (`az vm resize`) — that's the one-command escape hatch.
- [ ] **Cost check** after 48 h: Azure Cost analysis daily burn ≈ $1.3/day; Anthropic console shows only your test spend.
- [ ] **After one stable week**: buy a 1-year Azure savings plan / reserved instance for the B2s (~35% off → ~$19–21/mo). And when the resume isn't actively circulating, `az vm deallocate -g spectr-rg -n spectr-vm` parks everything at ~$6–8/mo (disk + IP only); `az vm start` restores it — same IP, same data — in ~3 minutes.

---

## Phase 2 (optional — each is a separate mini-PRP if approved)

- **P2-A: allin1 structure detection on the VM.** Build `docker/allin1/Dockerfile` on the VM (~10 min, image is CPU-only); add `/var/run/docker.sock` mount + `docker-cli` package to the worker image; code change: `docker_allin1.py` needs a container→host path translation (env e.g. `ALLIN1_HOST_ROOT=/opt/spectr/data` mapped from `/data`) because the `-v` mount it constructs must reference a **host** path, and `structure_actor.py` must materialize audio under `/data` (host-visible) rather than a container-local tempdir. Runtime: 10–20 min CPU/track, filled in as a deferred background job (`detect_structure_job`, 35-min time limit — only fires for logged-in version-bearing jobs). ~1 day of work.
- **P2-B: Billing showcase.** Stripe test-mode keys into `.env`, webhook endpoint `https://<domain>/api/billing/stripe/webhook` registered in the Stripe dashboard, `SPECTR_REQUIRE_STRIPE=1` restored, then `UPDATE feature_flags SET value='true' WHERE name='credits_enabled'` (≤60 s propagation, no restart; flip back the same way).
- **P2-C: Tiny cleanup.** The legacy BFF `CoachChatService` endpoint (`/api/coach/{jobId}/chat`) shells out to a `claude` binary that doesn't exist in the container → 500s if anything ever calls it. The SPA doesn't. Delete the service + mapping.
- **P2-D: Azure-native migration** (Container Apps + Flexible Server + managed Redis) — only if a job posting specifically wants managed-PaaS Azure experience. Not recommended otherwise (see "Why a VM").

## Cost summary (monthly, approximate — confirm in the Azure pricing calculator for your region)

| Item | Cost |
|---|---|
| VM Standard_B2s (2 vCPU/4 GB), pay-as-you-go | ~$30 (~$19–21 with 1-yr savings plan) |
| 32 GB Standard SSD OS disk | ~$2.50 |
| Static public IP (Standard) | ~$4 |
| Egress | ~$0 at demo traffic (audio is served via R2 presigned GETs anyway) |
| Cloudflare R2, Resend, healthchecks.io, ntfy.sh, GHCR | $0 (free tiers) |
| Anthropic API | capped ≤ $10 by worker budget + console hard limit |
| Domain | ~$12/yr |
| **Total** | **≈ $38–48/mo pay-as-you-go → ≈ $27–35/mo reserved → ~$8/mo deallocated between job searches** |

Rejected cost levers (documented so they aren't re-litigated): Spot VM (eviction = dead resume link), nightly auto-shutdown (recruiters browse at odd hours), ARM VMs (multi-arch CI builds via QEMU for the numba/llvmlite compile — real effort, modest savings), Container Apps scale-to-zero (managed Postgres + Redis baseline eats the savings), leaving Azure (defeats the resume purpose).
