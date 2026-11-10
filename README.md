# A11yAgents

AI agents that test a website the way people with disabilities use it, then open pull requests that fix what they find.

Six personas (blind, low vision, colour blind, hand tremor, older first-time user, Hindi/Telugu on a slow 3G phone) each try a task on your site in a real, recorded browser. Every problem an agent reports is checked against **axe-core**; anything axe doesn't confirm is labelled **agent-only** and comes with video proof. A fix engine then maps a finding to your source, asks Gemini for a minimal patch and opens a PR. **It never merges.**

```
apps/web         Next.js 14 (App Router) + Tailwind + shadcn-style/Radix UI, built to WCAG 2.2 AA
apps/api         NestJS + Prisma + PostgreSQL, JWT (Google/GitHub OAuth) and API keys, SSE
services/agents  Python 3.11: Google ADK + Gemini, Playwright, axe-core, queue worker
actions/scan     GitHub Action  a11yagents/scan
samples/         broken-shop: a deliberately inaccessible page for demos and the e2e test
scripts/e2e.mjs  end-to-end test through the real API/queue/worker
```

## How a scan runs

1. `POST /runs` creates a Run and one PersonaRun per persona, and enqueues one job each (BullMQ locally, Pub/Sub in production, one interface).
2. A worker picks up a job, launches a fresh sandboxed Chromium with video recording, opens the URL and lets the persona's ADK agent try the task (max 40 steps, timeout, cost cap).
3. Each `report_issue` is checked against axe-core; axe violations the agent missed are added too (`source: axe`).
4. The worker posts findings + score to the API, which stores them and streams live events to the browser (`GET /runs/:id/stream`, SSE).

Score per persona is 0-100: start at 100, subtract a penalty per *rule* (its worst severity: critical 20, serious 10, moderate 4, minor 1; extra instances add 25% each, capped at 2x), halve it for axe best-practice rules that aren't WCAG criteria, and subtract 20 if the task failed.

## Quick start (local)

Requirements: Docker, plus a Gemini API key if you want the agents to actually drive the browser (see "Without Gemini").

```bash
cp .env.example .env                 # set GEMINI_API_KEY at minimum
docker compose --profile samples up --build
```

| Service | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:4000 (`/health`, `/health/ready`) |
| Broken sample site | http://localhost:8000, from inside compose: `http://broken-shop:8000` |

If a host port is taken, set `WEB_PORT`, `API_PORT`, `POSTGRES_PORT` or `REDIS_PORT`.

**Signing in locally:** OAuth needs real Google/GitHub client credentials. The compose build enables an email-only dev sign-in (`NEXT_PUBLIC_DEV_LOGIN=1`; the API's `/auth/dev-login` is disabled when `NODE_ENV=production`). Set `NEXT_PUBLIC_DEV_LOGIN=0` for any shared environment.

### Without Gemini

Everything except the LLM works without a key: personas then run **axe-only** (no agent steps), which is what the tests use.

```bash
cd services/agents && python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt && playwright install chromium
python -m a11y_agents.cli --url http://localhost:8000 --persona blind --no-llm
python -m a11y_agents.cli --url http://localhost:8000 --persona motor_tremor --goal "Buy the shoes"   # needs GEMINI_API_KEY
```

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | agents, api | Agent loop, task suggestions, fix generation. `GEMINI_MODEL` (default `gemini-2.5-flash`) |
| `DATABASE_URL` | api | PostgreSQL connection string |
| `REDIS_URL` | api, agents | BullMQ queue and live run events |
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` | api | GitHub App for the fix engine (PEM; `\n` escapes are accepted). Also `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID/SECRET` |
| `GCS_BUCKET` | agents | Bucket for videos/screenshots when `STORAGE_DRIVER=gcs` |
| `JWT_SECRET` | api | Session signing key (required in production) |
| `INTERNAL_TOKEN` | api, agents | Shared secret for worker -> API result callbacks |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | api | Sign-in with Google / GitHub (each is enabled only when set) |
| `QUEUE_DRIVER` | api, agents | `bullmq` (default) or `pubsub` (`PUBSUB_TOPIC`, `PUBSUB_SUBSCRIPTION`, `GCP_PROJECT`) |
| `STORAGE_DRIVER` | agents, api | `local` (default, `STORAGE_LOCAL_DIR`) or `gcs` |
| `MAX_STEPS`, `RUN_TIMEOUT_SECONDS`, `RUN_COST_CAP_USD` | agents | Per persona-run limits: 40 steps, 300 s, $1.00 |
| `RATE_LIMIT_PER_MIN` | api | Per-IP rate limit (default 120) |
| `MAX_CONCURRENT_RUNS`, `DAILY_PERSONA_RUN_LIMIT`, `MONTHLY_COST_CAP_USD` | api | Per-user quotas (defaults 3, 50, $20); exceeding one returns HTTP 429 |
| `SMTP_URL`, `MAIL_FROM` | api | Email alerts (e.g. `smtps://user:pass@smtp.example.com`); without `SMTP_URL` emails are logged, not sent |
| `ALLOW_PRIVATE_URLS` | api | `1` lets users scan localhost/private addresses (default on in dev, off in production, as an SSRF guard) |
| `WEB_URL`, `API_URL`, `NEXT_PUBLIC_API_URL` | all | Public URLs (the last is baked into the web build) |

## Fix engine

1. **Connect GitHub**: install the GitHub App from Settings, then set `owner/repo` on the project.
2. **Generate fix** on a finding: the API searches the repo (code search by id/class/text, falling back to the file tree), picks the best-matching file, and asks Gemini for exact-match edits. Patches must be minimal (a few small edits that each match once) or they are rejected.
3. **Open pull request**: re-applies the edits to the *current* file (fails safely if it changed), pushes a branch `a11yagents/fix-<rule>-<id>` and opens a PR with a before/after explanation and the diff.
4. If the branch gets a preview deployment (GitHub Deployments API), the same persona re-runs on it and the before/after scores are commented on the PR.

Supported rules: colour contrast, missing alt text, missing form labels (`label`, `select-name`), empty buttons/links/input buttons, missing or invalid `lang`, focus order (positive `tabindex`), page title, zoom-blocking viewport meta, iframe titles, SVG / `role=img` text alternatives, keyboard-unreachable scroll areas, `autocomplete` tokens, `aria-hidden` on focusable content, duplicate ids, skip links, small click targets and colour-only links. Anything else returns a clear "not supported yet". Structural findings (landmarks, headings, page layout) are deliberately excluded: they need design decisions, not a minimal patch.

GitHub App settings: permissions *Contents: read & write*, *Pull requests: read & write*, *Deployments: read*, *Metadata: read*; subscribe to *Pull request* and *Installation* events; webhook URL `https://<api>/webhooks/github` with `GITHUB_WEBHOOK_SECRET`; **Setup URL** `https://<web>/settings/github` with "Request user authorization (OAuth) during installation" enabled (this is how an installation is proven to belong to the signed-in user).

## CI: GitHub Action

```yaml
- uses: a11yagents/scan@v1
  with:
    api-key: ${{ secrets.A11Y_API_KEY }}
    api-url: https://api.your-a11yagents.example.com
    url: https://preview.your-site.example.com
    personas: blind,low_vision,motor_tremor
    fail-on: critical          # critical | serious | moderate | minor | none
```

Create the key in Settings -> API key. The step summary shows scores and findings; it exits non-zero when findings at/above `fail-on` exist, or if the scan itself could not run. To publish, copy `actions/scan/` to the root of a repo named `a11yagents/scan` and tag `v1`.

## Tests

```bash
npm install && (cd apps/api && npx prisma generate && npm test)   # API unit tests
(cd services/agents && pytest)                                       # agents, incl. e2e scan of samples/broken-shop (>= 5 findings)
node scripts/e2e.mjs                                                 # full stack e2e (needs the stack running + sample served)
```

## Deploy to Google Cloud Run

Three services (`api`, `web`, `agents`) plus Cloud SQL (Postgres), Memorystore (Redis), a GCS bucket and Pub/Sub. Replace `PROJECT`, `REGION`.

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  pubsub.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
gcloud artifacts repositories create a11y --repository-format=docker --location=REGION
```

**1. Infrastructure**
```bash
gcloud sql instances create a11y-db --database-version=POSTGRES_16 --tier=db-g1-small --region=REGION
gcloud sql databases create a11y --instance=a11y-db
gcloud sql users create a11y --instance=a11y-db --password="$(openssl rand -hex 16)"
gcloud redis instances create a11y-redis --region=REGION       # needs a VPC connector / Direct VPC egress for Cloud Run
gsutil mb -l REGION gs://PROJECT-a11y-artifacts
gcloud pubsub topics create a11y-jobs
```
Run artifacts are served from the bucket, so make the objects readable the way you prefer (e.g. signed URLs behind your CDN, or public read for non-sensitive scans).

**2. Secrets (Secret Manager):** keys are never baked into images or env files; Cloud Run injects them.
```bash
for s in GEMINI_API_KEY DATABASE_URL JWT_SECRET INTERNAL_TOKEN GITHUB_PRIVATE_KEY GITHUB_WEBHOOK_SECRET \
         GITHUB_CLIENT_SECRET GOOGLE_CLIENT_SECRET; do
  printf '%s' "$VALUE" | gcloud secrets create $s --data-file=-
done
# grant roles/secretmanager.secretAccessor to the api and agents service accounts
```
Redis here is used only for live run events; the production queue is Pub/Sub (`QUEUE_DRIVER=pubsub`).

**3. Build and deploy**
```bash
REG=REGION-docker.pkg.dev/PROJECT/a11y
gcloud auth configure-docker REGION-docker.pkg.dev
docker build -f apps/api/Dockerfile -t $REG/api . && docker push $REG/api
docker build -t $REG/agents services/agents && docker push $REG/agents
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t $REG/web . && docker push $REG/web

gcloud run deploy a11y-api --image $REG/api --region REGION --allow-unauthenticated \
  --add-cloudsql-instances PROJECT:REGION:a11y-db --vpc-egress=private-ranges-only --network=default --subnet=default \
  --set-env-vars NODE_ENV=production,QUEUE_DRIVER=pubsub,PUBSUB_TOPIC=a11y-jobs,REDIS_URL=redis://REDIS_IP:6379,WEB_URL=https://app.example.com,API_URL=https://api.example.com,STORAGE_DRIVER=gcs,GCS_BUCKET=PROJECT-a11y-artifacts,GITHUB_APP_ID=...,GITHUB_APP_SLUG=... \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,INTERNAL_TOKEN=INTERNAL_TOKEN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,GITHUB_PRIVATE_KEY=GITHUB_PRIVATE_KEY:latest,GITHUB_WEBHOOK_SECRET=GITHUB_WEBHOOK_SECRET:latest

gcloud run deploy a11y-web --image $REG/web --region REGION --allow-unauthenticated

# The worker pulls from Pub/Sub, so it needs no public ingress and must always have CPU: use a worker pool,
# or a service with --no-cpu-throttling --min-instances=1 and --concurrency=1 (one browser per instance).
gcloud run deploy a11y-agents --image $REG/agents --region REGION --no-allow-unauthenticated \
  --cpu=2 --memory=4Gi --concurrency=1 --min-instances=1 --no-cpu-throttling --timeout=900 \
  --set-env-vars QUEUE_DRIVER=pubsub,GCP_PROJECT=PROJECT,PUBSUB_SUBSCRIPTION=a11y-jobs-agents,REDIS_URL=redis://REDIS_IP:6379,API_URL=https://api.example.com,STORAGE_DRIVER=gcs,GCS_BUCKET=PROJECT-a11y-artifacts \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,INTERNAL_TOKEN=INTERNAL_TOKEN:latest
gcloud pubsub subscriptions create a11y-jobs-agents --topic=a11y-jobs --ack-deadline=600
```
Then: point the GitHub App webhook/setup URLs and the OAuth callbacks (`https://api.example.com/auth/google/callback`, `/auth/github/callback`) at your domains.

The API container runs `prisma migrate deploy` on start (migrations live in `apps/api/prisma/migrations`). Create new ones with `npx prisma migrate dev --name <change>`. With several API instances, run `prisma migrate deploy` once as a Cloud Run job instead. A local database created earlier with `prisma db push` must be recreated (or baselined with `prisma migrate resolve --applied 0001_init`).

## Production notes

- **Sandboxing:** one fresh Chromium + context per job (service workers blocked), non-root container, `concurrency=1` per instance; the Chromium sandbox stays on unless you set `BROWSER_NO_SANDBOX=1`.
- **Limits:** per persona-run step cap, wall-clock timeout and a Gemini cost cap (estimated from token usage; adjust `GEMINI_PRICE_*` if prices change). Per-user quotas (concurrent scans, daily persona runs, monthly AI spend) are enforced by the API; tune them in the env.
- **SSRF:** scan targets are limited to http(s) and, in production, public addresses, checked when a run/project is created. DNS rebinding between that check and the browser's request is not defended against; add egress rules (e.g. block the metadata server and private ranges from the agents' network) for real isolation.
- **Sessions:** an httpOnly, `SameSite=Lax` (and `Secure` in production) cookie set by the API; no token in page JavaScript or URLs. Cookie-authenticated writes also need an `x-csrf` header, and CORS is limited to `WEB_URL`. The web app and API must be **same-site** (e.g. `app.example.com` and `api.example.com`; `localhost` ports count as same-site). CI keys and bearer tokens bypass the cookie and CSRF check because they are not ambient credentials.
- **Observability:** JSON logs with `severity` (Cloud Logging format; auth headers redacted), `/health` and `/health/ready`, worker healthcheck.
- **Alerts:** when a finished run has critical findings, the owner gets Slack and/or email (each only if configured).
