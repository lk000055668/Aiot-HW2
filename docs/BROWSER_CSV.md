# CSV analysis on GitHub Pages

**Upload by User now trains real regression models inside the browser.** It requires no Python backend, account, API, external CDN or always-running server. The two built-in analyses remain unchanged archived results.

![Actual uploaded CSV results trained in the browser](screenshots/browser-csv-results.png)

## Teacher demonstration

1. Open the static site and select **Upload by User**.
2. Choose a UTF-8 CSV and click **Load Dataset**. The file is read locally; it is not uploaded to a server.
3. Inspect the preview, choose a numerical target and select predictors.
4. Optionally change the train/test fraction, seed, selected encoded-feature count `k`, deduplication or numerical standardization in **Data Preparation**.
5. Click **Run Analysis**. A Web Worker performs actual training while the interface displays progress.
6. Read R-squared, adjusted training R-squared, MAE, MSE, RMSE, coefficients, feature rankings, comparison of Model A/B, actual/predicted and residual charts, Q-Q and interval plots.
7. In **Prediction**, enter a new observation. Blank inputs use the fitted training medians/modes. Point estimates and classical 95% confidence/prediction intervals use the actual fitted model.
8. Download the Markdown or HTML CRISP-DM report. It records the source-file SHA-256, settings, split indices, preprocessing, coefficients, diagnostics and chart values.

Changing configuration takes effect on the next **Run Analysis**. Switching to another problem clears visible fitted outputs; returning to a custom dataset restores its configuration and requires a fresh run. Failed replacement imports preserve the prior dataset. Refreshing the page releases browser datasets/models.

## Browser limits

| Limit | Browser CSV mode |
| --- | --- |
| File format | UTF-8 comma-separated CSV with unique, nonempty headers |
| File size | 10 MB |
| Rows | 12–20,000, plus sufficient labeled training observations for the encoded design |
| Raw columns | 2–40 |
| Encoded predictors | At most 60 |
| Raw or encoded cells | At most 1,000,000 |
| Categorical levels | At most 30 per predictor |
| Target | Numerical and nonconstant; at least 12 labeled observations |
| Remote CSV URL import | Available in local full mode; static mode uses local files |

Large datasets remain supported by the original Python full mode within its separate documented limits. These browser limits bound memory and numerical work rather than pretending every arbitrary file can be analyzed.

## Actual statistical pipeline

The worker uses bundled Papa Parse, ml-matrix SVD and jStat. It removes missing targets, optionally removes exact duplicates over the chosen predictor/target columns, and produces a seeded train/test split. Numerical medians, categorical modes, drop-first encoding, optional numerical standardization, constant-column removal and F-regression feature selection are fitted **only on training rows**. Model A retains all nonconstant encoded predictors; Model B retains the top `k` training F scores.

Three-fold training-only CV refits preprocessing and feature selection within each fold. OLS is solved through singular value decomposition rather than normal-equation inversion. Residual variance, parameter covariance, residual degrees of freedom and Student-t quantiles produce classical intervals. Rank-deficient fits retain point predictions but disable intervals; coefficient representations are not uniquely identified in those designs. VIF, condition number, Breusch-Pagan and residual Q-Q diagnostics are calculated from actual model data when available.

The browser uses **Mulberry32 + Fisher-Yates** for reproducible shuffling. It is intentionally labeled separately from NumPy's random split: the same seed does not imply the same Python and browser train/test rows. Reports include the actual source-row indices, so comparisons use identical observations. Cross-language verification explicitly applies those indices in sklearn/statsmodels.

Intervals assume a suitable linear model, independent errors, constant variance and approximate residual normality. Feature-selection uncertainty is omitted. No prediction is clipped, and no causal interpretation is implied. R-squared follows sklearn's finite 0/1 convention when a test partition has a constant target; a constant training target is rejected.

## Verification

Latest local verification on 2026-10-26: **4 desktop/mobile browser tests passed**, both static and full-mode production builds passed, and all seven original data/result files retained their SHA-256 checksums. No commit, push or public deployment was performed. A restore archive of all pending pre-upload changes is retained at `.tools/snapshots/pre-browser-training-20261026-143958/`.

```powershell
cd frontend
npm run verify:static
npm run verify:browser
npm run build:static
npm run test:static
```

`verify:static` preserves the original 440 exported-model prediction/interval checks. `verify:browser` trains **seven** actual-data cases and checks **3,390** numerical values against committed independent Python references. Cases cover 50-Startups, an alternative target, feature selection, scaled/unscaled fitting, missing values, duplicates, redundant predictors, and 400 authentic Human-AI rows. Test-only modifications never alter the source datasets or built-in exports. Additional checks reject malformed CSVs, duplicate headers and invalid inputs; verify deterministic splits; and verify HTML escaping of user-provided names.

To regenerate the Python references from the root after deliberately changing the numerical engine:

```powershell
node frontend/scripts/verify-browser.mjs --output .tools/browser-fit-validation.json
.\.venv\Scripts\python.exe scripts/verify_browser_training.py .tools/browser-fit-validation.json
node frontend/scripts/verify-browser.mjs
```

The Python script independently checks sklearn coefficients/selection, held-out metrics, CV, adjusted R-squared, statsmodels intervals, VIF, Breusch-Pagan and SciPy Q-Q quantiles. Comparisons use recorded identical splits, including training-only preprocessing inside each CV fold. The tolerance accounts for JavaScript/Python floating-point differences; the measured maximum relative difference in the committed comparisons is approximately `3.69e-8`.

The static Playwright suite includes desktop and mobile upload-to-results-to-prediction/report workflows and a changed-target/scaling/seed/k retraining workflow. It blocks backend and external-origin requests. All numerical libraries and worker code are built into the static site under the configured repository base path.

The manual Pages workflow validates both preserved exports and browser training before publication. It still defaults to **no publication** unless `publish` is explicitly checked. This implementation itself does not push or publish the site.
