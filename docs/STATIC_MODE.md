# GitHub Pages static demonstration

This mode keeps the existing React research views and neo-brutalist design. It uses the teacher's [offline export / browser prediction architecture](https://github.com/huanchen1107/1019testDIC2), adapted to this project's own regression pipeline and datasets. It does not use the teacher's metrics or models.

![Static mode with the preserved interface](screenshots/static-overview.png)

See [the measured verification results](STATIC_VERIFICATION.md).

**Update:** static mode now supports actual CSV training in a Web Worker. See [browser CSV analysis](BROWSER_CSV.md). Built-in archived models remain fixed; uploaded datasets can be configured and trained.

## Two independent modes

| Capability | Static demonstration | Local full mode |
| --- | --- | --- |
| React research views, theme, charts and dataset preview | Yes | Yes |
| Startup and Human-AI saved analyses | Versioned JSON exports | Fit using actual CSVs |
| Model A / Model B switching | Both exported models | Both fitted models |
| Numerical/categorical prediction | Browser JavaScript | Python API |
| 95% prediction and mean confidence intervals | Exported OLS parameters; verified against Python | statsmodels |
| CRISP-DM Markdown / HTML downloads | Packaged reports | Generated report |
| Change seed, split, preprocessing, predictors or k | Available for uploaded CSV; locked for built-in exports | Available |
| CSV file import and retraining | Browser worker: 10 MB / 20,000 rows / 40 columns | Available with server limits |
| Always-running Python service | Not required | Required |

Blank inputs in static prediction use the fitted training imputation values. The local API retains its original stricter input validation. Unknown categories and nonfinite numerical inputs are rejected in the static predictor. Neither mode clips predictions or intervals.

## Start the static demo locally

The committed `frontend/public/static/` artifacts are sufficient: no Python installation, Kaggle download, backend process or API credentials are needed to view the demo.

```powershell
cd frontend
npm ci
npm run dev:static
```

Open `http://127.0.0.1:5173/Aiot-HW2/`. If the full-mode dev server already occupies port 5173, stop that dev server or add `-- --port 5174` and use that port.

To test exactly the production output:

```powershell
npm run verify:static
npm run verify:browser
npm run build:static
npm run preview:static
```

Open `http://127.0.0.1:4173/Aiot-HW2/`. Static builds go to `frontend/dist-static`, separate from the original full-mode `frontend/dist`.

`frontend/.env.static` selects static mode. The default base path is `/Aiot-HW2/`, matching the actual Git remote. For a fork or custom domain, set a different base before building:

```powershell
$env:VITE_BASE_PATH='/AnotherRepository/'
npm run build:static
```

Use `/` for a root custom domain. The value must start and end with `/`. All JSON and report URLs use Vite's `BASE_URL`; they do not contain an API origin. Mode selection is a build-time choice, so a static deployment cannot accidentally enable the live backend by changing a query parameter.

## Saved analyses and provenance

The initial export preserves `data/startup-verification.json` and `data/trust-verification.json`, including every historical metric, coefficient, ranking, diagnostic and plotted coordinate. Missing adjusted training R-squared was added from an independently reproduced fit. Neither original file was edited.

| Dataset | Split | Seed | Scaling | Deduplication | Model B k |
| --- | --- | --- | --- | --- | --- |
| 50-Startups | 40 training / 10 testing | 42 | Off | Enabled | 4 encoded columns |
| Human-AI | 7,840 training / 1,960 testing | 42 | Off | Enabled | 10 encoded columns |

Both use training-only median/mode imputation, drop-first one-hot encoding, constant-column removal, SelectKBest/f_regression and three-fold training-only cross-validation. Model A uses all nonconstant encoded columns. For built-ins no uncomputed k or alternate split is exposed. Uploaded CSVs are actually trained in the browser with their selected configuration.

Export layout:

```text
frontend/public/static/
  index.json                         Current export manifest
  exports/<UTC export ID>/
    verification.json               Reproduction status and saved configuration
    startup/ and trust/
      bundle.json                    Summaries, rows, results, runtime and provenance
      historical-analysis.json       Byte-for-byte original analysis archive
      report.md / report.html        Actual CRISP-DM reports
      validation.json                Independent Python prediction/interval references
```

The bundles record dataset URLs and SHA-256 checksums, historical-result checksums, actual settings, export time and numerical-library versions. All 50 Startup rows and all 10,100 synthetic Human-AI rows are included as JSON for pagination; distributions and charts retain the original sampling policy. No arbitrary uploaded user dataset is exported.

## Regenerate exports without overwriting existing results

From the repository root, with Python dependencies and the original source data installed:

```powershell
.\.venv\Scripts\python.exe scripts/export_static.py
cd frontend
npm run verify:static
npm run verify:browser
npm run build:static
```

Each run creates a **new timestamped directory**. Existing source CSVs, historical JSON, reports and prior export directories remain untouched; only `public/static/index.json` is updated to point to the completed new export. A failed run leaves the previous manifest in place.

The script first inspects the saved results in `data/`, falling back to the previous export's historical archive when those local files are absent. It reproduces their recorded settings using the current real CSVs, compares every saved analysis field within numerical tolerance, and checks the saved default prediction. It refuses a source-checksum or result mismatch rather than silently relabeling different data as the historical analysis. Without either historical source, it produces new actual fits with the defaults documented in the script.

The script requires both datasets. On a fresh clone, follow the main README's Python setup and acquisition instructions first; Startup can load from its canonical source. Historical files are archived in the committed export even though the original `data/*-verification.json` files are Git-ignored.

On a fresh clone the exporter automatically reuses those committed historical archives, so you do not need to copy over any local results. Updating model configurations requires a real Python fit and a new export, not editing metrics or coefficients in JSON.

## Browser prediction and intervals

`src/lib/static-predict.ts` implements the exported transform in this exact order:

1. Numerical training median imputation and optional training mean/scale transformation.
2. Categorical training mode imputation and one-hot encoding with the exported category order and dropped reference indices.
3. Constant-column mask from the fitted transformer.
4. Model-specific retained-column indices, followed by the fitted intercept/coefficient dot product.

For a fitted OLS design vector `z = [1, ...retained encoded inputs]`:

```text
OLS mean = z * exported OLS parameters
mean variance = z * covariance(parameters) * transpose(z)
95% mean CI = OLS mean +/- t(.975, residual df) * sqrt(mean variance)
95% observation PI = OLS mean +/- t(.975, residual df)
                    * sqrt(mean variance + fitted residual variance)
```

The covariance, residual variance, residual degrees of freedom, and Student-t critical value all come from the actual statsmodels fit. Intervals use the OLS mean as Python does; the displayed point prediction uses the matched sklearn fit. Invalid/rank-deficient interval exports return unavailable intervals. The predictor never estimates a new variance or invents bounds.

`npm run verify:static` executes the **actual TypeScript predictor** against Python reference vectors: defaults, source rows, all categories, numerical extrema, extrapolation, missing values, scaled and unscaled pipelines, and both models. Scaled fits are validation fixtures, not selectable website results. It also checks historical-result identity, invalid inputs, unavailable intervals and report content.

## Verification commands

```powershell
cd frontend
npm run verify:static
npm run verify:browser
npm run build:static
npx playwright install chromium
npm run test:static
```

The static browser suite starts a Vite **static preview**, not FastAPI. It tests desktop and mobile at `/Aiot-HW2/`, intercepts and blocks requests outside that subpath/origin (including APIs), checks both datasets and models, renders charts, paginates data, predicts with missing inputs, downloads both report formats and verifies real custom CSV training, alternate-target retraining and prediction without a backend. On a machine with Chrome already installed, `$env:PLAYWRIGHT_CHANNEL='chrome'` can use that browser.

The existing local/full-mode Playwright suite is retained separately. `npm run test:static` does not replace or pretend to validate all local upload workflows.

## GitHub Pages deployment (not published by this change)

The workflow `.github/workflows/pages.yml` is **manual only**; there is no push-triggered deployment. Its `publish` input defaults to **false**.

When you decide to publish:

1. Review and commit the new source, export JSON/reports, documentation and workflow, then push them to `main`. Do not include `.tools`, raw private data or environment credentials.
2. In `lk000055668/Aiot-HW2`, open **Settings -> Pages -> Build and deployment -> Source**, and choose **GitHub Actions**.
3. Open **Actions -> Static GitHub Pages demo (manual) -> Run workflow**. Leave `publish` unchecked for a build/test artifact only.
4. When ready for public access, run it again with **publish checked**. Approve the `github-pages` environment if your repository requires approval.
5. After success, visit `https://lk000055668.github.io/Aiot-HW2/` and verify the two built-ins, predictions, report downloads and charts.

The workflow uses Ubuntu 24.04 with its preinstalled Chrome (`PLAYWRIGHT_CHANNEL=chrome`), derives the base path from `github.event.repository.name`, installs Node dependencies, validates preserved-model and browser-training mathematics, builds, runs the static desktop/mobile tests and uploads a Pages artifact. Only an explicitly requested publish run grants the deploy job Pages write access. No Python service, Render account or Vercel account is needed for this static demo.

## Restore the pre-change version

Before editing, the working tree was clean. A local branch points to the original commit:

```text
snapshot/pre-static-20261026-140902 -> 90a3c17
```

A Git bundle, complete workspace archive (excluding Git metadata and dependency environments), original status file and SHA-256 list of all seven existing data files are stored at:

```text
.tools/snapshots/20261026-140902/
```

To inspect the old source without discarding current changes, create a separate Git worktree from that snapshot branch. Extract `workspace.zip` into a separate directory if you need the old ignored data/results or built artifacts. Do not run a hard reset or extract over your current workspace. The snapshot remains local and is not part of a Pages deployment.
