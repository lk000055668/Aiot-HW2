"""Bounded generic CSV ingestion and pinned built-in dataset provenance."""
import hashlib
import csv
import http.client
import io
import ipaddress
import json
import os
from pathlib import Path
import socket
import ssl
import time
from urllib.parse import urlsplit, urljoin

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv('DATA_DIR', str(ROOT / 'data'))).resolve()
MAX_BYTES = min(int(os.getenv('MAX_CSV_MB', '150')), 200) * 1024 * 1024
MAX_ROWS = 1_500_000
STARTUP_URL = 'https://raw.githubusercontent.com/Avik-Jain/100-Days-Of-ML-Code/master/datasets/50_Startups.csv'
TRUST_DATASET = 'eshaalnmalik/human-ai-interaction'
TRUST_VERSION = 1
TRUST_TARGET = 'latent_trust_score'
TRUST_FEATURES = ['age','education_level','technical_experience','cognitive_load','prior_ai_exposure','model_accuracy','explainability_score','bias_level','decision_latency','error_rate','interaction_frequency','ui_complexity','feedback_quality','trust_history','override_frequency','task_risk','domain','time_pressure','cultural_factor','regulatory_strictness']

def public_addresses(host: str):
    try:
        addresses = list(dict.fromkeys(x[4][0] for x in socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)))
    except socket.gaierror as exc:
        raise ValueError('CSV hostname could not be resolved. Check the public HTTPS URL.') from exc
    if not addresses or any(not ipaddress.ip_address(x).is_global for x in addresses):
        raise ValueError('CSV URL must resolve exclusively to public IP addresses.')
    return addresses

class PinnedHTTPS(http.client.HTTPSConnection):
    """Connect to the validated address, keeping original TLS SNI and Host."""
    def __init__(self, host, address):
        super().__init__(host, timeout=10, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        sock = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except Exception:
            sock.close()
            raise

def fetch_csv(url: str) -> bytes:
    deadline = time.monotonic() + 45
    for _ in range(4):
        u = urlsplit(url)
        if u.scheme != 'https' or not u.hostname or u.username or u.password or u.port not in (None, 443):
            raise ValueError('Use a public HTTPS CSV URL on port 443 without credentials.')
        addresses = public_addresses(u.hostname)
        conn = PinnedHTTPS(u.hostname, addresses[0])
        try:
            path = u.path or '/'
            if u.query:
                path += '?' + u.query
            conn.request('GET', path, headers={'Accept': 'text/csv,*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'HumanAITrustLab/1.0'})
            response = conn.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                url = urljoin(url, response.getheader('Location', ''))
                continue
            if response.status != 200:
                raise ValueError(f'CSV server returned HTTP {response.status}. Use a direct public CSV download link.')
            if response.getheader('Content-Encoding', 'identity') != 'identity':
                raise ValueError('Compressed HTTP responses are not supported. Use an uncompressed CSV.')
            if int(response.getheader('Content-Length', '0')) > MAX_BYTES:
                raise ValueError('CSV exceeds the configured upload size limit.')
            chunks, total = [], 0
            while True:
                if time.monotonic() > deadline:
                    raise ValueError('CSV download exceeded the 45-second deadline.')
                chunk = response.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BYTES:
                    raise ValueError('CSV exceeds the configured upload size limit.')
                chunks.append(chunk)
            return b''.join(chunks)
        finally:
            conn.close()
    raise ValueError('Too many CSV URL redirects.')

def parse_csv(raw: bytes) -> pd.DataFrame:
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('CSV is empty or exceeds the configured size limit.')
    try:
        names=next(csv.reader(io.TextIOWrapper(io.BytesIO(raw),encoding='utf-8-sig')))
        if len(names)!=len(set(names)) or any(not str(c).strip() for c in names):
            raise ValueError('CSV headers must be unique and nonempty.')
        header = pd.read_csv(io.BytesIO(raw), nrows=0)
        if not 2 <= len(header.columns) <= 100:
            raise ValueError('CSV must have between 2 and 100 columns.')
        row_limit=min(MAX_ROWS,30_000_000//len(header.columns))
        df = pd.read_csv(io.BytesIO(raw), nrows=row_limit + 1)
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError, csv.Error, StopIteration) as e:
        raise ValueError('Invalid CSV. Supply a UTF-8 comma-separated table with one header row.') from e
    if not 12 <= len(df) <= row_limit:
        raise ValueError(f'CSV must have 12–{row_limit:,} rows for this schema (maximum 30 million cells).')
    if any(len(str(c)) > 120 for c in df.columns):
        raise ValueError('Column names must be at most 120 characters.')
    df = df.replace([np.inf, -np.inf], np.nan)
    # Bound object memory and design-matrix expansion before expensive summaries.
    for column in df.select_dtypes(exclude='number'):
        if df[column].dropna().astype(str).str.len().max() > 1000:
            raise ValueError('CSV text cells must contain at most 1,000 characters.')
    if not len(df.select_dtypes(include='number').columns):
        raise ValueError('CSV needs at least one numerical target column.')
    return df

def is_identifier(name, series):
    key = str(name).lower().replace(' ', '').replace('_', '')
    return key in ('id', 'index', 'rowid', 'recordid') or key.startswith('unnamed:') or key.endswith('id') and series.nunique() > len(series) * .9

def load_builtin(problem: str):
    if problem == 'startup':
        file = DATA_DIR / '50_Startups.csv'
        raw = file.read_bytes() if file.exists() else fetch_csv(STARTUP_URL)
        return parse_csv(raw), {'name': 'Startup Profit', 'source': STARTUP_URL, 'problem': 'startup', 'target': 'Profit', 'synthetic': None, 'sha256': hashlib.sha256(raw).hexdigest()}
    if problem != 'trust':
        raise ValueError('Unknown problem. Choose trust or startup.')
    manifest, file = DATA_DIR/'trust-source.json', DATA_DIR/'human-ai-interaction.csv'
    if not manifest.exists() or not file.exists():
        raise ValueError('Human-AI data is not installed. Run python scripts/acquire_data.py or upload the authentic CSV.')
    meta = json.loads(manifest.read_text(encoding='utf-8'))
    raw = file.read_bytes()
    if meta.get('dataset') != TRUST_DATASET or meta.get('version') != TRUST_VERSION or meta.get('sha256') != hashlib.sha256(raw).hexdigest():
        raise ValueError('Trust provenance manifest is invalid or checksum does not match. Reacquire the dataset.')
    df = parse_csv(raw)
    validate_trust(df)
    return df, {**meta, 'name':'Human-AI Interaction', 'problem':'trust', 'target':TRUST_TARGET, 'synthetic':True}

def validate_trust(df):
    if set(df.columns) != set(TRUST_FEATURES + [TRUST_TARGET]):
        raise ValueError('Human-AI CSV schema differs from the verified version 1 dataset.')
    if not pd.api.types.is_numeric_dtype(df[TRUST_TARGET]) or not df[TRUST_TARGET].dropna().between(0,100).all():
        raise ValueError('latent_trust_score must be numerical and within [0, 100].')
    return df

def describe(df, meta):
    numeric = list(df.select_dtypes(include='number').columns)
    ids = [c for c in df if is_identifier(c, df[c])]
    targets = [c for c in numeric if c not in ids and df[c].notna().sum() >= 12 and df[c].nunique() > 1]
    if not targets:
        raise ValueError('No suitable numerical target: need at least 12 nonmissing values and two distinct values in a non-identifier column.')
    unsuitable = {c: 'Identifier excluded' if c in ids else 'Entirely missing' if df[c].notna().sum()==0 else 'Constant column' if df[c].nunique()<=1 else 'More than 30 categories' for c in df if c in ids or df[c].notna().sum()==0 or df[c].nunique()<=1 or c not in numeric and df[c].nunique()>30}
    sample = df.sample(min(1500, len(df)), random_state=42)
    correlation_cols = numeric[:40]
    return {'meta': meta, 'rows': len(df), 'columns': list(df.columns), 'numeric': numeric, 'identifiers': ids, 'targets': targets, 'unsuitable_features':unsuitable,
            'missing': {c: int(v) for c, v in df.isna().sum().items()}, 'duplicates': int(df.duplicated().sum()),
            'categories': {c: [{'value':str(v), 'count':int(n)} for v,n in df[c].dropna().astype(str).value_counts().head(30).items()] for c in df if c not in numeric},
            'types': {c: str(t) for c, t in df.dtypes.items()}, 'summary': df[numeric].describe().to_dict(),
            'correlation': {'columns': correlation_cols, 'values': df[correlation_cols].corr().values.tolist()},
            'sample': sample.to_dict(orient='list')}
