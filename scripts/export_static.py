"""Export actual fitted analyses without modifying source CSVs or historical results.

Each run creates a new immutable export directory. Only static/index.json changes.
"""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import sys

import numpy as np
import pandas as pd
import scipy
from scipy.stats import t
import sklearn
import statsmodels

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.data import load_builtin, describe
from backend.main import safe
from backend.ml import fit_analysis, predict
from backend.reporting import export_report


def write_json(path, value):
    path.write_text(json.dumps(safe(value), ensure_ascii=False, allow_nan=False, separators=(',', ':')), encoding='utf-8')


def assert_equivalent(old, new, path='analysis'):
    """Compare every saved field, including all chart coordinates and diagnostics."""
    if isinstance(old, dict):
        for key, value in old.items():
            if key not in new:
                raise ValueError(f'Missing reproduced field {path}.{key}')
            assert_equivalent(value, new[key], f'{path}.{key}')
    elif isinstance(old, list):
        if len(old) != len(new):
            raise ValueError(f'Length mismatch at {path}')
        for i, (a, b) in enumerate(zip(old, new)):
            assert_equivalent(a, b, f'{path}[{i}]')
    elif isinstance(old, (int, float)) and not isinstance(old, bool):
        if new is None or not np.isclose(old, new, rtol=1e-7, atol=1e-7, equal_nan=True):
            raise ValueError(f'Reproduced value differs at {path}: {old} vs {new}')
    elif old != new:
        raise ValueError(f'Reproduced value differs at {path}: {old!r} vs {new!r}')


def export_runtime(fitted):
    prep = fitted['prep']
    numeric, categorical = [], []
    for name, pipeline, columns in prep.transformers_:
        if name == 'numeric':
            imputer = pipeline.named_steps['impute']
            scaler = pipeline.named_steps['scale']
            for i, column in enumerate(columns):
                numeric.append({'name': column, 'impute': float(imputer.statistics_[i]),
                                'mean': float(scaler.mean_[i]) if scaler != 'passthrough' else 0.,
                                'scale': float(scaler.scale_[i]) if scaler != 'passthrough' else 1.})
        elif name == 'categorical':
            imputer, encoder = pipeline.named_steps['impute'], pipeline.named_steps['encode']
            for i, column in enumerate(columns):
                categorical.append({'name': column, 'impute': str(imputer.statistics_[i]),
                                    'categories': [str(v) for v in encoder.categories_[i]],
                                    'drop_index': int(encoder.drop_idx_[i]) if encoder.drop_idx_[i] is not None else None})
    models = {}
    for name, model in fitted['models'].items():
        ols, linear = model['ols'], model['linear']
        models[name] = {'indices': np.flatnonzero(model['mask']).tolist(),
                        'intercept': float(linear.intercept_), 'coefficients': linear.coef_.tolist(),
                        'interval': {'ols_params': ols.params.tolist(), 'covariance': ols.cov_params().tolist(),
                                     'residual_variance': float(ols.scale), 'df_resid': float(ols.df_resid),
                                     't_critical': float(t.ppf(.975, ols.df_resid))} if model['intervals_valid'] else None}
    return {'features': fitted['features'], 'inputs': fitted['result']['inputs'],
            'encoded_order': prep.get_feature_names_out().tolist(),
            'numeric': numeric, 'categorical': categorical,
            'valid_indices': np.flatnonzero(fitted['valid']).tolist(), 'models': models}


def oracle(fitted, values, name):
    """Use Python's actual fitted preprocessing and statsmodels for missing-input cases."""
    clean = {k: np.nan if v is None or v == '' else v for k, v in values.items()}
    design = np.asarray(fitted['prep'].transform(pd.DataFrame([clean])), dtype=float)[:, fitted['valid']]
    model = fitted['models'][name]
    design = design[:, model['mask']]
    output = {'prediction': float(model['linear'].predict(design)[0]), 'prediction_interval': None, 'confidence_interval': None}
    if model['intervals_valid']:
        frame = model['ols'].get_prediction(np.column_stack([np.ones(len(design)), design])).summary_frame(alpha=.05).iloc[0]
        output['prediction_interval'] = [float(frame.obs_ci_lower), float(frame.obs_ci_upper)]
        output['confidence_interval'] = [float(frame.mean_ci_lower), float(frame.mean_ci_upper)]
    return output


def validation_cases(fitted, frame):
    definitions = fitted['result']['inputs']
    defaults = {x['name']: x['default'] for x in definitions}
    values = [('defaults', defaults), ('all missing', {k: None for k in defaults})]
    for i, row in frame[fitted['features']].head(15).iterrows():
        values.append((f'source row {i}', safe(row.replace({np.nan: None}).to_dict())))
    for x in definitions:
        if x['type'] == 'category':
            for category in x['options']:
                values.append((f"category {x['name']}={category}", {**defaults, x['name']: category}))
        else:
            for point in [x['min'], x['max'], x['max'] + max(1, abs(x['max'])*.1)]:
                values.append((f"numeric {x['name']}={point}", {**defaults, x['name']: point}))
    cases = []
    for label, value in values:
        for name in fitted['models']:
            expected = oracle(fitted, value, name)
            if all(v is not None and v != '' for v in value.values()):
                assert_equivalent(expected, predict(fitted, value, name), 'python-oracle')
            cases.append({'label': label, 'values': value, 'model': name, 'expected': expected})
    return cases


def export(output):
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    destination = output/'exports'/stamp
    destination.mkdir(parents=True, exist_ok=False)
    index = {'schema_version': 1, 'export_id': stamp, 'created_at': datetime.now(timezone.utc).isoformat(),
             'reference_architecture': 'https://github.com/huanchen1107/1019testDIC2', 'datasets': {}}
    verification = {'datasets': {}, 'runtime_cases': 0}
    for problem in ['startup', 'trust']:
        df, meta = load_builtin(problem)
        historical_path = ROOT/'data'/f'{problem}-verification.json'
        if not historical_path.exists() and (output/'index.json').exists():
            previous = json.loads((output/'index.json').read_text(encoding='utf-8'))
            archive = previous.get('datasets', {}).get(problem, {}).get('historical')
            if archive:
                historical_path = output/archive
        historical = json.loads(historical_path.read_text(encoding='utf-8')) if historical_path.exists() else None
        old = historical['analysis'] if historical else None
        features = old['features'] if old else [c for c in df if c != meta['target']]
        config = {'target': old['target'] if old else meta['target'], 'features': features,
                  'k': old['k'] if old else min(10, len(features)), 'test_size': old['test_size'] if old else .2,
                  'seed': old['seed'] if old else 42, 'scale': old['scale'] if old else False, 'deduplicate': True}
        if old and old['duplicates_found'] and not old['duplicates_removed']:
            config['deduplicate'] = False
        if historical and historical['source'].get('sha256') != meta.get('sha256'):
            raise ValueError(f'{problem}: historical and current source checksums differ; refusing to relabel results')
        fitted = fit_analysis(df, **config)
        reproduced = safe(fitted['result'])
        if old:
            assert_equivalent(old, reproduced)
            assert_equivalent(historical['default_prediction'], predict(fitted, {x['name']: x['default'] for x in reproduced['inputs']}))
        # Preserve all historical analysis values; add only fields absent from older schema.
        result = copy.deepcopy(old or reproduced)
        for name in result['models']:
            result['models'][name].setdefault('adjusted_r2', reproduced['models'][name]['adjusted_r2'])
        fitted['result'] = result
        folder = destination/problem
        folder.mkdir()
        provenance = {'source': meta, 'configuration': config, 'historical_result': (historical_path.relative_to(ROOT).as_posix() if historical_path.is_relative_to(ROOT) else historical_path.name) if old else None,
                      'historical_sha256': hashlib.sha256(historical_path.read_bytes()).hexdigest() if old else None,
                      'historical_fields_verified': bool(old), 'created_at': index['created_at'],
                      'versions': {'python': platform.python_version(), 'numpy': np.__version__, 'sklearn': sklearn.__version__,
                                   'scipy': scipy.__version__, 'statsmodels': statsmodels.__version__}}
        bundle = {'schema_version': 1, 'id': problem, 'dataset': {'id': problem, **describe(df, meta)},
                  'preview_rows': df.replace({np.nan: None}).to_dict(orient='records'),
                  'result': result, 'runtime': export_runtime(fitted), 'provenance': provenance}
        write_json(folder/'bundle.json', bundle)
        if historical:
            (folder/'historical-analysis.json').write_bytes(historical_path.read_bytes())
        for format, ext in [('markdown', 'md'), ('html', 'html')]:
            response = export_report({'df': df, 'meta': meta, 'artifact': fitted}, format)
            (folder/f'report.{ext}').write_bytes(response.body)
        # Independent Python oracle vectors, including real rows, missing values, categories, extrema, extrapolation.
        cases = validation_cases(fitted, df)
        # Exercise fitted standardization too, without exposing an uncomputed website setting.
        scaled_config = {**config, 'scale': True}
        scaled = fit_analysis(df, **scaled_config)
        scaled_cases = validation_cases(scaled, df)
        write_json(folder/'validation.json', {'runtime': bundle['runtime'], 'cases': cases,
                                            'scaled_runtime': export_runtime(scaled), 'scaled_cases': scaled_cases})
        count = len(cases)+len(scaled_cases)
        verification['runtime_cases'] += count
        verification['datasets'][problem] = {'historical_fields_verified': bool(old), 'prediction_cases': count,
                                             'configuration': config, 'metrics': {k: v['metrics'] for k, v in result['models'].items()}}
        index['datasets'][problem] = {'bundle': f'exports/{stamp}/{problem}/bundle.json',
                                      'report_markdown': f'exports/{stamp}/{problem}/report.md',
                                      'report_html': f'exports/{stamp}/{problem}/report.html',
                                      'validation': f'exports/{stamp}/{problem}/validation.json',
                                      'historical': f'exports/{stamp}/{problem}/historical-analysis.json' if old else None}
        print(problem, 'historical fields verified:', bool(old), 'Python oracle cases:', count)
    write_json(destination/'verification.json', verification)
    write_json(output/'index.json', index)
    print('Export:', destination, 'Validation cases:', verification['runtime_cases'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'frontend'/'public'/'static')
    export(parser.parse_args().output.resolve())
