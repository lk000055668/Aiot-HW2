"""Download the pinned authentic Kaggle dataset; never substitute records."""
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.request
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.data import DATA_DIR, TRUST_DATASET, TRUST_VERSION, parse_csv, validate_trust

URL = f'https://www.kaggle.com/api/v1/datasets/download/{TRUST_DATASET}?datasetVersionNumber={TRUST_VERSION}'

def acquire(destination=DATA_DIR, archive_bytes=None):
    # Public official API; credentials and browser cookies are not required.
    if archive_bytes is None:
        request = urllib.request.Request(URL, headers={'User-Agent':'HumanAITrustLab/1.0'})
        with urllib.request.urlopen(request, timeout=60) as response:
            archive_bytes = response.read(20*1024*1024+1)
    if len(archive_bytes)>20*1024*1024:
        raise ValueError('Unexpected dataset archive size.')
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        files=[i for i in archive.infolist() if Path(i.filename).name=='Human-AI Interaction.csv']
        if len(files)!=1 or files[0].file_size>20*1024*1024:
            raise ValueError('Unexpected dataset archive contents.')
        raw=archive.read(files[0])
    df=validate_trust(parse_csv(raw))
    meta={'dataset':TRUST_DATASET,'version':TRUST_VERSION,'source':'https://www.kaggle.com/dsv/13207192',
          'sha256':hashlib.sha256(raw).hexdigest(),'rows':len(df),'columns':list(df.columns),
          'types':{c:str(t) for c,t in df.dtypes.items()},'missing':{c:int(n) for c,n in df.isna().sum().items()},
          'duplicates':int(df.duplicated().sum()),'synthetic':True,'license':'CC0: Public Domain (Kaggle data card)',
          'documentation':'Synthetic educational data, no real personal data. Associations are not causal effects.',
          'acquisition':'Official Kaggle public dataset API, version 1, Human-AI Interaction.csv'}
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    (destination/'human-ai-interaction.csv').write_bytes(raw)
    (destination/'trust-source.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    return meta

if __name__=='__main__':
    print(json.dumps(acquire(),indent=2))
