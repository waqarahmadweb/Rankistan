# Rankistan

An AI-powered daily leaderboard tracking active Pakistani developers on GitHub. The site includes a searchable **Leaderboard**, a **Developer Map** that groups developers by normalized profile locations on an interactive map of Pakistan, a **Badge Generator** for README rank badges, **Register** for profile checks, and **About** documentation for pipeline logic, scoring, and scheduling.

> **Note:** The frontend is currently optimized for desktop. Mobile design is still under development but usable.

## Contents

- [Frontend](#frontend)
- [How It Works](#how-it-works)
- [Running Locally](#running-locally)
- [Scheduling](#scheduling)
- [Project Structure](#project-structure)
- [Groq Key Security](#groq-key-security)
- [TODO](#todo)

## Frontend

| Tab | Description |
|---|---|
| **Leaderboard** | Ranked list from `public/data.json` with search, filters, sort, CSV export, and pagination |
| **Map** | Pakistan outline with per-place counts; place breakdown; hover a node to sync-highlight and auto-scroll that place in the list; click a place to list developers for that bucket |
| **Badge** | Generate a dynamic Shields.io rank badge for your GitHub README (Markdown, HTML, or reST snippets) |
| **Register** | Validate a GitHub profile against pipeline criteria |
| **About** | How the index works: scoring, activity filters, hourly batches, and FAQs |

The map assigns each developer to a canonical place key using a deterministic normalization strategy in `src/utils/location.js`. It does token-aware country detection, alias-based city matching (including common spellings and local variants), and safe fallback handling for unresolved locations.

## How It Works

The pipeline discovers developers from GitHub's location search across all of Pakistan, fetches their recent activity, and ranks them by a weighted score. Only genuinely active developers make the cut. The leaderboard is updated incrementally — each batch refreshes its slice of the leaderboard every day.

### Daily Scanner Layer

Rankistan operates as a rolling daily scanner rather than a one-shot leaderboard rebuild.

1. Scan 40,000+ Pakistani developer profiles spanning account creation years from 2000 to present.
2. Re-evaluate 20,000+ candidates that show potential score movement from fresh profile/activity/repo signals.
3. Apply strict ranking criteria and publish only developers who pass all gates.

The scanner is distributed across 24 hourly batches, so the full ecosystem is refreshed continuously while keeping API usage within platform limits.

### Pipeline Stages

| Stage | Script | Output |
|---|---|---|
| **Discover** | `scripts/fetch-devs.js` | Searches GitHub for developers in Pakistan, split into multiple date ranges to stay within API search result limits (< 1000) |
| **Fetch** | `scripts/fetch-devs.js` | Fetches profile, events (up to 2 pages / 200 events, last 60 days), repos, and linked social accounts (for LinkedIn) for each developer |
| **Score** | `score-config.json` & `scripts/score.js` | Calculates a weighted score based on stars, recent activity, followers, and repo count using unified configuration |
| **Leaderboard** | `scripts/write-leaderboard.js` | Writes the final ranked `data.json` with public-safe fields |

During **Fetch**, each developer is assigned category tags (AI/ML, Web, DevOps, etc.) by matching bio, repos, and languages against [`src/utils/tag-keywords.json`](src/utils/tag-keywords.json) via [`src/utils/tag-matcher.js`](src/utils/tag-matcher.js). Tags flow through scoring into `public/data.json`. The leaderboard UI uses those tags when present and only recomputes them for older rows missing tags. Re-run the pipeline to refresh tags after keyword changes.

### Activity Filter

Not everyone with a GitHub account qualifies. Developers must pass these thresholds:

| Criteria | Threshold |
|---|---|
| Meaningful contributions (pushes, PRs, issues, releases) | **>=30 in the last 60 days** |
| Longest inactivity gap (between events or since last event) | **<=30 days** |
| Account age | **>=30 days** |
| Public repos | **>3** |
| Followers | **>1** |

### Search Strategy

To maximize coverage within GitHub's API limits, the discovery phase splits searches into 24 flexible date-range batches based on account creation date:

```
PK 2000-Jun2014 → PK Jul2014-Jan2016 → ... → PK Aug2024-Dec2024 → PK 2025+
```

Each batch targets ~800-950 developers (under the 1,000-result API cap). One batch runs per hour (triggered by [cron-job.org](https://cron-job.org) via `workflow_dispatch`), completing a full cycle every 24 hours. Each batch immediately merges its results into the live leaderboard using per-batch replacement — only that batch's old entries are removed and replaced with fresh data.

#### PK 2025+ (`batch-23`): multiple GitHub searches in one hourly run

The limit above is **per search request**, not per batch. The PK 2025+ window can grow past 1,000 matching accounts, which would truncate results if discovered with a single query. For **`batch_index` 23** only, `scripts/fetch-devs.js` runs **several** GitHub user searches in succession during that same workflow (narrower `created:` ranges, defined as a `queries` list on that entry in `SEARCH_BATCHES`), concatenates the usernames, then continues with the normal fetch-and-score steps. The cron schedule is still **one run per hour**; there are still **24** batch indices (`0`–`23`); leaderboard rows from this cohort still carry **`batch_index` 23**.

### Incremental Per-Batch Updates

Every developer entry in `data.json` is tagged with a `batch_index`. When batch N runs:

1. Fetch and score developers for batch N
2. Remove only entries where `batch_index === N` from the existing leaderboard
3. Insert freshly scored batch N developers (tagged with `batch_index: N`)
4. Deduplicate by username (latest batch wins), re-sort, re-rank, and cap

This means developers from batch 23 stay on the leaderboard all day until batch 23 re-runs and refreshes them. No downtime, no daily wipe.

### On-Demand AI Summary System

AI summaries are generated only when a user expands a developer card.

1. Card expansion triggers summary generation if the username is not already cached in memory.
2. Frontend sends sanitized developer metadata to the Cloudflare Worker endpoint (`/api/dev-summary`) with timeout and retry controls.
3. Worker enforces CORS and per-IP rate limits, sanitizes input again, and calls Groq using server-side secrets.
4. Returned summary text is validated (minimum length and refusal checks), trimmed to display limits, and returned to the UI.
5. Frontend caches the final summary by username so repeated expansions are instant.

This design keeps summaries accurate and interactive while avoiding expensive bulk generation across the entire leaderboard.

### README Rank Badges

Ranked developers can embed a live badge in their GitHub README via the **Badge** tab.

1. Enter a GitHub username — the UI looks up rank from `public/data.json`.
2. Pick a Shields.io style (Flat, For The Badge, Flat Square, or Plastic).
3. Copy the generated snippet (Markdown, HTML, or reST).

Badges are rendered by [Shields.io](https://shields.io) using the dynamic endpoint pattern. Shields fetches JSON from the Cloudflare Worker at `/api/badge/{username}`, which reads the current leaderboard and returns a Shields-compatible payload (for example `rank #247`). The badge updates automatically when the leaderboard changes.

Example badge URL (used inside copied snippets):

```
https://img.shields.io/endpoint?url=https%3A%2F%2Frankistan-summary-api.academics-ali.workers.dev%2Fapi%2Fbadge%2F{username}&style=flat
```

The badge API runs on the same Worker as dev summaries — not on `rankistan.dev`, which is static GitHub Pages and cannot serve API routes. Deploy Worker changes with:

```bash
npm run cf:deploy
```

### Location + Map Strategy

The frontend location system is deterministic and does not use AI for location inference.

1. Normalize raw profile text (case folding, punctuation cleanup, whitespace normalization).
2. Detect Pakistani locations using exact country tokens (for example `pakistan`, `pk`) and a curated city alias dictionary.
3. Map aliases to canonical city keys (for example `lahore`, `rawalpindi`, `dera_ghazi_khan`) so display/search/map all use one source of truth.
4. Use conservative fallback behavior:
  - If country is present but city is unknown, display **Pakistan - Place Unspecified**.
  - If no country token exists, infer only a minimal cleaned candidate for display; otherwise fall back to **Pakistan - Place Unspecified**.
5. Plot map nodes from geocoded city coordinates projected onto the Pakistan SVG viewbox, then clamp hover cards inside map bounds and render hovered cards on top of nearby nodes for readability.

### Scoring Formula

```
base_score = (stars × 2) + (activity_score) + (followers × 1) + (public_repos × 0.5)
```

> **Note on Caps**: 
> - Stars are capped at **250** per developer (contributing a maximum of **500 points**). 
> - Followers are capped at **500** per developer (contributing a maximum of **500 points**). 
> 
> Since Rankistan aims to measure active open-source contributions and development work, the previously uncapped followers (and high star cap) were causing these metrics to overpower the score, making the leaderboard less balanced and unfairly overshadowing developers who actively commit, push, and review code.

**Activity Score Breakdown**
Recent events in the last 30 days use diminishing returns per UTC calendar day, per type:

- Marginal points for the *n*th event of a type on a day: `base / log2(n + 1)`
- Daily total per type is capped, then summed across all days in the 30-day window

| Type | Base | Daily cap | Extra limit |
|------|------|-----------|-------------|
| Push | 2.0 | 15 pts | First 20 pushes/day counted |
| Issue | 1.5 | 15 pts | — |
| Pull Request | 4.0 | 25 pts | — |
| Release | 5.0 | 20 pts | — |

(Fallback: synthetic single-day curve from `event_counts_30d`, or 3.125 points per event when only flat `events_30d` exists)

`events_30d` on the leaderboard remains a raw event count; score uses the capped curve above.

For a plain-language history of how the score formula changed (and why), open the **Evolution** tab in the app.

- Stars are capped at 250 and followers are capped at 500 to prevent outlier dominance
- Accounts younger than 6 months receive a 0.5× penalty

## Running Locally

```bash
# Install dependencies
npm install

# Run a single batch incrementally (0-23)
node scripts/run-all.js --incremental 0

# Dry-run: skip GitHub, test atomic write to public/data.dry-run.json (no PAT / rate limits)
node scripts/run-all.js --incremental 0 --dry-run
# Same as: SKIP_GITHUB=true node scripts/run-all.js --incremental 0

# Start the frontend dev server
npm run dev

# Deploy the Cloudflare Worker (badge + summary APIs)
npm run cf:deploy
```

Dry-run reuses the local `public/data.json` leaderboard as sample data and writes to `public/data.dry-run.json` only. It does not run fetch, scoring, or per-batch merge — use a real incremental run when testing those steps. Production writes use an atomic temp-file + rename flow so `public/data.json` is never left partially written.

> Do not set `SKIP_GITHUB=true` in GitHub Actions; CI must run the full incremental pipeline.

## Scheduling

The pipeline runs **every hour, 24 batches per day**, triggered by an external cron service ([cron-job.org](https://cron-job.org)) that dispatches the GitHub Actions workflow via the API. This is more reliable than GitHub's built-in cron scheduler, which can delay or skip runs during peak load.

### Scheduler Flow

1. **cron-job.org** sends a `POST` to the GitHub `workflow_dispatch` API every hour
2. The workflow auto-detects which batch to run from the current UTC hour: `batch = (UTC_HOUR + 5) % 24`
3. Batch 0 aligns with **12:00 AM PKT**, batch 1 with 1:00 AM PKT, and so on

### Batch Schedule (PKT)

| PKT | Batch | Description |
|---|---|---|
| 12:00 AM | `batch-0` | PK accounts created 2000–Jun 2014 |
| 1:00 AM | `batch-1` | PK accounts created Jul 2014–Jan 2016 |
| 2:00 AM | `batch-2` | PK accounts created Feb 2016–Feb 2017 |
| 3:00 AM | `batch-3` | PK accounts created Mar 2017–Dec 2017 |
| 4:00 AM | `batch-4` | PK accounts created Jan 2018–Sep 2018 |
| 5:00 AM | `batch-5` | PK accounts created Oct 2018–Apr 2019 |
| 6:00 AM | `batch-6` | PK accounts created May 2019–Sep 2019 |
| 7:00 AM | `batch-7` | PK accounts created Oct 2019–Feb 2020 |
| 8:00 AM | `batch-8` | PK accounts created Mar 2020–Jun 2020 |
| 9:00 AM | `batch-9` | PK accounts created Jul 2020–Nov 2020 |
| 10:00 AM | `batch-10` | PK accounts created Dec 2020–Mar 2021 |
| 11:00 AM | `batch-11` | PK accounts created Apr 2021–Aug 2021 |
| 12:00 PM | `batch-12` | PK accounts created Sep 2021–Dec 2021 |
| 1:00 PM | `batch-13` | PK accounts created Jan 2022–Apr 2022 |
| 2:00 PM | `batch-14` | PK accounts created May 2022–Aug 2022 |
| 3:00 PM | `batch-15` | PK accounts created Sep 2022–Nov 2022 |
| 4:00 PM | `batch-16` | PK accounts created Dec 2022–Feb 2023 |
| 5:00 PM | `batch-17` | PK accounts created Mar 2023–Jun 2023 |
| 6:00 PM | `batch-18` | PK accounts created Jul 2023–Sep 2023 |
| 7:00 PM | `batch-19` | PK accounts created Oct 2023–Dec 2023 |
| 8:00 PM | `batch-20` | PK accounts created Jan 2024–Mar 2024 |
| 9:00 PM | `batch-21` | PK accounts created Apr 2024–Jul 2024 |
| 10:00 PM | `batch-22` | PK accounts created Aug 2024–Dec 2024 |
| 11:00 PM | `batch-23` | PK accounts created 2025+ |

### Manual Trigger

You can trigger any batch manually via **Actions → "Update Leaderboard" → Run workflow** with a specific batch index, or leave it empty to auto-detect from the current hour.

## Project Structure

```
scripts/
  fetch-devs.js         # Developer discovery + activity fetching
  score.js              # Scoring algorithm
  write-leaderboard.js  # Final leaderboard output
  run-all.js            # Pipeline orchestrator (--incremental N [--dry-run])
cloudflare/
  worker.js             # Cloudflare Worker (dev summaries + badge JSON API)
  wrangler.toml         # Worker deployment config
public/
  data.json             # Final leaderboard (served to frontend)
  data.dry-run.json     # Local dry-run output only (gitignored)
src/
  App.jsx               # Main app shell (Leaderboard / Map / Badge / Register / About tabs)
  pages/
    Leaderboard.jsx     # Developer rankings
    DevMap.jsx          # Pakistan map + place breakdown + per-place table
    BadgeGenerator.jsx  # README rank badge generator
    Register.jsx        # Profile validation
    About.jsx           # User-facing docs (pipeline, scoring, scheduling)
  utils/
    groq.js             # Worker API URL helpers (summary + badge endpoints)
```

## Cloudflare Worker API

The Worker (`cloudflare/worker.js`) backs two public endpoints:

| Route | Method | Purpose |
|---|---|---|
| `/api/dev-summary` | POST | On-demand AI developer summaries (Groq) |
| `/api/badge/{username}` | GET | Shields.io JSON for dynamic README badges |

Summary generation runs behind the Worker so the Groq key is not exposed in the frontend bundle.

### Security Model

- Frontend sends developer metadata and receives summary text; badge snippets point Shields.io at `/api/badge/{username}`.
- `GROQ_API_KEY` is stored only in Worker secrets.
- Worker enforces CORS and basic per-IP rate limiting (summaries).
- Frontend resolves Worker URLs via `VITE_SUMMARY_API_URL` (see `src/utils/groq.js`).

### Trade-off

This setup meaningfully reduces key exposure risk for a static frontend, but it is not fully abuse-proof.

Configuration model:

- **Recommended:** use `GROQ_API_KEYS` with comma/newline-separated keys for automatic fallback.
- **If you only have one key:** use `GROQ_API_KEY`.
- **Optional alternative (instead of list):** indexed secrets like `GROQ_API_KEY_1`, `GROQ_API_KEY_2` (and legacy names like `gsk_key_1`) are also supported.
- `VITE_SUMMARY_API_URL`: public frontend pointer to Worker origin.
- `SUMMARY_ALLOWED_ORIGIN`: allowed frontend origin for Worker CORS.
- `GROQ_API_KEY_PAKDEVINDEX`: still used by CI digest generation (`scripts/generate-digest.js`).

## TODO

- [x] Leaderboard — Developer rankings with daily incremental updates
- [x] Developer Map — Place distribution and per-place developer list
- [x] Badge Generator — Dynamic README rank badges via Shields.io
- [x] Registration — Profile validation against pipeline criteria
- [x] About — On-site documentation for scoring, filters, and scheduling
- [ ] Weekly Digest — AI-powered weekly summary of ecosystem trends
- [ ] Archives — Browse previous weekly digest reports
- [ ] Report Detail — Detailed view of an archived weekly report
