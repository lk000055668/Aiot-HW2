"""Generic import validation and SSRF/download boundaries; no real private requests."""
import io
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from backend import data,main

class Response:
    def __init__(self,status=200,headers=None,body=b'a,b\n1,2'):
        self.status=status;self.headers=headers or {};self.body=io.BytesIO(body)
    def getheader(self,name,default=None):return self.headers.get(name,default)
    def read(self,n):return self.body.read(n)

def transport(monkeypatch,responses):
    visited=[]
    monkeypatch.setattr(data,'public_addresses',lambda host: ['8.8.8.8'] if host=='public.example' else (_ for _ in ()).throw(ValueError('CSV URL must resolve exclusively to public IP addresses.')))
    class Connection:
        def __init__(self,host,address):visited.append((host,address))
        def request(self,*a,**kw):pass
        def getresponse(self):return responses.pop(0)
        def close(self):pass
    monkeypatch.setattr(data,'PinnedHTTPS',Connection)
    return visited

@pytest.mark.parametrize('location',['https://127.0.0.1/private.csv','https://internal.example/private.csv','http://public.example/a.csv','https://name:secret@public.example/a.csv','https://public.example:444/a.csv'])
def test_unsafe_redirect_revalidated(monkeypatch,location):
    visited=transport(monkeypatch,[Response(302,{'Location':location})])
    with pytest.raises(ValueError):data.fetch_csv('https://public.example/a.csv')
    assert len(visited)==1

def test_redirect_count_is_bounded(monkeypatch):
    visited=transport(monkeypatch,[Response(302,{'Location':'/again.csv'}) for _ in range(4)])
    with pytest.raises(ValueError,match='redirects'):data.fetch_csv('https://public.example/a.csv')
    assert len(visited)==4

@pytest.mark.parametrize('headers,body,match',[
    ({'Content-Length':'100'},b'', 'size limit'),
    ({},b'x'*40,'size limit'),
    ({'Content-Encoding':'gzip'},b'abc','Compressed'),
])
def test_excessive_download_and_compression(monkeypatch,headers,body,match):
    monkeypatch.setattr(data,'MAX_BYTES',20)
    transport(monkeypatch,[Response(headers=headers,body=body)])
    with pytest.raises(ValueError,match=match):data.fetch_csv('https://public.example/a.csv')

def test_download_deadline(monkeypatch):
    transport(monkeypatch,[Response()])
    ticks=iter([0,46]);monkeypatch.setattr(data.time,'monotonic',lambda:next(ticks))
    with pytest.raises(ValueError,match='deadline'):data.fetch_csv('https://public.example/a.csv')

def test_schema_reports_targets_and_unusable_predictors():
    df=pd.DataFrame({'id':range(40),'outcome':np.arange(40)*2.,'group':['a','b']*20,'free_text':[f'row-{n}' for n in range(40)],'constant':1,'empty':np.nan})
    info=data.describe(df,{'name':'Test fixture'})
    assert info['targets']==['outcome']
    assert info['categories']['group'][0]['count']==20
    assert info['unsuitable_features']=={'id':'Identifier excluded','free_text':'More than 30 categories','constant':'Constant column','empty':'Entirely missing'}

@pytest.mark.parametrize('df',[
    pd.DataFrame({'id':range(20),'category':['a','b']*10}),
    pd.DataFrame({'constant':[1.]*20,'category':['a','b']*10}),
    pd.DataFrame({'few':[1.,2.]+[np.nan]*18,'category':['a','b']*10}),
])
def test_unsuitable_regression_target_rejected(df):
    with pytest.raises(ValueError,match='suitable numerical target'):data.describe(df,{'name':'Test fixture'})

def test_invalid_import_returns_error_without_creating_session(monkeypatch):
    main.datasets.clear();main.jobs.clear()
    client=TestClient(main.app)
    monkeypatch.setattr(main,'fetch_csv',lambda _:b'constant,category\n'+b'1,a\n'*20)
    response=client.post('/api/datasets',json={'source':'url','url':'https://public.example/data.csv'})
    assert response.status_code==422 and 'suitable numerical target' in response.json()['detail']
    assert not main.datasets
