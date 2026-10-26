"""Generate independent sklearn/statsmodels oracles using the browser's recorded splits.

Test-only missing/duplicate/redundant-column variants never change source data or built-in exports.
"""
import argparse
import json
from pathlib import Path
import platform
import sys
import numpy as np
import pandas as pd
import statsmodels.api as sm
from sklearn.linear_model import LinearRegression
from sklearn.feature_selection import SelectKBest, f_regression
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from scipy import stats
from statsmodels.stats.diagnostic import het_breuschpagan

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.ml import preprocessor
from backend.main import safe


def metrics(y,p):
    return {'r2':float(r2_score(y,p)), 'mae':float(mean_absolute_error(y,p)),
            'mse':float(mean_squared_error(y,p)), 'rmse':float(np.sqrt(mean_squared_error(y,p)))}


def close(a,b,label):
    np.testing.assert_allclose(a,b,rtol=1e-6,atol=2e-5,err_msg=label)


def fit(frame,y,config):
    prep=preprocessor(frame,config['scale'])
    design=prep.fit_transform(frame)
    valid=np.var(design,axis=0)>1e-14
    a=design[:,valid]
    names=np.asarray(prep.get_feature_names_out())[valid]
    selection=SelectKBest(f_regression,k=min(config['k'],a.shape[1])).fit(a,y)
    return prep,valid,a,names,selection


def verify(payload,output):
    cases=[]
    for case in json.loads(payload.read_text(encoding='utf-8')):
        c=case['config'];r=case['artifact']['result'];meta=r['reproducibility']
        df=pd.DataFrame(case['rows']).replace({None:np.nan})
        features=c['features']
        for column in features:
            if column not in case['dataset']['numeric']:
                df[column]=df[column].map(lambda v:str(v) if pd.notna(v) else np.nan)
        training,test=meta['train_source_indices'],meta['test_source_indices']
        xtr,xte=df.loc[training,features],df.loc[test,features]
        ytr,yte=df.loc[training,c['target']].to_numpy(dtype=float),df.loc[test,c['target']].to_numpy(dtype=float)
        prep,valid,a,names,selector=fit(xtr,ytr,c);b=prep.transform(xte)[:,valid]
        rankings=[{'feature':str(n),'score':float(s),'selected':bool(v)} for n,s,v in zip(names,selector.scores_,selector.get_support())]
        rankings.sort(key=lambda item:item['score'],reverse=True)
        for expected,actual in zip(rankings,r['rankings']):
            assert expected['feature']==actual['feature'] and expected['selected']==actual['selected']
            close(expected['score'],actual['score'],case['name']+'/F score')
        models={};python_models={}
        for label,mask in [('all',np.ones(a.shape[1],dtype=bool)),('selected',selector.get_support())]:
            aa,bb=a[:,mask],b[:,mask]
            linear=LinearRegression().fit(aa,ytr)
            ols=sm.OLS(ytr,sm.add_constant(aa,has_constant='add')).fit()
            p=linear.predict(bb);actual=r['models'][label]
            expected_intervals=np.linalg.matrix_rank(sm.add_constant(aa,has_constant='add'))==aa.shape[1]+1 and ols.df_resid>0
            assert bool(expected_intervals)==actual['intervals_valid'],case['name']+'/interval availability'
            for key,value in metrics(yte,p).items():close(value,actual['metrics'][key],case['name']+'/'+label+'/'+key)
            close(ols.rsquared_adj,actual['adjusted_r2'],case['name']+'/adjusted')
            if actual['intervals_valid']:
                close(linear.coef_,[v['coefficient'] for v in actual['coefficients']],case['name']+'/coefficients')
                bp=float(het_breuschpagan(ols.resid,sm.add_constant(aa,has_constant='add'))[1])
                close(bp,actual['diagnostics']['breusch_pagan_p'],case['name']+'/Breusch-Pagan')
                corr=np.atleast_2d(np.corrcoef(aa,rowvar=False))
                if np.linalg.matrix_rank(corr)==corr.shape[0]:
                    close(np.diag(np.linalg.inv(corr)),[v['vif'] for v in actual['coefficients']],case['name']+'/VIF')
            samples=actual['sample'];sample_indices=[]
            # Match chart rows by recorded actual/predicted pairs; all cases have <=300 test rows.
            assert len(samples['actual'])==len(yte)
            order=[]
            for i,value in enumerate(samples['actual']):
                choices=[j for j,v in enumerate(yte) if j not in order and np.isclose(v,value)]
                assert choices;order.append(min(choices,key=lambda j:abs(p[j]-samples['predicted'][i])))
            sample={'actual':yte[order].tolist(),'predicted':p[order].tolist(),'residual':(yte-p)[order].tolist()}
            qq=stats.probplot((yte-p)[order],dist='norm',fit=False)
            close(qq[0],actual['qq']['theoretical'],case['name']+'/QQ quantiles')
            close(qq[1],actual['qq']['observed'],case['name']+'/QQ residuals')
            interval=ols.get_prediction(sm.add_constant(bb[order],has_constant='add')).summary_frame(alpha=.05)
            if actual['intervals_valid']:
                for key in ['obs_ci_lower','obs_ci_upper','mean_ci_lower','mean_ci_upper']:
                    sample[key]=interval[key].tolist();close(sample[key],samples[key],case['name']+'/'+key)
            cv=[]
            for validation in meta['cv_validation_indices']:
                foldtrain=[i for i in range(len(xtr)) if i not in set(validation)]
                fp,fv,fa,fn,fs=fit(xtr.iloc[foldtrain],ytr[foldtrain],c)
                fb=fp.transform(xtr.iloc[validation])[:,fv]
                fm=np.ones(fa.shape[1],dtype=bool) if label=='all' else fs.get_support()
                lp=LinearRegression().fit(fa[:,fm],ytr[foldtrain]).predict(fb[:,fm])
                cv.append(metrics(ytr[validation],lp)['rmse'])
            cv_result={'rmse_mean':float(np.mean(cv)),'rmse_std':float(np.std(cv)), 'rows':len(xtr),'folds':3}
            close(list(cv_result.values()),list(actual['cv'].values()),case['name']+'/CV')
            models[label]={'metrics':metrics(yte,p),'adjusted_r2':float(ols.rsquared_adj),'coefficients':linear.coef_.tolist(),'cv':cv_result,'sample':sample,'intervals_valid':actual['intervals_valid']}
            python_models[label]=(linear,ols,mask)
        predictions=[]
        for request in case['predictions']:
            row=pd.DataFrame([{key:np.nan if value is None else value for key,value in request['values'].items()}])
            transformed=prep.transform(row)[:,valid]
            linear,ols,mask=python_models[request['model']];transformed=transformed[:,mask]
            predicted=float(linear.predict(transformed)[0]);actual=request['output'];close(predicted,actual['prediction'],case['name']+'/new prediction')
            result={'prediction':predicted,'model':request['model'],'prediction_interval':None,'confidence_interval':None,
                    'extrapolated_features':actual['extrapolated_features'],'imputed_features':actual['imputed_features']}
            if r['models'][request['model']]['intervals_valid']:
                interval=ols.get_prediction(sm.add_constant(transformed,has_constant='add')).summary_frame(alpha=.05).iloc[0]
                result['prediction_interval']=[float(interval.obs_ci_lower),float(interval.obs_ci_upper)]
                result['confidence_interval']=[float(interval.mean_ci_lower),float(interval.mean_ci_upper)]
                close(result['prediction_interval'],actual['prediction_interval'],case['name']+'/new PI')
                close(result['confidence_interval'],actual['confidence_interval'],case['name']+'/new CI')
            predictions.append(result)
        cases.append({'name':case['name'],'models':models,'predictions':predictions,'rankings':rankings})
        print('Verified actual browser fit:',case['name'])
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(safe({'engine':'independent sklearn/statsmodels','python':platform.python_version(),'cases':cases}),ensure_ascii=False,allow_nan=False),encoding='utf-8')
    print('Saved reference:',output)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('payload',type=Path)
    parser.add_argument('--output',type=Path,default=ROOT/'frontend/tests-static/fixtures/browser-oracle.json')
    args=parser.parse_args();verify(args.payload,args.output)
