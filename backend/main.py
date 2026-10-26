"""Single-worker, bounded-session API. Dataset and model IDs are opaque capabilities."""
import asyncio
import hashlib
import html
import json
import os
import threading
import time
import uuid
from typing import Literal
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel, Field
import numpy as np
from threadpoolctl import threadpool_limits
from .data import load_builtin, parse_csv, fetch_csv, describe, MAX_BYTES
from .ml import fit_analysis, predict
from .limits import BodyLimitMiddleware

app = FastAPI(title='Human–AI Trust Prediction Lab', version='1.0.0')
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv('CORS_ORIGINS','http://localhost:5173,http://127.0.0.1:5173').split(','), allow_methods=['GET','POST','DELETE'], allow_headers=['Content-Type'])
datasets, jobs = {}, {}
lock = threading.RLock()
executor = ThreadPoolExecutor(max_workers=1)
ingestion = asyncio.Semaphore(1)
MAX_DATASETS = max(1,min(int(os.getenv('MAX_DATASETS','4')),8))
TTL = 7200

def safe(value):
    if isinstance(value, dict): return {str(k): safe(v) for k,v in value.items()}
    if isinstance(value, (list, tuple)): return [safe(v) for v in value]
    if isinstance(value, np.ndarray): return safe(value.tolist())
    if isinstance(value, (float, np.floating)): return float(value) if np.isfinite(value) else None
    if isinstance(value, np.integer): return int(value)
    if isinstance(value, np.bool_): return bool(value)
    return value

clean = safe

@app.exception_handler(ValueError)
async def invalid(request, exc):
    return JSONResponse(status_code=422, content={'detail': str(exc)})

def prune():
    now = time.monotonic()
    for store in (datasets, jobs):
        for key in list(store):
            if now-store[key]['created'] > TTL and store[key].get('status') != 'running' and not store[key].get('busy'):
                del store[key]

def get_dataset(key):
    with lock:
        prune()
        if key not in datasets: raise HTTPException(404, 'Dataset expired. Load it again.')
        datasets[key]['created']=time.monotonic()
        return datasets[key]

def register(df, meta):
    with lock:
        prune()
        if len(datasets) >= MAX_DATASETS: raise HTTPException(429, 'Dataset capacity reached. Release an old dataset or wait two hours for expiry.')
        key = uuid.uuid4().hex
        info = safe(describe(df,meta))
        datasets[key] = {'df': df, 'meta': meta, 'created': time.monotonic(), 'busy':False}
    return {'id':key, **info}

class Load(BaseModel):
    problem: Literal['trust','startup'] = 'trust'
    source: Literal['builtin','url'] = 'builtin'
    url: str | None = Field(default=None, max_length=2048)

@app.get('/api/health')
def health(): return {'status':'ok'}

@app.post('/api/datasets')
async def load(body: Load):
    def work():
        try:
            if body.source == 'url':
                if not body.url: raise ValueError('Enter a direct public HTTPS CSV URL.')
                raw = fetch_csv(body.url)
                return register(parse_csv(raw), {'name':'Custom CSV','source':body.url,'problem':'custom','synthetic':None,'sha256':hashlib.sha256(raw).hexdigest()})
            if body.source != 'builtin': raise ValueError('Choose builtin or url, or use the local upload endpoint.')
            df, meta = load_builtin(body.problem)
            return register(df, meta)
        except (OSError, TimeoutError) as exc:
            raise ValueError('Dataset download failed. Check the URL, internet connection and local dataset configuration.') from exc
    async with ingestion:
        return await asyncio.to_thread(work)

@app.post('/api/datasets/upload')
async def upload(file: UploadFile = File(...)):
    async with ingestion:
        try:
            raw = await file.read(MAX_BYTES+1)
            return await asyncio.to_thread(lambda:register(parse_csv(raw), {'name':(file.filename or 'Uploaded CSV')[:120], 'source':'Local upload','problem':'custom','synthetic':None,'sha256':hashlib.sha256(raw).hexdigest()}))
        finally:
            await file.close()

@app.delete('/api/datasets/{key}')
def release(key: str):
    ds=get_dataset(key)
    with lock:
        if ds['busy']: raise HTTPException(409,'Wait for training to finish.')
        del datasets[key]
        for jid in list(jobs):
            if jobs[jid].get('dataset_id') == key: del jobs[jid]
    return {'released':True}

@app.get('/api/datasets/{key}/preview')
def preview(key: str, page: int=0):
    if page < 0: raise ValueError('Page must be nonnegative.')
    df = get_dataset(key)['df']
    return safe({'rows': df.iloc[page*10:(page+1)*10].replace({np.nan:None}).to_dict('records'), 'page':page, 'total':len(df)})

class Analysis(BaseModel):
    target: str
    features: list[str] = Field(min_length=1,max_length=100)
    k: int = Field(default=8, ge=1, le=100)
    test_size: float = Field(default=.2, ge=.1, le=.4)
    seed: int = Field(default=42, ge=0, le=4294967295)
    scale: bool = False
    deduplicate: bool = True

def run_job(key, body, dataset):
    try:
        with threadpool_limits(limits=2):
            artifact = fit_analysis(dataset['df'], **body.model_dump(), progress=lambda message:jobs[key].update(message=message))
        dataset['artifact']=artifact
        jobs[key].update(status='complete', result=safe(artifact['result']), message='Analysis complete', meta=dataset['meta'])
    except Exception as exc:
        jobs[key].update(status='failed', message=str(exc))
    finally:
        dataset['busy']=False

@app.post('/api/datasets/{dataset_id}/train', status_code=202)
def start(dataset_id: str, body: Analysis):
    ds = get_dataset(dataset_id)
    with lock:
        prune()
        if any(j['status']=='running' for j in jobs.values()): raise HTTPException(429,'An analysis is running. Try again after it completes.')
        if len(jobs) >= 8:
            del jobs[min(jobs,key=lambda jid:jobs[jid]['created'])]
        key = uuid.uuid4().hex
        jobs[key] = {'status':'running','message':'Fitting and evaluating OLS','created':time.monotonic(),'dataset_id':dataset_id}
        ds['busy']=True
    executor.submit(run_job,key,body,ds)
    return {'job_id':key}

def get_job(key):
    with lock:
        prune()
        if key not in jobs: raise HTTPException(404,'Analysis expired. Run analysis again.')
        return jobs[key]

@app.get('/api/jobs/{key}')
def status(key: str):
    job = get_job(key)
    return {k:v for k,v in job.items() if k in ('status','result','message')}

class Prediction(BaseModel):
    values: dict[str, float | str]
    model: str = 'selected'

@app.post('/api/datasets/{key}/predict')
def prediction(key: str, body: Prediction):
    ds = get_dataset(key)
    if ds['busy'] or 'artifact' not in ds: raise HTTPException(409,'Analysis must complete before prediction.')
    return safe(predict(ds['artifact'],body.values,body.model))

@app.get('/api/datasets/{key}/report')
def report(key: str, format: str='markdown'):
    ds=get_dataset(key)
    if ds['busy'] or 'artifact' not in ds:
        raise ValueError('Complete an analysis before exporting.')
    from .reporting import export_report
    return export_report(ds,format)
