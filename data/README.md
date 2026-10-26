# Dataset provenance and acquisition

## Human–AI Interaction (primary)

Source supplied by the user: https://www.kaggle.com/dsv/13207192
Canonical dataset: https://www.kaggle.com/datasets/eshaalnmalik/human-ai-interaction/versions/1
Author: Eshaal Malik. Version: 1. File: `Human-AI Interaction.csv`.
The data card explicitly identifies the records as synthetic, without real personal data, for research and education; it lists CC0: Public Domain. These are authentic downloaded source records, not application-generated placeholders.

Run `python scripts/acquire_data.py`. The public official Kaggle API downloads the pinned version, validates schema and target, then writes ignored `human-ai-interaction.csv` and `trust-source.json`. The manifest includes checksum, rows, columns, types, missingness, duplicates, source and license. The loader checks version and checksum on every load. Download/schema failures do not substitute data or fall back to a different dataset.

Verified CSV: 10,100 rows, 21 columns, 20 original predictors, 100 exact duplicate rows. There are 4,245 missing cells, including 201 missing targets. Numerical columns: 15 including the target. Six categorical predictors: education_level, prior_ai_exposure, ui_complexity, task_risk, domain, cultural_factor.

Target: `latent_trust_score`, float, documented 0–100; observed nonmissing range 38.374385–100. Some feature values may differ from illustrative data-card ranges; observed training ranges drive prediction inputs, without clipping or silently correcting source values.

Human factors: age, education_level, technical_experience, cognitive_load, prior_ai_exposure.
AI factors: model_accuracy, explainability_score, bias_level, decision_latency, error_rate.
Interaction factors: interaction_frequency, ui_complexity, feedback_quality, trust_history, override_frequency.
Context: task_risk, domain, time_pressure, cultural_factor, regulatory_strictness.

Training removes missing targets and, by default, exact predictor/target duplicates before splitting. Numerical median and categorical mode imputation, drop-first one-hot encoding, optional scaling and feature selection fit training data only. Interactive predictions reuse the fitted pipeline. Interpret associations, not causal effects or real-population differences.

## Startup Profit (secondary)

https://raw.githubusercontent.com/Avik-Jain/100-Days-Of-ML-Code/master/datasets/50_Startups.csv
Source repository: Avik Jain's 100 Days of ML Code. 50 rows, five columns; target Profit; State is categorical. The loader uses the local cached CSV or downloads that exact public HTTPS source. Preserve attribution and verify source rights before redistribution.

## Custom CSVs

Direct public HTTPS CSV URLs and UTF-8 uploads remain supported. Select a numerical target and exclude identifiers and target-derived columns. Limits: 150 MB default (200 MB cap), 12–1,500,000 rows, 2–100 columns, 30 category levels per predictor, 100 encoded columns, 30 million design cells. High-cardinality strings are rejected. No fake records are generated.
