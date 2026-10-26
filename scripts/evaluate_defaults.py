"""Write real metrics only after acquiring actual source CSVs."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.data import load_builtin, is_identifier, DATA_DIR
from backend.ml import fit_analysis, predict
from backend.main import safe

for problem in ('trust','startup'):
    try:
        df,meta=load_builtin(problem)
        target=meta['target']
        features=[c for c in df if c!=target and not is_identifier(c,df[c])]
        fitted=fit_analysis(df,target,features,k=min(10,len(features)))
        values={x['name']:x['default'] for x in fitted['result']['inputs']}
        payload={'source':meta,'analysis':fitted['result'],'default_prediction':predict(fitted,values)}
        output=DATA_DIR/f'{problem}-verification.json'
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(safe(payload),indent=2),encoding='utf-8')
        print(problem, json.dumps({m:r['metrics'] for m,r in fitted['result']['models'].items()}))
        print('Saved',output)
    except Exception as exc:
        print(problem,'NOT VERIFIED:',str(exc))
        sys.exit(1)
