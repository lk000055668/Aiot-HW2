"""Reports are generated from completed model output, never illustrative metrics."""
import json
import html
import math
from fastapi.responses import Response

def svg_scatter(model, kind):
    sample=model['sample']
    x=sample['predicted'] if kind!='actual' else sample['actual']
    y=sample['residual'] if kind=='residual' else sample['predicted'] if kind=='actual' else sample['actual']
    bounds=y+sample.get('obs_ci_lower',[])+sample.get('obs_ci_upper',[]) if kind=='interval' else y
    xmin,xmax=min(x),max(x)
    ymin,ymax=min(bounds),max(bounds)
    sx=lambda v:55+610*(v-xmin)/(xmax-xmin or 1)
    sy=lambda v:280-240*(v-ymin)/(ymax-ymin or 1)
    titles={'actual':'Actual vs. predicted','residual':'Residual vs. predicted','interval':'95% prediction intervals and held-out observations'}
    title=titles[kind]
    shapes=[]
    for i,(a,b) in enumerate(zip(x,y)):
        if kind=='interval' and 'obs_ci_lower' in sample:
            shapes.append(f'<line x1="{sx(a):.2f}" y1="{sy(sample["obs_ci_lower"][i]):.2f}" x2="{sx(a):.2f}" y2="{sy(sample["obs_ci_upper"][i]):.2f}" stroke="#0e99a0" stroke-opacity=".2"/>')
        shapes.append(f'<circle cx="{sx(a):.2f}" cy="{sy(b):.2f}" r="2.5" fill="#087e8b" fill-opacity=".55"/>')
    return '<figure><figcaption>'+title+'</figcaption><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 710 335" role="img" aria-label="'+title+'"><path d="M55 35V280H675" fill="none" stroke="#78939c"/>'+''.join(shapes)+f'<text x="55" y="303" font-size="11">x: {xmin:.5g} to {xmax:.5g}; y: {ymin:.5g} to {ymax:.5g} · sampled observations</text></svg></figure>'

def export_report(ds, format='markdown'):
    from .main import safe
    if format not in ('markdown','html'):
        raise ValueError('Report format must be markdown or html.')
    r=ds['artifact']['result']
    meta=ds['meta']
    trust=r['target']=='latent_trust_score'
    lines=['# Human–AI Trust Prediction Lab — CRISP-DM Report','',
        '## 1. Business Understanding',f'Estimate {r["target"]} using {len(r["features"])} predictors and Multiple Linear Regression. '+('Study factors associated with human trust in AI. This dataset is synthetic; associations do not establish causation or real user behavior.' if trust else 'Educational regression analysis; associations do not establish causation.'),'',
        '## 2. Data Understanding',f'Dataset: {meta["name"]}. Source: {meta["source"]}.',f'Observed rows: {len(ds["df"]):,}; columns: {len(ds["df"].columns)}; duplicate rows: {int(ds["df"].duplicated().sum())}.',f'SHA-256: {meta.get("sha256","not recorded")}.',f'Missing values: {json.dumps(ds["df"].isna().sum().to_dict())}.','',
        '## 3. Data Preparation',r['methodology'],f'Train {r["train_count"]:,}; test {r["test_count"]:,}; seed {r["seed"]}; scaling {r["scale"]}. Duplicates removed {r["duplicates_removed"]}; missing targets removed {r["removed_missing_targets"]}.','',
        '## 4. Modeling',f'OLS via sklearn LinearRegression and matched statsmodels OLS. Model A uses all nonconstant encoded columns; Model B uses k={r["k"]} training-selected encoded columns.', 'Raw predictors: '+', '.join(r['features'])+'.','',
        '## 5. Evaluation','| Model | R² | MAE | MSE | RMSE | PI coverage |','|---|---:|---:|---:|---:|---:|']
    for label,model in r['models'].items():
        m=model['metrics']
        lines.append(f'| {label} | {m["r2"]:.6g} | {m["mae"]:.6g} | {m["mse"]:.6g} | {m["rmse"]:.6g} | {model["coverage"] if model["coverage"] is not None else "unavailable"} |')
    lines += ['', 'Metrics evaluate every held-out row. Dashboard figures alone are sampled.',
        'R² measures squared-error fit relative to a constant-mean reference; MAE is average absolute error, MSE average squared error, and RMSE is in target units.',
        r['interval_caveat'],'A confidence interval estimates the conditional mean; a prediction interval includes additional individual-observation noise.',
        'Coefficients depend on units and multicollinearity and are not causal importance. Inspect residuals, Q-Q plots, sampled VIF, condition number and Breusch–Pagan diagnostics. Independence depends on data collection. Diagnostics cannot guarantee assumptions hold.','',
        '## 6. Deployment','Vite/React frontend and FastAPI backend support reproducible interactive analysis, prediction, CSV import and report export. Sessions/models are ephemeral. No public deployment is asserted.','',
        '## Conclusion']
    a,b=r['models']['all']['metrics']['rmse'],r['models']['selected']['metrics']['rmse']
    lines.append(f'Selected-feature RMSE is {b:.6g}, compared with {a:.6g} for all features. Selection {"reduced" if b<a else "did not reduce"} held-out RMSE. Do not tune k using this held-out comparison.')
    lines += ['', '## Figures and reproducibility data','The dashboard renders actual/predicted, residual, residual distribution, Q-Q, interval and coefficient figures from these exact data. Save PNGs from Plotly toolbars for a submitted illustrated report.','```json',json.dumps(safe(r),ensure_ascii=False,indent=2),'```']
    text='\n'.join(lines)
    if format=='html':
        figures=''.join('<h2>Model '+label+'</h2>'+''.join(svg_scatter(model,kind) for kind in ('actual','residual','interval')) for label,model in r['models'].items())
        text='<!doctype html><html lang="en"><meta charset="UTF-8"><title>CRISP-DM Report</title><style>body{font:15px/1.7 system-ui;max-width:1000px;margin:40px auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}figure{break-inside:avoid}svg{width:100%}</style>'+figures+'<pre>'+html.escape(text)+'</pre></html>'
    ext='html' if format=='html' else 'md'
    return Response(text,media_type='text/html' if format=='html' else 'text/markdown',headers={'Content-Disposition':f'attachment; filename="crisp-dm-report.{ext}"'})
