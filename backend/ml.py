"""Training-only preprocessing, OLS inference, and full held-out evaluation."""
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats
from statsmodels.stats.diagnostic import het_breuschpagan
from sklearn.compose import ColumnTransformer
from sklearn.feature_selection import SelectKBest, f_regression
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split, KFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from threadpoolctl import threadpool_limits
from .data import is_identifier

def metrics(y, p):
    mse = mean_squared_error(y, p)
    return dict(r2=float(r2_score(y,p)),mae=float(mean_absolute_error(y,p)),mse=float(mse),rmse=float(np.sqrt(mse)))

def preprocessor(frame, scale):
    nums = list(frame.select_dtypes(include='number').columns)
    cats = [c for c in frame if c not in nums]
    transformers = []
    if nums:
        transformers.append(('numeric',Pipeline([('impute',SimpleImputer(strategy='median',keep_empty_features=True)),('scale',StandardScaler() if scale else 'passthrough')]),nums))
    if cats:
        transformers.append(('categorical',Pipeline([('impute',SimpleImputer(strategy='most_frequent',keep_empty_features=True)),('encode',OneHotEncoder(handle_unknown='ignore',drop='first',sparse_output=False))]),cats))
    return ColumnTransformer(transformers,verbose_feature_names_out=False)

def fit_analysis(df, target, features, k=10, test_size=.2, seed=42, scale=False, deduplicate=True, progress=lambda _:None):
    with threadpool_limits(limits=1):
        return _fit(df,target,features,k,test_size,seed,scale,deduplicate,progress)

def _fit(df,target,features,k,test_size,seed,scale,deduplicate,progress):
    if target not in df or not pd.api.types.is_numeric_dtype(df[target]):
        raise ValueError('Select a numerical target column.')
    features=list(dict.fromkeys(features))
    if not features or target in features or any(c not in df for c in features):
        raise ValueError('Choose valid predictors and exclude the target.')
    if any(is_identifier(c,df[c]) for c in features):
        raise ValueError('Identifier columns cannot be predictors.')
    if not .1 <= test_size <= .4 or not 1 <= k <= 100:
        raise ValueError('Test fraction must be 0.10–0.40 and k must be 1–100.')
    data=df[features+[target]].dropna(subset=[target])
    missing_targets=len(df)-len(data)
    duplicates=int(data.duplicated().sum())
    if deduplicate: data=data.drop_duplicates()
    if len(data)<12 or data[target].nunique()<2:
        raise ValueError('Need at least 12 labeled rows and a nonconstant target.')
    X,y=data[features].copy(),data[target]
    cats=[c for c in features if not pd.api.types.is_numeric_dtype(X[c])]
    if any(X[c].nunique()>30 for c in cats):
        raise ValueError('Categorical features may have at most 30 levels; remove free text or identifiers.')
    for c in cats: X[c]=X[c].map(lambda v:str(v) if pd.notna(v) else np.nan)
    train,test=train_test_split(np.arange(len(X)),test_size=test_size,random_state=seed)
    Xtr,Xte,ytr,yte=X.iloc[train],X.iloc[test],y.iloc[train],y.iloc[test]
    if Xtr.isna().all().any():
        raise ValueError('A predictor is entirely missing in training. Exclude it and rerun analysis.')
    width=len(features)-len(cats)+sum(max(1,Xtr[c].nunique()-1) for c in cats)
    if width>100 or len(X)*width>30_000_000:
        raise ValueError('Encoded design exceeds limits (100 columns / 30 million cells). Reduce rows or features.')
    progress('Fitting preprocessing on the training partition')
    prep=preprocessor(Xtr,scale)
    A=np.asarray(prep.fit_transform(Xtr),dtype=float)
    B=np.asarray(prep.transform(Xte),dtype=float)
    names=np.asarray(prep.get_feature_names_out())
    valid=np.var(A,axis=0)>1e-14
    A,B,names=A[:,valid],B[:,valid],names[valid]
    if not len(names): raise ValueError('All predictors are constant on the training partition.')
    if len(ytr)<=len(names)+5: raise ValueError('Too few training rows for this design. Reduce predictors.')
    k=min(k,len(names))
    selector=SelectKBest(f_regression,k=k).fit(A,ytr)
    selected=selector.get_support()
    progress('Cross-validating on training data only')
    cv_idx=np.random.default_rng(seed).choice(len(Xtr),min(20000,len(Xtr)),replace=False)
    cv_results={}
    for label,choice in [('all','passthrough'),('selected',SelectKBest(f_regression,k=k))]:
        pipe=Pipeline([('prep',preprocessor(Xtr,scale)),('select',choice),('ols',LinearRegression())])
        try:
            scores=cross_val_score(pipe,Xtr.iloc[cv_idx],ytr.iloc[cv_idx],cv=KFold(3,shuffle=True,random_state=seed),scoring='neg_root_mean_squared_error',error_score='raise')
            cv_results[label]={'rmse_mean':float(-scores.mean()),'rmse_std':float(scores.std()),'rows':len(cv_idx),'folds':3}
        except ValueError as exc:
            cv_results[label]={'unavailable':'CV could not fit this fold design: '+str(exc)[:180],'rows':len(cv_idx)}
    models,outputs={},{}
    for label,mask in [('all',np.ones(len(names),dtype=bool)),('selected',selected)]:
        progress(f'Fitting and evaluating {label} feature OLS')
        a,b=A[:,mask],B[:,mask]
        linear=LinearRegression().fit(a,ytr)
        design=sm.add_constant(a,has_constant='add')
        ols=sm.OLS(np.asarray(ytr),design).fit()
        predictions=linear.predict(b)
        if not np.allclose(predictions[:100],ols.predict(sm.add_constant(b[:100],has_constant='add')),rtol=1e-6,atol=1e-7):
            raise ValueError('Numerical instability: sklearn and statistical OLS disagree. Reduce collinearity.')
        rank=np.linalg.matrix_rank(design)
        valid_intervals=rank==design.shape[1] and ols.df_resid>0
        idx=np.sort(np.random.default_rng(seed).choice(len(yte),min(300,len(yte)),replace=False))
        actual=np.asarray(yte)
        residual=actual-predictions
        sample={'actual':actual[idx].tolist(),'predicted':predictions[idx].tolist(),'residual':residual[idx].tolist()}
        coverage,width_sum=0,0.
        if valid_intervals:
            for start in range(0,len(b),20000):
                stop=start+20000
                interval=ols.get_prediction(sm.add_constant(b[start:stop],has_constant='add')).summary_frame(alpha=.05)
                coverage+=int(((actual[start:stop]>=interval.obs_ci_lower)&(actual[start:stop]<=interval.obs_ci_upper)).sum())
                width_sum+=float((interval.obs_ci_upper-interval.obs_ci_lower).sum())
            interval=ols.get_prediction(sm.add_constant(b[idx],has_constant='add')).summary_frame(alpha=.05)
            for key in ['obs_ci_lower','obs_ci_upper','mean_ci_lower','mean_ci_upper']: sample[key]=interval[key].tolist()
        qq=stats.probplot(residual[idx],dist='norm',fit=False)
        diag_idx=np.random.default_rng(seed).choice(len(a),min(10000,len(a)),replace=False)
        try: bp_p=float(het_breuschpagan(ols.resid[diag_idx],design[diag_idx])[1])
        except (ValueError,np.linalg.LinAlgError): bp_p=None
        corr=np.atleast_2d(np.corrcoef(a[diag_idx],rowvar=False)) if a.shape[1]>1 else np.ones((1,1))
        vif=np.diag(np.linalg.inv(corr)).tolist() if np.isfinite(corr).all() and np.linalg.matrix_rank(corr)==len(corr) else None
        outputs[label]={'adjusted_r2':float(ols.rsquared_adj),'metrics':metrics(actual,predictions),'train_metrics':metrics(ytr,linear.predict(a)),'cv':cv_results[label],
            'intercept':float(linear.intercept_),'coefficients':[{'feature':str(n),'coefficient':float(c),'vif':float(vif[i]) if vif else None} for i,(n,c) in enumerate(zip(names[mask],linear.coef_))],
            'sample':sample,'qq':{'theoretical':list(qq[0]),'observed':list(qq[1])},'intervals_valid':bool(valid_intervals),
            'coverage':coverage/len(yte) if valid_intervals else None,'mean_interval_width':width_sum/len(yte) if valid_intervals else None,
            'diagnostics':{'rank':int(rank),'design_columns':design.shape[1],'condition_number':float(ols.condition_number),'breusch_pagan_p':bp_p,'diagnostic_sample_rows':len(diag_idx)},
            'out_of_bounds':int(((predictions<0)|(predictions>100)).sum()) if target=='latent_trust_score' else None}
        models[label]={'linear':linear,'ols':ols,'mask':mask,'intervals_valid':valid_intervals}
    inputs=[]
    for c in features:
        if c in cats:
            options=sorted(Xtr[c].dropna().unique().tolist())
            inputs.append({'name':c,'type':'category','options':options,'default':Xtr[c].mode().iloc[0] if options else ''})
        else:
            s=Xtr[c].dropna()
            inputs.append({'name':c,'type':'number','min':float(s.min()) if len(s) else 0,'max':float(s.max()) if len(s) else 0,'default':float(s.median()) if len(s) else 0})
    rankings=[{'feature':str(n),'score':float(s),'selected':bool(v)} for n,s,v in zip(names,selector.scores_,selected)]
    rankings.sort(key=lambda r:r['score'],reverse=True)
    result={'target':target,'features':features,'train_count':len(train),'test_count':len(test),'seed':seed,'test_size':test_size,'k':k,'scale':scale,
        'removed_missing_targets':missing_targets,'duplicates_found':duplicates,'duplicates_removed':duplicates if deduplicate else 0,'constant_columns_removed':int((~valid).sum()),
        'encoded_features':len(names),'rankings':rankings,'models':outputs,'inputs':inputs,
        'methodology':'Median numeric / most-frequent categorical imputation, drop-first one-hot encoding; fit on training data only. SelectKBest f_regression selects encoded columns on training data. Fixed user k; three-fold training-only CV is descriptive, not test-set tuning.',
        'interval_caveat':'Classical 95% OLS prediction intervals assume linearity, independent errors, constant variance and approximately normal errors. Selected-model intervals condition on the selected design and omit selection uncertainty. Rank-deficient designs have intervals disabled. No outputs are clipped.'}
    return {'prep':prep,'valid':valid,'features':features,'cats':cats,'models':models,'result':result}

def predict(fitted,values,model='selected'):
    if model not in fitted['models']: raise ValueError('Model must be all or selected.')
    if set(values)!=set(fitted['features']): raise ValueError('Provide exactly the trained input features.')
    definitions={x['name']:x for x in fitted['result']['inputs']}
    clean,extrapolated={},[]
    for c in fitted['features']:
        if c in fitted['cats']:
            if str(values[c]) not in definitions[c]['options']: raise ValueError(f'Unknown category for {c}.')
            clean[c]=str(values[c])
        else:
            try: v=float(values[c])
            except (ValueError,TypeError) as exc: raise ValueError(f'{c} must be a finite number.') from exc
            if not np.isfinite(v): raise ValueError(f'{c} must be a finite number.')
            clean[c]=v
            if not definitions[c]['min']<=v<=definitions[c]['max']: extrapolated.append(c)
    a=fitted['prep'].transform(pd.DataFrame([clean]))[:,fitted['valid']]
    m=fitted['models'][model]
    a=a[:,m['mask']]
    result={'prediction':float(m['linear'].predict(a)[0]),'model':model,'extrapolated_features':extrapolated,'prediction_interval':None,'confidence_interval':None}
    if m['intervals_valid']:
        f=m['ols'].get_prediction(sm.add_constant(a,has_constant='add')).summary_frame(alpha=.05).iloc[0]
        result['prediction_interval']=[float(f.obs_ci_lower),float(f.obs_ci_upper)]
        result['confidence_interval']=[float(f.mean_ci_lower),float(f.mean_ci_upper)]
    return result
