# Latest unified workflow verification — 2026-10-24

Exactly three modes; built-ins load automatically and Custom Problem alone provides imports. Custom configuration restores without stale model outputs. Backend: **31 passed** (10.74s). Desktop/mobile: **14 passed** (94.29s), zero skipped/flaky/unexpected. Production build passed (18.97s). See README and frontend/test-results/results.json.

---

# Latest bonus verification — 2026-10-24

Backend: **31 passed** (6.70s). Desktop/mobile: **12 passed** (70.23s), zero skipped/flaky/unexpected; production build passed (25.56s). Both complete bonus workflows, error recovery, generic alternate-header upload and import security checks verified. See README bonus section and frontend/test-results/results.json. Source-failure recovery uses an explicitly simulated error; successful CSV/model workflows use actual sources and backend.

---

# Verification record

Date: 2026-10-24 (Asia/Taipei). Existing Windows project migrated in place; React/TypeScript/Vite, FastAPI and reusable OLS pipeline retained.

- Authentic Kaggle Human-AI Interaction version 1 acquired from the official public dataset API. CSV SHA-256: fcd567f821b7e18af8d71fec1339e4ea860c935cffdc6c79082a33793f728390.
- Actual raw data: 10,100 rows, 21 columns; 14 numerical and six categorical predictors, numerical latent_trust_score target. 4,245 missing cells, including 201 missing targets; 100 exact duplicate rows.
- Default cleaning drops 201 missing targets then 99 remaining duplicates: 9,800 labeled unique observations, 7,840 train and 1,960 test. Seed 42, k=10, scaling off. One-hot encoding produces 30 nonconstant columns; Model B selects 10 encoded columns.
- Backend: RUN_REAL_DATA=1 python -m pytest backend/tests -q: **16 passed**, 8.78 seconds. Includes both authentic local datasets, preprocessing, categorical training-only imputation/encoding, leakage prevention, independent-formula intervals, selection, API URL/upload/report behavior, source tampering, CORS and validation.
- Frontend: npm run build: **passed**, TypeScript and Vite. Plotly-inclusive main JS is about 4.92 MB uncompressed (1.49 MB gzip); initial loading can be slower on constrained connections.
- Browser: TEST_TRUST=1 npm run test:e2e: **10 passed**, 49.8 seconds across desktop Chromium and an iPhone 13 viewport. Includes trust, startup, category charts, prediction, problem switching, URL import, actual CSV upload, Markdown/HTML downloads, responsive shell and theme toggle.
- scripts/evaluate_defaults.py: both actual source datasets trained and prediction results saved in ignored data/*-verification.json. No metrics fabricated.

## Actual default Human-AI results

| Model | R2 | MAE | MSE | RMSE | Held-out 95% PI coverage |
|---|---:|---:|---:|---:|---:|
| A, all 30 encoded columns | 0.694282512 | 3.915511976 | 24.606552758 | 4.960499245 | 95.5102% |
| B, selected 10 columns | 0.695009489 | 3.911807480 | 24.548039861 | 4.954597851 | 95.4082% |

Both designs have full rank and statistical intervals enabled. Numerical median and categorical mode imputation, one-hot encoding, optional scaling and SelectKBest fit training data only. Prediction reuses the trained preprocessing. CV refits preprocessing and selection within folds. Selection acts on encoded columns, not whole categorical variables. Outputs/intervals are not clipped.

## Remaining limitations

Synthetic source data support educational association analysis, not causal or real-population conclusions. Classical intervals rely on regression assumptions and omit feature-selection uncertainty. Sessions/models remain process-local and ephemeral. No public deployment or remote CI execution is claimed. Existing dependency audit reported 3 moderate and 4 high findings; dependency upgrades were outside this dataset migration. Backend warnings include an upstream AnyIO alias deprecation and the expected test-only unseen-category encoding warning.

Data, runtime caches, browser binaries, test traces, venv, node_modules and generated reports remain ignored by source control. Run acquisition on each deployment before enabling trust data. No Kaggle credentials are embedded.


