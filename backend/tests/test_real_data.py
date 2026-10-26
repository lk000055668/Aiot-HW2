"""Opt-in acceptance test; writes actual metrics only, no expected R² threshold."""
import json
import os
from pathlib import Path
import pytest
from backend.data import load_builtin, is_identifier
from backend.ml import fit_analysis, predict
from backend.main import safe

@pytest.mark.skipif(os.getenv('RUN_REAL_DATA')!='1',reason='Requires acquired real datasets.')
def test_real_primary_and_secondary():
    outputs={}
    for problem in ('trust','startup'):
        df,meta=load_builtin(problem)
        target=meta['target']
        features=[c for c in df if c!=target and not is_identifier(c,df[c])]
        if problem=='trust':
            assert len(df)==10100 and len(features)==20 and target=='latent_trust_score'
            assert len(df.select_dtypes(exclude='number').columns)==6
        fitted=fit_analysis(df,target,features,k=min(8,len(features)))
        pred=predict(fitted,{f['name']:f['default'] for f in fitted['result']['inputs']})
        assert pred['prediction_interval'][0]<pred['prediction_interval'][1]
        outputs[problem]={'source':meta['source'],'rows':len(df),'models':{m:fitted['result']['models'][m]['metrics'] for m in ('all','selected')},'prediction':pred}
    Path('data/verification-results.json').write_text(json.dumps(safe(outputs),indent=2),encoding='utf-8')
