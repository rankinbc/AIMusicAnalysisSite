# Deploying SPECTR: start here

A plain-language guide to how spectrmix.com gets from code on this machine to the live site. The detailed operations manual is [../runbook.md](../runbook.md); this page is the orientation.

Keep secrets, passwords, keys and server IP addresses out of this folder. The GitHub repo is public.

## The short version

1. You change code on a feature branch.
2. The branch is merged into `develop`, then `develop` is fast-forwarded into `solo`.
3. Pushing to `solo` runs the automated checks only. **It does not deploy.**
4. You deploy on demand by running the workflow on `solo`. It runs the checks, builds the app, and updates the server.
5. If the new version fails its health check, the server puts the previous version back by itself.

## The pieces

| Piece | What it is | Where |
|---|---|---|
| Domain and DNS | spectrmix.com; also forwards your `@spectrmix.com` email | Cloudflare |
| Server | One Azure virtual machine running everything in Docker | Azure |
| Code and automation | The repo and the "ci" workflow that tests and deploys | GitHub (`rankinbc/AIMusicAnalysisSite`) |
| App images | The built app, stored between build and deploy | GitHub Container Registry |
| Audio file storage | Uploaded tracks | Cloudflare R2 |
| Payments | Subscriptions and credit packs | Stripe |
| Outgoing email | Verification and notification emails | Resend |
| AI | The coach and specialists | Anthropic API (pay per use) |

On the server, these run side by side: the web server (Caddy, which also handles HTTPS), the API (the "BFF"), two background workers, the database (Postgres) and the queue (Redis).

## Branches

| Branch | Role |
|---|---|
| a feature branch | Where a change is made |
| `develop` | Where finished changes are collected |
| `solo` | What the live site is built from. Deploy-only |
| `master` | Frozen archive of the older social version. Don't use |

## How to deploy

From any checkout, with the GitHub CLI:

```bash
gh workflow run ci --ref solo      # run the checks AND deploy
gh run watch                       # follow it
```

Or in the browser: GitHub → Actions → "ci" → Run workflow → branch `solo`.

What it does, in order: secret scan and all test suites → build three images (API, worker, web) → security scan → upload the images → open a temporary door to the server for this one run → tell the server to switch to the new version → health check → close the door.

Database changes ("migrations") apply automatically when the new API starts. That means **merge + deploy = the database change is applied**. Anything that deletes or rewrites data needs a fresh backup first (see the runbook's destructive-migration rule).

## After a deploy: check it worked

```bash
curl -f https://spectrmix.com/healthz        # the API is up
curl -sI https://spectrmix.com | head -1     # the site answers
```

Then, in a browser: load the home page, open the demo, and upload a short track on `/analyze`. A green health check does not prove the background workers are processing jobs; an actual upload does.

## Rolling back

- **Automatic:** a deploy that fails its health check is reverted for you.
- **Manual:** on the server, `/opt/spectr/deploy.sh rollback` puts back the previous version. This needs SSH access to the server; see the runbook.
- A rollback restores the previous **code**. It does not undo a database change.

## Changing a setting without deploying

Many limits are "feature flags": rows in the database that take effect within about a minute, with no deploy. Examples: turning credits on or off, guest upload limits, monthly AI spending caps. The runbook lists them. This is how you raise capacity before a launch day.

A changed secret (an API key in the server's `.env` file) needs `/opt/spectr/deploy.sh redeploy` on the server.

## Before each release

- [ ] All checks green on `solo` (the push run).
- [ ] Does the release change the database? If it deletes or rewrites data, take a backup first.
- [ ] Any new secret or setting it needs is already on the server.
- [ ] Deploy, then do the "check it worked" steps above.
- [ ] If you expect a traffic spike, raise the guest and AI budget limits first.

## What costs money

- **Azure server:** fixed monthly cost; there is a budget alert on the Azure account.
- **Anthropic API:** grows with usage. Guests and free users are capped by flags; check the caps before any promotion.
- **Stripe:** a percentage of each sale.
- **Cloudflare R2:** storage, small at current volume.
- **Resend, GitHub, Cloudflare DNS and email routing:** free at current volume.

## Known gaps

Open items are tracked in [../launch-checklist.md](../launch-checklist.md). Two worth knowing as a newcomer: confirm nightly database backups are actually scheduled, and set up an outside uptime check on `/healthz` so you hear about downtime before a user tells you.

## Glossary

- **Deploy:** putting a new version of the app on the live server.
- **CI:** the automated checks GitHub runs on every push.
- **Image / container:** a packaged, ready-to-run copy of one part of the app; Docker runs them.
- **Migration:** a scripted change to the database's structure.
- **Rollback:** returning to the previous version.
- **Health check:** a URL the server answers "ok" on when it's working.
- **Feature flag:** a setting stored in the database that changes behaviour without a deploy.
- **Secret:** a password or key the app needs; lives only on the server and in GitHub's secret store, never in the repo.
- **DNS:** the records that tell the internet where spectrmix.com and its email go.
- **SSH:** a secure remote login to the server's command line.

## Where the detail lives

| Document | Use it for |
|---|---|
| [../runbook.md](../runbook.md) | Step-by-step operations: deploy, rollback, backups, stuck jobs, budgets, secrets |
| [../launch-checklist.md](../launch-checklist.md) | What must be true before promoting the site |
| [../deployment-guide.md](../deployment-guide.md) | Short technical overview of the production stack |
| [../STARTUP.md](../STARTUP.md) | Running the app on this machine (not the live site) |
| [../azure-deploy-remaining-work.md](../azure-deploy-remaining-work.md) | Notes from the original Azure setup |
