# Medical Coding Journey

A beginner medical coding learning portfolio documenting study notes, case studies, and practice across ICD-10-CM, CPT, and HCPCS Level II.

[Open the live case study dashboard](https://ZicoSabine.github.io/Medical-Coding-Journey/) · [Privacy guidance](PRIVACY.md)

Use the interactive dashboard to select a day and follow links to its completed cases.

## Local practice application

The private study workflow runs only on your computer and reads the existing Obsidian folders directly. It does not upload case bodies, answer keys, verification history, or corrections.

Node.js 22.7 or newer is the only runtime needed. From the **Medical Coding** folder, run:

```powershell
node scripts/practice_server.mjs
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). The app provides the completion dashboard, a persistent per-case stopwatch and average solve time, difficulty selection, random pending-case selection, progressive clues, server-side answer reveal, independent user/system verification, corrections, cancellation, and guarded case completion. Cancelling discards the active session while leaving its case pending; cancelled attempts are not included in the average.

Private answer keys live in separate difficulty files under `.case-generator/answer_keys/`, such as `simple.json` and `intermediate.json`. Each file contains answers for one difficulty only. These files, active sessions, generation requests, and `.case-generator/results/` are ignored by Git. The legacy `.case-generator/answer_registry.json` remains a fallback for older installations. Never commit private answer keys.

Completing a resolved case writes its study result and preserves answer corrections with an audit trail. A full match changes the note to `status: completed`, moves it to `Case Study/Archive/<Difficulty>/`, updates the case registry, and refreshes the dashboard. If your answer is marked correct while the stored system answer is marked wrong, your answer becomes the authoritative correction automatically—no second correction entry is required. A genuinely incorrect answer still leaves the note pending, records the failed attempt, and returns the case to the practice pool.

When the repository is clean, synchronized, and on `main`, the completion screen also offers **Commit and push this completion**. This opt-in step stages only the original case path, its archived path, and `.case-generator/case_registry.json`; it commits them as `Complete CASE-####` and pushes `main` to `origin`, which triggers the dashboard deployment workflow. Private answer and result files remain ignored and are never staged. Configure a Git name, email, origin remote, upstream branch, and GitHub authentication before using it.

Publishing is deliberately disabled while other repository changes are present. Commit the application setup as a baseline first so a later completion cannot accidentally include unrelated notes or source changes. If committing or pushing fails, the clinical case stays completed and archived locally. A failed push can be retried from the result dialog without repeating completion.

The **Request More Cases** action queues a local request in `.case-generator/generation_requests.json`. The durable generator instructions consume that queue; the app never pretends that generation succeeded before the generator runs.

## Study in Obsidian, then push

1. Open a generated case in its matching `Medical Coding/Case Study/{Simple,Intermediate,Complex}/` folder. For a manually created case, insert the matching shared template from `Templates/Case Study Templates/`.
2. Generated cases start with `status: pending`; template-created cases start with `status: in-progress`. Both have a blank `date`.
3. Work on the case and record your optional `time` and `Google Help` values.
4. Prefer completing the case through the local practice app so verification history and answer corrections are preserved. For a manual completion, use Obsidian's **Properties** to set `status` to `completed` and `date` to the completion day. Keep `generated_date` as the day the case was created.
5. Review your changes, commit, and push from the **Medical Coding** folder. GitHub Actions tests, builds, and updates the dashboard automatically.

The shared template location and the vault's `Templates` setting remain unchanged. Those three canonical template files are outside this Git repository and are excluded from scanning by location. Keep using them in Obsidian; no duplicate activity log is needed. A clone on another computer needs those templates copied separately or the Properties below added manually.

Example of a completed case's Properties:

```yaml
---
type: case-study
difficulty: simple
status: completed
date: 2026-09-03
---
```

| Property | Values |
| --- | --- |
| `type` | `case-study` |
| `difficulty` | `simple`, `intermediate`, `complex` |
| `status` | `pending`, `not-started`, `in-progress`, `completed` |
| `date` | Actual completion date, `YYYY-MM-DD`; blank until completed |
| `generated_date` | Date the generated case was created; it does not determine dashboard activity |
| `case_id` | Stable generated identifier such as `CASE-0001` |
| `coding_area`, `specialty` | Descriptive generator metadata |
| `time`, `Google Help` | Optional learner-entered practice metrics |

If Obsidian shows `date` as text, choose **Date** as its property type once. `type`, `difficulty`, and `status` are text Properties. Keep existing unrelated Properties such as `cssclasses`.

From a terminal opened in **Medical Coding**, the recurring Git steps are:

```sh
git status
git diff
git add "Case Study" CPT "HCPCS II" ICD
git commit -m "Document medical coding practice"
git push
```

Only stage content you intend to publish. The School Notes vault contains other subjects and private settings outside this repository; run Git commands in Medical Coding, not the parent vault.

## What counts

**One completed Markdown case file = one case.** The scanner counts a note only when `type: case-study`, `status: completed`, and a valid completion `date` are present. Counts are grouped by that date. Supported difficulty and status values are validated.

The heatmap is calculated from `status` and `date`. **Git commit dates, push dates, creation times, and modification times are never used as study dates.** Pending, in-progress, and not-started cases do not count, even if they have a date. A completed case with a blank or invalid date fails the build with its path and the property to fix. Fix the note and push again; the previous successful deployment remains available.

Only `Case Study/` is scanned recursively. Template directories and filenames with a separate `Template` or `Templates` word are excluded, including `Case Study/Templates/` if one is added later. The shared `Templates/Case Study Templates/` directory, other note categories, hidden directories, and generated output are outside the scan. Symlinks and junctions are not followed. Notes without case Properties are ignored.

There is no invented activity. No completed notes means an empty heatmap. Do not mark blank examples or copied templates as completed.

## Dashboard

The GitHub-inspired light/dark dashboard shows a rolling calendar year ending on the viewer's local today (365 or 366 days), in Monday–Sunday rows and about 53 week columns. Calendar calculations and formatting preserve date-only values without timezone shifts. Activity outside the visible year remains in the aggregate data; future padding is inactive and never shows activity.

Hover, focus, or select a square for its date and count. Selecting a day lists all cases completed that day, with links to their Markdown files on GitHub. The URL gains a shareable fragment such as `#day=2026-09-03`; opening that link selects the same day. Days without completed cases show an empty message.

On mobile, tap a square and scroll the calendar horizontally. Tab enters the calendar at the selected day; arrow keys move by day vertically and week horizontally. Home/End move within the week, Ctrl+Home/End jump to the range edges, and Escape dismisses the tooltip. Enter or Space activates the date link. Tab then reaches the completed case links below the graph.

The fixed intensity scale is **0 / 1 / 2–3 / 4–5 / 6–9 / 10+ cases per day**. Edit `LEVEL_THRESHOLDS` in `site/calendar.js` to change it; the legend uses the same thresholds. Colors are `--level-0` through `--level-5` in `site/styles.css`, with separate light and dark surface tokens.

GitHub Pages publishes the interactive dashboard from the current case activity during each deployment. No screenshot or generated image is committed to the repository; open the live dashboard link above to use the current view.

## Repository structure

```text
Medical Coding/
├── .case-generator/
│   ├── answer_registry.example.json
│   ├── answer_registry.json        # local and ignored
│   ├── case_registry.json
│   ├── generator_instructions.md
│   ├── generation_requests.json    # local and ignored
│   ├── practice_session.json       # local and ignored
│   ├── results/                    # local and ignored
│   └── state.json
├── Case Study/
│   ├── Simple/
│   ├── Intermediate/
│   ├── Complex/
│   └── Archive/{Simple,Intermediate,Complex}/
├── CPT/
├── HCPCS II/
├── ICD/
│   ├── Basic Coding Rules.md
│   └── Introduction.md
├── site/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── calendar.js
│   ├── offline.js
│   ├── sw.js
│   ├── manifest.webmanifest
│   └── icons/
├── scripts/
│   ├── build_site.py
│   ├── practice_core.mjs
│   └── practice_server.mjs
├── tests/
│   ├── test_build_site.py
│   ├── test_calendar.mjs
│   ├── test_practice_core.mjs
│   ├── test_practice_server.mjs
│   └── test_pwa.mjs
├── .github/workflows/pages.yml
├── .gitignore
├── requirements.txt
├── PRIVACY.md
└── README.md
```

The existing shared templates stay at the sibling path `../Templates/Case Study Templates/{Simple,Intermediate,Complex}.md`. The School Notes `.obsidian/` settings and CSS snippets stay outside this repository. Empty learning folders use `.gitkeep` files so Git preserves them.

## Local checks and public-dashboard build

### Laptop and iPhone PWA

The private application shell is installable as a Progressive Web App. From a laptop, run `npm start`, open `http://127.0.0.1:8000`, and use the browser's install command. On iPhone, open the deployed private Worker URL in Safari, choose **Share → Add to Home Screen**, and launch it from the new icon. The app caches only the shell and safe offline drafts; answer reveal, verification, and completion remain network-only.

Cloud deployment uses `wrangler.toml`, `worker/index.mjs`, and `migrations/0001_initial.sql`. Create a D1 database, place its ID in `wrangler.toml` locally (never commit credentials), apply migrations with `npx wrangler d1 migrations apply medical-coding-journey --remote`, then import local cases with `npm run sync:cloud`. After completing cases in the cloud Worker, pull the cloud state back into Obsidian with `npm run sync:obsidian`; this reconciles completed dates, archive locations, case registry paths, new cloud cases, and private answer keys. Use `npm run sync:obsidian -- --dry-run` to preview changes, and add `--push` to commit and push synchronized case files to GitHub after conflict checks. Configure Cloudflare Access for the private Worker and set the `ALLOWED_EMAIL` and `SYNC_TOKEN` secrets. The public GitHub Pages dashboard remains a separate, answer-safe deployment.

Cloudflare's current Workers Free allowance is 100,000 requests/day and 10 ms CPU/request; D1 Free includes 5 million rows read/day, 100,000 rows written/day, and 5 GB storage. These limits are suitable for a single-user study workflow but should be monitored in the Cloudflare dashboard.

Cloud-to-local reconciliation uses your authenticated Wrangler session and never overwrites a local clinical body whose hash differs from D1; such cases are reported for review. The `--push` option stages only synchronized case paths and `.case-generator/case_registry.json`; it refuses to push if those paths already contain unrelated local changes. `npm run sync:corrections` creates the ignored local audit-export location.

For one bidirectional run, use `npm run sync:all`. It first reconciles cloud cases into Obsidian, then imports the resulting local state back into D1. Use `npm run sync:all -- --dry-run` to preview the cloud-to-local stage without writing to either side, `npm run sync:all -- --local` for a local D1 database, or `npm run sync:all -- --push` to also commit and push synchronized case files to GitHub.

Install Python **3.12 or newer**. From this repository:

```sh
python -m venv .venv
```

Activate the environment:

```powershell
# Windows PowerShell
.venv\Scripts\Activate.ps1
```

```sh
# macOS / Linux
source .venv/bin/activate
```

Then run:

```sh
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python scripts/build_site.py
python -m http.server 8000 --directory _site
```

Open [the local preview](http://localhost:8000). If PowerShell blocks activation, use `.venv\Scripts\python.exe` in place of `python`; activation is optional. Rebuild and refresh after note or site changes. Avoid opening `index.html` directly as a file because the page fetches its JSON over HTTP.

For local JavaScript checks and the private practice workflow, install Node.js **22.7 or newer** (CI uses 24):

```sh
node --test tests/test_calendar.mjs tests/test_practice_core.mjs tests/test_practice_server.mjs tests/test_pwa.mjs
node --check site/app.js
node --check site/calendar.js
node --check scripts/practice_core.mjs
node --check scripts/practice_server.mjs
```

The Python builder validates notes, recreates `_site/`, copies the static site files, and generates `_site/data/case_activity.json`. The JSON contains daily counts and the paths/difficulties of completed cases, so the dashboard can link to them; note bodies are not copied. GitHub Actions runs this build automatically. `_site/` is ignored by Git; do not manually edit or commit generated data.

## GitHub Pages setup

In this repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. The workflow follows GitHub's [custom Pages workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Push to `main` or use **Actions → Deploy case study dashboard → Run workflow**. Pull requests run validation without deploying. A successful build uploads only `_site/`; the separate deployment job publishes it using the `github-pages` environment. No workflow commits JSON back into Git. If environment protection requires approval, approve that deployment in GitHub.

The project URL is [ZicoSabine.github.io/Medical-Coding-Journey](https://ZicoSabine.github.io/Medical-Coding-Journey/). It becomes available after the first successful Pages deployment.

## Privacy

Use fictional or appropriately anonymized educational cases and material you may distribute. Never publish real patient-identifiable or confidential provider information. Review note bodies, Properties, attachments, filenames, and Git changes before each push. The dashboard exposes completed case filenames and links; the public repository exposes committed notes. Automated checks cannot guarantee removal of PHI; see [PRIVACY.md](PRIVACY.md).
