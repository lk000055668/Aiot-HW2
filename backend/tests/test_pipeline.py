"""Synthetic fixtures test numerical properties; they are never served as app data."""
import time
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from backend import data, main
from backend.data import parse_csv, load_builtin, fetch_csv, TRUST_FEATURES
from backend.ml import fit_analysis, predict
from scripts.acquire_data import acquire

def test_exact_metrics():
    from backend.ml import metrics
    assert metrics(np.array([1,2,3]),np.array([1,2,4]))==pytest.approx({'r2':.5,'mae':1/3,'mse':1/3,'rmse':np.sqrt(1/3)})

def test_mixed_public_private_dns_rejected(monkeypatch):
    monkeypatch.setattr(data.socket,'getaddrinfo',lambda *a,**k:[(2,1,6,'',(ip,443)) for ip in ['8.8.8.8','10.0.0.1']])
    with pytest.raises(ValueError,match='public'):data.public_addresses('example.org')

def test_nonfinite_and_extrapolation(frame):
    fitted=fit_analysis(frame,'target',['rain'],k=1)
    p=predict(fitted,{'rain':100})
    assert p['prediction']>1 and p['extrapolated_features']==['rain']
    with pytest.raises(ValueError):predict(fitted,{'rain':float('inf')})

@pytest.fixture
def frame():
    rng=np.random.default_rng(42)
    x=rng.normal(size=(200,4))
    df=pd.DataFrame(x,columns=['rain','drainage','density','noise'])
    df['state']=np.where(x[:,2]>0,'north','south')
    df['target']=2+3*x[:,0]-2*x[:,1]+rng.normal(0,.2,200)
    return df

def test_csv_schema_and_errors(frame):
    result=parse_csv(frame.to_csv(index=False).encode())
    assert len(result)==200 and result.state.dtype=='object'
    for raw in (b'',b'a,b\n1,2',b'<html>not a CSV</html>'):
        with pytest.raises(ValueError):parse_csv(raw)

def test_ols_metrics_intervals_and_dynamic_prediction(frame):
    frame.loc[0,'rain']=np.nan
    fitted=fit_analysis(frame,'target',['rain','drainage','density','noise','state'],k=2,scale=True)
    r=fitted['result']
    assert r['train_count']==160 and r['test_count']==40
    assert len(r['models']['selected']['coefficients'])==2
    for label,m in r['models'].items():
        p=m['sample']; y=np.array(p['actual']); yh=np.array(p['predicted'])
        assert m['metrics']['mse']==pytest.approx(np.mean((y-yh)**2))
        assert m['metrics']['r2']>.9
        assert m['intervals_valid']
        assert all(lo<=mlo<=mhi<=hi for lo,mlo,mhi,hi in zip(p['obs_ci_lower'],p['mean_ci_lower'],p['mean_ci_upper'],p['obs_ci_upper']))
    values={v['name']:v['default'] for v in r['inputs']}
    p=predict(fitted,values)
    assert p['prediction_interval'][0]<p['prediction']<p['prediction_interval'][1]
    with pytest.raises(ValueError):predict(fitted,{'rain':0})

def test_no_preprocessing_leakage(frame):
    from sklearn.model_selection import train_test_split
    train,test=train_test_split(frame,test_size=.2,random_state=42)
    frame.loc[test.index,'rain']=1e9
    fitted=fit_analysis(frame,'target',['rain','drainage'],k=1)
    assert fitted['result']['inputs'][0]['max']==pytest.approx(train.rain.max())
    imputer=fitted['prep'].named_transformers_['numeric'].named_steps['impute']
    assert imputer.statistics_[0]==pytest.approx(train.rain.median())

def test_prediction_interval_matches_independent_student_t_formula(frame):
    from scipy.stats import t
    fitted=fit_analysis(frame,'target',['rain','drainage'],k=2)
    values={i['name']:i['default'] for i in fitted['result']['inputs']}
    output=predict(fitted,values,'all')
    model=fitted['models']['all']
    x=fitted['prep'].transform(pd.DataFrame([values]))[:,fitted['valid']][:,model['mask']]
    x0=np.concatenate(([1.],x[0]))
    design=model['ols'].model.exog
    beta=np.linalg.lstsq(design,model['ols'].model.endog,rcond=None)[0]
    residual=model['ols'].model.endog-design@beta
    dof=len(design)-design.shape[1]
    variance=residual@residual/dof
    half=t.ppf(.975,dof)*np.sqrt(variance*(1+x0@np.linalg.inv(design.T@design)@x0))
    center=x0@beta
    assert output['prediction_interval']==pytest.approx([center-half,center+half])

def test_validation_and_rank_deficiency(frame):
    frame['id']=np.arange(len(frame))
    for target,cols in [('state',['rain']),('target',['target']),('target',['id'])]:
        with pytest.raises(ValueError):fit_analysis(frame,target,cols)
    frame['copy']=frame.rain
    r=fit_analysis(frame,'target',['rain','copy'],k=1)['result']
    assert not r['models']['all']['intervals_valid']

def test_missing_targets_duplicates_and_selection(frame):
    frame.loc[0,'target']=np.nan
    frame=pd.concat([frame,frame.iloc[[1]]],ignore_index=True)
    r=fit_analysis(frame,'target',['rain','drainage','noise'],k=2)['result']
    assert r['removed_missing_targets']==1 and r['duplicates_removed']==1
    assert sum(v['selected'] for v in r['rankings'])==2

def test_ssrf_and_unsafe_url(monkeypatch):
    for url in ['http://example.com/a.csv','file:///etc/passwd','https://user:pass@example.com/a.csv','https://example.com:8080/a.csv']:
        with pytest.raises(ValueError):fetch_csv(url)
    monkeypatch.setattr(data.socket,'getaddrinfo',lambda *a,**k:[(2,1,6,'',('127.0.0.1',443))])
    with pytest.raises(ValueError,match='public'):fetch_csv('https://example.com/a.csv')

def test_acquired_dataset_provenance_and_tamper_detection(tmp_path,monkeypatch):
    import io, zipfile
    from backend.data import TRUST_DATASET
    df=pd.DataFrame({c:np.arange(30)%12 for c in TRUST_FEATURES})
    df['latent_trust_score']=np.linspace(20,90,30)
    buf=io.BytesIO()
    with zipfile.ZipFile(buf,'w') as z:z.writestr('Human-AI Interaction.csv',df.to_csv(index=False))
    meta=acquire(tmp_path,archive_bytes=buf.getvalue())
    assert meta['dataset']==TRUST_DATASET and meta['rows']==30 and meta['synthetic']
    monkeypatch.setattr(data,'DATA_DIR',tmp_path)
    loaded,info=load_builtin('trust')
    assert info['target']=='latent_trust_score' and len(loaded)==30
    (tmp_path/'human-ai-interaction.csv').write_text('tampered')
    with pytest.raises(ValueError,match='checksum'):load_builtin('trust')

def test_no_fake_trust_dataset(tmp_path,monkeypatch):
    monkeypatch.setattr(data,'DATA_DIR',tmp_path)
    with pytest.raises(ValueError,match='not installed'):load_builtin('trust')

def test_api_end_to_end_csv_switching_target_report(frame,monkeypatch):
    main.datasets.clear();main.jobs.clear()
    monkeypatch.setattr(main,'fetch_csv',lambda url:frame.to_csv(index=False).encode())
    monkeypatch.setattr(main,'load_builtin',lambda problem:(frame.copy(),{'name':problem,'problem':problem,'source':'Test fixture','synthetic':True}))
    client=TestClient(main.app)
    for problem in ('trust','startup'):
        response=client.post('/api/datasets',json={'problem':problem})
        assert response.status_code==200 and response.json()['meta']['problem']==problem
        client.delete('/api/datasets/'+response.json()['id'])
    ds=client.post('/api/datasets',json={'source':'url','url':'https://example.com/data.csv'}).json()
    key=ds['id']
    assert client.get(f'/api/datasets/{key}/preview?page=1').json()['page']==1
    upload=client.post('/api/datasets/upload',files={'file':('test.csv',frame.to_csv(index=False).encode(),'text/csv')})
    assert upload.status_code==200
    run=client.post(f'/api/datasets/{key}/train',json={'target':'target','features':['rain','drainage','state'],'k':2})
    jid=run.json()['job_id'];deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        state=client.get(f'/api/jobs/{jid}').json()
        if state['status']!='running':break
        time.sleep(.05)
    assert state['status']=='complete',state
    values={f['name']:f['default'] for f in state['result']['inputs']}
    assert client.post(f'/api/datasets/{key}/predict',json={'values':values}).status_code==200
    assert client.post(f'/api/datasets/{key}/predict',json={'values':{}}).status_code==422
    assert client.get(f'/api/datasets/{key}/report').status_code==200
    assert '<svg' in client.get(f'/api/datasets/{key}/report?format=html').text
    assert client.get('/api/datasets/invalid/preview').status_code==404

def test_training_only_categorical_imputation_and_encoding(frame):
    from sklearn.model_selection import train_test_split
    train,test=train_test_split(frame,test_size=.2,random_state=42)
    frame.loc[train.index[:10],'state']=np.nan
    frame.loc[test.index,'state']='test_only'
    fitted=fit_analysis(frame,'target',['rain','drainage','state'],k=2)
    cat=fitted['prep'].named_transformers_['categorical']
    assert 'test_only' not in cat.named_steps['encode'].categories_[0]
    assert cat.named_steps['impute'].statistics_[0]==frame.loc[train.index,'state'].mode().iloc[0]
    assert any(x['type']=='category' for x in fitted['result']['inputs'])

def test_local_frontend_origins():
    client=TestClient(main.app)
    for origin in ['http://localhost:5173','http://127.0.0.1:5173']:
        response=client.get('/api/health',headers={'Origin':origin})
        assert response.headers['access-control-allow-origin']==origin
