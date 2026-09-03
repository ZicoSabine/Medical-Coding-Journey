# Medical Coding Journey

A beginner medical coding learning portfolio documenting study notes, case studies, and practice across ICD-10-CM, CPT, and HCPCS Level II.

[Case study activity dashboard](https://ZicoSabine.github.io/Medical-Coding-Journey/) · [Privacy guidance](PRIVACY.md)

## Study in Obsidian, then push

1. Open or create a note anywhere inside `Medical Coding/Case Study/`. Existing cases can stay where they are; the difficulty subfolders are optional.
2. Use **Templates: Insert template** and choose Simple, Intermediate, or Complex from the existing shared `Templates/Case Study Templates/` folder in the School Notes vault.
3. Work on the case. New templates start with `status: in-progress` and a blank `date`.
4. When you actually finish, use Obsidian's **Properties** to set `status` to `completed` and `date` to the completion day.
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
| `status` | `not-started`, `in-progress`, `completed` |
| `date` | Actual completion date, `YYYY-MM-DD`; blank until completed |

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

The heatmap is calculated from `status` and `date`. **Git commit dates, push dates, creation times, and modification times are never used as study dates.** In-progress and not-started cases do not count, even if they have a date. A completed case with a blank or invalid date fails the build with its path and the property to fix. Fix the note and push again; the previous successful deployment remains available.

Only `Case Study/` is scanned recursively. Template directories and filenames with a separate `Template` or `Templates` word are excluded, including `Case Study/Templates/` if one is added later. The shared `Templates/Case Study Templates/` directory, other note categories, hidden directories, and generated output are outside the scan. Symlinks and junctions are not followed. Notes without case Properties are ignored.

There is no invented activity. No completed notes means an empty heatmap. Do not mark blank examples or copied templates as completed.

## Dashboard

The dark static dashboard shows a rolling calendar year ending on the viewer's local today (365 or 366 days), in Monday–Sunday rows and about 53 week columns. Calendar calculations and formatting preserve date-only values without timezone shifts. Activity outside the visible year remains in the aggregate data; future padding is inactive and never shows activity.

Hover, focus, or select a square for its date and count. On mobile, tap a square and scroll the calendar horizontally. Tab enters the calendar at the selected day; arrow keys move by day vertically and week horizontally. Home/End move within the week, Ctrl+Home/End jump to the range edges, and Escape dismisses the tooltip. The selected date and count also stay visible below the graph.

The fixed intensity scale is **0 / 1 / 2–3 / 4–5 / 6–9 / 10+ cases per day**. Edit `LEVEL_THRESHOLDS` in `site/calendar.js` to change it; the legend updates from the same thresholds. Colors are `--level-0` through `--level-5` in `site/styles.css`.

## Repository structure

```text
Medical Coding/
├── Case Study/
│   ├── CS - 1.md
│   ├── Simple/
│   ├── Intermediate/
│   └── Complex/
├── CPT/
├── HCPCS II/
├── ICD/
│   ├── Basic Coding Rules.md
│   └── Introduction.md
├── site/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── calendar.js
├── scripts/build_site.py
├── tests/
│   ├── test_build_site.py
│   └── test_calendar.mjs
├── .github/workflows/pages.yml
├── .gitignore
├── requirements.txt
├── PRIVACY.md
└── README.md
```

The existing shared templates stay at the sibling path `../Templates/Case Study Templates/{Simple,Intermediate,Complex}.md`. The School Notes `.obsidian/` settings and CSS snippets stay outside this repository. Empty learning folders use `.gitkeep` files so Git preserves them.

## Local build and preview

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

For the optional local JavaScript checks, install Node.js **22.7 or newer** (CI uses 24):

```sh
node --test tests/test_calendar.mjs
node --check site/app.js
node --check site/calendar.js
```

The Python builder validates notes, recreates `_site/`, copies only the four static site files, and generates `_site/data/case_activity.json`. This JSON contains only completion dates and aggregate counts. `_site/` is ignored by Git; do not manually edit or commit generated data. Python and PyYAML are the only build dependencies; Node is used only to test JavaScript.

## GitHub Pages setup

In this repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. The workflow follows GitHub's [custom Pages workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Push to `main` or use **Actions → Deploy case study dashboard → Run workflow**. Pull requests run validation without deploying. A successful build uploads only `_site/`; the separate deployment job publishes it using the `github-pages` environment. No workflow commits JSON back into Git. If environment protection requires approval, approve that deployment in GitHub.

The project URL is [ZicoSabine.github.io/Medical-Coding-Journey](https://ZicoSabine.github.io/Medical-Coding-Journey/). It becomes available after the first successful Pages deployment.

## Privacy

Use fictional or appropriately anonymized educational cases and material you may distribute. Never publish real patient-identifiable or confidential provider information. Review note bodies, Properties, attachments, filenames, and Git changes before each push. A public repository exposes committed notes even though the dashboard only displays counts. Automated checks cannot guarantee removal of PHI; see [PRIVACY.md](PRIVACY.md).
