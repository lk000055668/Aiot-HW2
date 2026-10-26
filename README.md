# Human–AI Trust Prediction Lab

An independent AIoT HW2 application for **Multiple Linear Regression**, feature selection, OLS prediction intervals, and the six stages of CRISP-DM. React/TypeScript/Vite, Tailwind, a shadcn-style Radix/CVA button, Lucide, and Plotly on the frontend; FastAPI, pandas, NumPy, scikit-learn, statsmodels and SciPy on the backend.

## Current verification status

The primary dataset is the authentic Kaggle Human–AI Interaction version 1: 10,100 rows, 20 predictors (14 numerical, six categorical), and numerical `latent_trust_score`. It is **synthetic educational data**, not a real-user survey. Verified raw CSV: 100 duplicate rows, 4,245 missing cells including 201 missing targets. Target observations range from 38.374385 to 100 (documented scale 0–100). See `data/README.md` for provenance and `VERIFICATION.md` for actual checks.

Research objective: predict human trust in AI and explore associations with human experience, model accuracy, explainability, bias, interaction quality, and task context. No causal or real-population claims are supported.

## Start locally

Prerequisites: Python **3.12**, Node **22 LTS**, internet access for dependencies and public CSV import. Memory requirements depend on imported CSV size and encoded design width. First install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
python scripts/acquire_data.py
```

The acquisition script downloads version 1 through the official public Kaggle dataset API; no account credentials are required for this public dataset. If unavailable, it fails without substituting records. See [data/README.md](data/README.md). Startup and custom CSV imports remain available.

Terminal 1, from the root:

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Terminal 2:

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. API docs: **http://localhost:8000/docs**. Built-in problems load automatically; click **Start Analysis**. For Custom Problem, import a CSV and choose its target/features first. The first run uses an 80/20 split and seed 42. Predictions and reports use the last successfully fitted configuration; changed controls apply on the next run.

The `.env.example` documents configuration. For nondefault frontend URLs create `frontend/.env.local` with `VITE_API_URL=https://your-backend.example`. Export backend settings as process environment variables, or use uvicorn's `--env-file .env` after copying the root example. Never expose Kaggle secrets in frontend variables. CORS origins are comma-separated exact frontend origins without trailing slashes. VS Code extension recommendations are in `.vscode/extensions.json`; extensions do not replace the Python and Node runtimes.

## Unified Problem Selection

The dashboard has exactly three choices: Problem 1 — Human–AI Trust Prediction; Problem 2 — Startup Profit Prediction; Custom Problem — Upload Your Dataset. There is no Dataset Source selector.

Human–AI loads automatically on opening. Selecting a built-in automatically loads its fixed numerical target and relevant predictors, shows a Preconfigured Dataset summary, and offers Start Analysis. No manual import or target selection is needed.

Only Custom Problem displays CSV URL and Upload CSV File buttons. Import a public HTTPS CSV or UTF-8 local file, inspect preview and detected types, choose a numerical target and configure predictors/k. The existing shared pipeline handles preprocessing, selection, both OLS models, evaluation, charts, intervals, predictions and reports. Both academic bonus features remain supported.

Leaving Custom Problem saves its dataset session, target, predictors, k, split, seed, scaling, deduplication, URL, file and import method in page memory. Returning restores configuration, checks the session, clears old model outputs and requires a fresh analysis. Changing import method keeps existing data/settings. Failed replacement imports preserve prior data and settings. Successful explicit replacements configure the new schema. Refreshing the page clears drafts. Expired sessions retain import choices but require reimport.

### Demonstration and verification

Open the app, wait for the automatic built-in summary, and click Start Analysis. Switch to Startup and repeat. Choose Custom Problem and CSV URL, paste the professor-provided Startup URL, Load Dataset, select Profit and configure features/k, then Start Analysis. Inspect Evaluation, Prediction and CRISP-DM Report. Upload CSV File uses the same workflow.

Run npm run test:e2e with TEST_TRUST=1 after starting the backend/frontend; npm run build verifies production assets. Run backend pytest with RUN_REAL_DATA=1. Browser tests cover desktop Chromium and iPhone 13 viewport using actual sources/models; only the explicitly marked source-failure scenario simulates an HTTP error. TEST_PORT, TEST_API_URL and TEST_EXTERNAL_SERVER support isolated servers. Generic validation and all secure URL/download limits remain unchanged.

## Working features

- Eight navigable research views, responsive layouts, light/dark theme, and explicit busy/error states.
- Human–AI Trust and Startup problem dropdown resets dataset, target, fitted result, charts and prediction state; both use the same backend ML functions.
- Public HTTPS CSV ingestion and local upload with preview, type detection, numerical target and predictor selection.
- Paginated data table, full numerical summaries/correlations (up to 40 columns in the heatmap), missingness, duplicates, sampled distributions and feature/target plots.
- Training-only median/mode imputation, drop-first categorical encoding, optional scaling, constant-column removal, seeded split, optional exact duplicate removal and identifier exclusion.
- Model A: all encoded nonconstant predictors. Model B: training-only SelectKBest/f_regression with configurable k. Three-fold training-only CV (up to 20,000 training rows) refits preprocessing and selection per fold; k is a user configuration, not optimized on the test set.
- sklearn LinearRegression matched against statsmodels OLS; intercept/coefficient table and chart, sampled training VIF, condition number, Breusch–Pagan diagnostic, residual and Q-Q plots.
- Full held-out R², MAE, MSE, RMSE, actual/predicted plots, unclipped classical 95% prediction and mean confidence intervals, all-test interval coverage and average width. Charts alone are sampled.
- Dynamic numerical/categorical prediction inputs initialized from training data, extrapolation notices and explicit OLS bounds warnings.
- Dataset-specific six-stage CRISP-DM report with source, checksum, settings, metrics, methodology, limitations and exportable JSON figure data. Plotly toolbars export each figure as PNG.

## Statistical interpretation

The prediction equation is `ŷ = intercept + Σ coefficient_j × encoded_input_j`. Scaling changes coefficient units. Coefficient magnitude and univariate F scores are not scientifically justified causal importance. Category effects are relative to a dropped reference category.

Prediction intervals use the **same fitted design**, estimated residual variance and residual degrees of freedom through statsmodels `get_prediction(...).summary_frame(alpha=0.05)`. Mean confidence intervals describe uncertainty about the conditional mean; prediction intervals additionally include new-observation variation. Singular designs still support point estimates but disable statistical intervals.

Classical interval validity depends on linearity, independence, homoskedasticity and approximately normal errors. Diagnostics expose evidence; they cannot guarantee these conditions. Selected-model intervals condition on the selected design and omit selection uncertainty. Feature selection can worsen accuracy. Do not repeatedly tune k using displayed held-out test results. OLS trust predictions and intervals can extend beyond the documented [0,100] scale; neither is clipped. Synthetic data do not establish how real users behave. Categorical coefficients compare with omitted training reference levels; selection operates on encoded columns.

## Tests and actual-data verification

After dataset acquisition, set `$env:RUN_REAL_DATA='1'` to enable the real-data Python acceptance test, and `$env:TEST_TRUST='1'` to enable the trust browser workflow. Without these opt-ins those checks skip; startup browser checks still use real data. `GET /api/datasets/{id}/report?format=html` exports a self-contained report with SVG figures.

```powershell
python -m pytest backend/tests -q
python scripts/evaluate_defaults.py
cd frontend
npm run build
npx playwright install chromium
npm run test:e2e
```

Keep the backend running for browser tests. Playwright launches the Vite frontend itself. Tests target desktop Chrome and a mobile viewport, using actual startup CSV data through the real backend, and exercise URL import, dynamic targets, metrics, prediction and problem switching. Backend tests use deterministic, explicitly test-only fixtures for ingestion, security, splitting, imputation leakage, feature selection, OLS, independent-formula intervals, categorical prediction, dataset provenance and checksum tampering, API behavior and errors. The trust browser workflow skips unless TEST_TRUST is enabled; run acquisition before enabling it. `evaluate_defaults.py` saves actual metrics and predictions in ignored `data/*-verification.json` files and fails explicitly when data are unavailable. CI runs unit, build and browser checks on a network-enabled GitHub runner.

After the first successful `npm install`, commit its generated `frontend/package-lock.json` and use `npm ci` for subsequent reproducible installs. Top-level frontend dependencies are pinned and the resolved lockfile is now available.

## Deployment

### Frontend: Vercel

Push this repository to your GitHub account. In Vercel import it with root directory **frontend**, framework **Vite**, build **npm run build**, output **dist**. Set `VITE_API_URL` to the deployed backend HTTPS origin, then deploy. Set backend `CORS_ORIGINS` to the exact Vercel origin, including any approved preview origins. Changing a Vite variable requires rebuilding.

### Backend: Docker on Railway or another Python container host

Build `Dockerfile` from the repository root. Use a single instance / **one uvicorn worker** with memory sized for the imported data. Set `PORT` as required by the host, `CORS_ORIGINS`, and `DATA_DIR=/app/data`. Attach a persistent volume at `/app/data`. Run `python scripts/acquire_data.py` in the container after the volume is mounted. Verify the generated source manifest and license rights before enabling public access. Dataset files and credentials are intentionally excluded from the Docker build and Git.

Set health check `/api/health`. HTTPS termination and request body limits belong at the host/reverse proxy. Configure a maximum request body of **151 MB**, rate limits, a 60-second upload timeout, and restrict public access as appropriate. App limits include 150 MB CSVs (configurable up to 200), public-only DNS checks pinned through TLS connections, redirect revalidation, download timeouts, row/column/category/design limits, one concurrent training job, bounded dataset sessions, and two-hour session expiry.

Models/datasets are process-local capability sessions addressed by random UUIDs. They are not an account/authentication system. A restart loses fitted models; reload and retrain. Do not scale workers or replicas without moving session/model state and jobs to shared durable storage/queue. For an internet-wide multi-user production service, add authentication, per-user quotas and an isolated job service; the included bounded single-instance design targets a classroom/research deployment. Do not upload sensitive datasets to a shared public instance.

Verify health, Human–AI loading, both model metrics and interval plots, startup switching, URL import, upload and prediction on the deployed origins before claiming deployment is complete. No hosting credentials were supplied and no deployment was attempted here.

### Render alternative

The root `render.yaml` configures a Docker backend with a persistent data disk. Select a service size with enough memory for your acquired CSV and confirm pricing in your hosting account before creating it. Run the acquisition command after the disk is mounted; configure `CORS_ORIGINS` with your Vercel URL. Hosting configuration references: [Render Blueprint specification](https://render.com/docs/blueprint-spec) and [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite). These files prepare deployment; they do not establish that one exists.

## GitHub setup

After installing Git and checking that no credentials or datasets are staged:

```powershell
git init
git add .
git status
git commit -m "Build Human–AI Trust Prediction Lab"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Create the empty GitHub repository under your account first. Never force-add ignored data or Kaggle credentials. The included CI runs the automated checks after pushing; its outcome has not been verified here.

## Repository layout

`backend/data.py`: safe ingestion/provenance; `backend/ml.py`: reusable ML/statistics; `backend/main.py`: FastAPI sessions/jobs/reporting; `frontend/src/main.tsx`: research dashboard; `scripts/acquire_data.py`: official public dataset acquisition; `backend/tests` and `frontend/tests`: verification. [data/README.md](data/README.md) details attribution and access. [VERIFICATION.md](VERIFICATION.md) records unresolved checks.

