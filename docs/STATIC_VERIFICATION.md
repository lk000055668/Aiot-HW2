# Static-mode verification — 2026-10-26

**Browser CSV training has since been added:** see [the current browser-analysis guide](BROWSER_CSV.md) for its independent numerical checks and updated functionality. The preserved-export baseline checks below remain valid.

No commit, push, GitHub Actions invocation, or public Pages deployment was performed for this change. A local snapshot branch was created before editing.

| Check | Result |
| --- | --- |
| Initial Git working tree | Clean; base commit `90a3c17` |
| Restore snapshot | `snapshot/pre-static-20261026-140902`; bundle and workspace ZIP in `.tools/snapshots/20261026-140902/` |
| Existing data/source/result files | All seven SHA-256 checksums unchanged |
| Historical analyses | Every existing field preserved; only previously missing adjusted training R-squared added |
| Actual datasets | 50-Startups and acquired Human-AI version 1 |
| Export ID | `20261026T061127008579Z` |
| JavaScript vs Python oracle | 440 cases passed; maximum absolute difference `2.9103830456733704e-11` |
| Comparison scope | Points, 95% mean confidence intervals, 95% observation prediction intervals, imputation, categories, scaling, column order and both models |
| Invalid/unavailable cases | Unknown model/category, invalid numerical input, missing feature keys rejected; unavailable intervals stay null |
| Fresh-clone-style export | Historical archives reused successfully without the ignored local result JSON files |
| TypeScript compilation | Passed |
| Static production build | Passed; separate `frontend/dist-static/` |
| Full-mode production build | Passed; verified in `.tools/full-mode-build-static-migration/` to preserve existing build output |
| Static desktop/mobile browser suite | 2 passed; actual chart zoom, dataset/model switching, fixed controls, predictions, pagination, reports and sticky selector verified |
| Static network isolation | No backend, external-origin, or out-of-base-path requests; forbidden requests were blocked and asserted absent |
| GitHub Pages subpath | Tested at `/Aiot-HW2/` using the built static preview |
| Existing backend tests | 30 passed, 1 skipped; two dependency warnings |
| Local full-mode browser smoke | Actual API training, prediction, CSV upload, target change and retraining passed on isolated ports 8001/5180 |

The opt-in backend real-data test was deliberately skipped because it writes `data/verification-results.json`. Actual-data coverage instead used the exporter's full historical reproduction check, the 440 cross-language references and both browser workflows, without changing existing saved results.

The full legacy browser suite was not claimed to pass; its older UI selectors remain as documented in README. The new static suite has a separate configuration and does not require FastAPI. Tests ran with installed Chrome; the manual GitHub workflow is configured to install Chromium.

The existing backend and its fitted sessions were left intact. Verification of local uploads/training used isolated services, which were stopped afterward. A local static preview is available on port 4173 while its process remains running; this is not public hosting.

## Saved metrics (unchanged)

| Dataset | Model | Held-out R-squared | MAE | MSE | RMSE |
| --- | --- | ---: | ---: | ---: | ---: |
| 50-Startups | A: all features | 0.896736253 | 7124.244801 | 83622164.028485 | 9144.515516 |
| 50-Startups | B: k=4 | 0.914692193 | 6521.804512 | 69081585.529144 | 8311.533284 |
| Human-AI | A: all features | 0.694282512 | 3.915512 | 24.606553 | 4.960499 |
| Human-AI | B: k=10 | 0.695009489 | 3.911807 | 24.548040 | 4.954598 |

Exact full-precision values and all chart data remain in the versioned JSON; the table is a rounded display. See [static-mode guide](STATIC_MODE.md) for commands, mathematics, source provenance and the manual publication procedure.
