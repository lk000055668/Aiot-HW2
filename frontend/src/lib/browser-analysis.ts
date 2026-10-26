/** Actual local CSV analysis. No API, remote runtime, or fabricated results. */
import Papa from 'papaparse';
import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import jstatPackage from 'jstat';
import { predictStatic } from './static-predict';
const { jStat } = jstatPackage;
export const BROWSER_LIMITS={bytes:10*1024*1024,rows:20000,columns:40,encoded:60,cells:1000000};
export type Row=Record<string,number|string|null>;
export type Config={target:string;features:string[];k:number;seed:number;test_size:number;scale:boolean;deduplicate:boolean};
const sum=(a:number[])=>a.reduce((x,y)=>x+y,0);
const mean=(a:number[])=>sum(a)/a.length;
const variance=(a:number[])=>{const m=mean(a);return mean(a.map(v=>(v-m)**2));};
const quantile=(a:number[],p:number)=>{const x=[...a].sort((x,y)=>x-y),i=(x.length-1)*p,l=Math.floor(i);return x[l]+(x[Math.ceil(i)]-x[l])*(i-l);};
const unique=(a:any[])=>[...new Set(a)];
const finite=(n:number)=>Number.isFinite(n)?n:null;
const missing=(n:any)=>n===null||n===undefined||n==='';
const mode=(a:string[])=>{const counts=new Map<string,number>();for(const v of a)counts.set(v,(counts.get(v)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0))[0]?.[0];};
const identifier=(name:string,values:any[])=>{const key=name.toLowerCase().replace(/[ _]/g,'');return ['id','index','rowid','recordid'].includes(key)||key.startsWith('unnamed:')||key.endsWith('id')&&unique(values).length>values.length*.9;};
export function shuffled(length:number,seed:number){
  let state=seed>>>0;
  const random=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const order=Array.from({length},(_,i)=>i);for(let i=length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}return order;
}
const sampled=(length:number,size:number,seed=42)=>shuffled(length,seed).slice(0,size).sort((a,b)=>a-b);
function correlation(a:number[],b:number[]){const ma=mean(a),mb=mean(b);let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;ab+=x*y;aa+=x*x;bb+=y*y;}return aa&&bb?Math.max(-1,Math.min(1,ab/Math.sqrt(aa*bb))):0;}
function metrics(y:number[],p:number[]){const e=y.map((v,i)=>v-p[i]),mse=mean(e.map(v=>v*v)),v=variance(y);return {r2:v?1-mse/v:mse===0?1:0,mae:mean(e.map(Math.abs)),mse,rmse:Math.sqrt(mse)};}

export function parseBrowserCsv(text:string,name='Uploaded CSV',sha256='not available'){
  if(new TextEncoder().encode(text).length>BROWSER_LIMITS.bytes)throw Error('Browser CSV limit is 10 MB. Use local full mode for larger files.');
  const parsed=Papa.parse<string[]>(text.replace(/^\uFEFF/,''),{header:false,delimiter:',',skipEmptyLines:'greedy'});
  if(parsed.errors.length)throw Error(`Invalid CSV: ${parsed.errors[0].message}`);
  const [columns,...records]=parsed.data;
  if(!columns||columns.length<2||columns.length>BROWSER_LIMITS.columns)throw Error('CSV must have 2–40 columns in browser mode.');
  if(columns.some(c=>!c.trim()||c.length>120||['__proto__','constructor','prototype'].includes(c))||unique(columns).length!==columns.length)throw Error('CSV headers must be unique, nonempty, and safe names of at most 120 characters.');
  if(records.length<12||records.length>BROWSER_LIMITS.rows||records.length*columns.length>BROWSER_LIMITS.cells)throw Error('Browser CSV needs 12–20,000 rows and at most 1,000,000 cells.');
  if(records.some(row=>row.length!==columns.length))throw Error('Every CSV row must have the same number of fields as the header.');
  if(records.some(row=>row.some(v=>v.length>1000)))throw Error('CSV text cells may contain at most 1,000 characters.');
  const na=new Set(['','NA','N/A','NaN','nan','null','NULL','None','<NA>']);
  const cleaned=records.map(row=>row.map(v=>na.has(v.trim())?null:v));
  const numeric=columns.filter((_,i)=>{const values=cleaned.map(row=>row[i]).filter(v=>v!==null);return values.length>0&&values.every(v=>/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v!.trim())&&Number.isFinite(Number(v)));});
  const rows:Row[]=cleaned.map(row=>Object.fromEntries(columns.map((c,i)=>[c,row[i]===null?null:numeric.includes(c)?Number(row[i]):row[i]])));
  const ids=columns.filter(c=>identifier(c,rows.map(r=>r[c]))),unsuitable:Record<string,string>={},summary:any={},categories:any={},missingCounts:any={};
  for(const c of columns){
    const values=rows.map(r=>r[c]).filter(v=>v!==null);missingCounts[c]=rows.length-values.length;
    if(ids.includes(c))unsuitable[c]='Identifier excluded';else if(!values.length)unsuitable[c]='Entirely missing';else if(unique(values).length<=1)unsuitable[c]='Constant column';else if(!numeric.includes(c)&&unique(values).length>30)unsuitable[c]='More than 30 categories';
    if(numeric.includes(c)){const a=values as number[];summary[c]={count:a.length,mean:mean(a),std:a.length>1?Math.sqrt(variance(a)*a.length/(a.length-1)):null,min:Math.min(...a),'25%':quantile(a,.25),'50%':quantile(a,.5),'75%':quantile(a,.75),max:Math.max(...a)};}
    else {const counts=new Map<string,number>();for(const v of values)counts.set(String(v),(counts.get(String(v))||0)+1);categories[c]=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,30).map(([value,count])=>({value,count}));}
  }
  const targets=numeric.filter(c=>!ids.includes(c)&&rows.filter(r=>r[c]!==null).length>=12&&unique(rows.map(r=>r[c]).filter(v=>v!==null)).length>1);
  if(!targets.length)throw Error('No numerical target with at least 12 labeled values and two distinct values.');
  const index=sampled(rows.length,Math.min(1500,rows.length));
  const dataset={id:`custom-${crypto.randomUUID()}`,meta:{name:name.slice(0,120),source:'Local CSV / browser-only analysis',problem:'custom',synthetic:null,sha256},rows:rows.length,columns,numeric,identifiers:ids,targets,unsuitable_features:unsuitable,
    missing:missingCounts,duplicates:rows.length-unique(rows.map(r=>JSON.stringify(columns.map(c=>r[c])))).length,categories,types:Object.fromEntries(columns.map(c=>[c,numeric.includes(c)?'number':'category'])),summary,
    correlation:{columns:numeric,values:numeric.map(a=>numeric.map(b=>{const pairs=rows.filter(r=>r[a]!==null&&r[b]!==null);return pairs.length>1?correlation(pairs.map(r=>Number(r[a])),pairs.map(r=>Number(r[b]))):null;}))},
    sample:Object.fromEntries(columns.map(c=>[c,index.map(i=>rows[i][c])]))};
  return {dataset,rows};
}

function fitPreprocessing(rows:Row[],features:string[],numericNames:string[],scale:boolean){
  const numeric=features.filter(c=>numericNames.includes(c)).map(name=>{
    const observed=rows.map(r=>r[name]).filter(v=>v!==null) as number[];if(!observed.length)throw Error(`Predictor ${name} is entirely missing in the training partition.`);
    const impute=quantile(observed,.5),filled=rows.map(r=>r[name]===null?impute:Number(r[name]));
    return {name,impute,mean:scale?mean(filled):0,scale:scale?(Math.sqrt(variance(filled))||1):1};
  });
  const categorical=features.filter(c=>!numericNames.includes(c)).map(name=>{
    const values=rows.map(r=>r[name]).filter(v=>v!==null).map(String);if(!values.length)throw Error(`Predictor ${name} is entirely missing in the training partition.`);
    const categories=unique(values).sort();if(categories.length>30)throw Error('Categorical predictors may have at most 30 levels.');
    return {name,impute:mode(values),categories,drop_index:0};
  });
  const encoded_order=[...numeric.map(x=>x.name),...categorical.flatMap(c=>c.categories.slice(1).map(v=>`${c.name}_${v}`))];
  if(encoded_order.length>BROWSER_LIMITS.encoded||encoded_order.length*rows.length>BROWSER_LIMITS.cells)throw Error('Browser design exceeds 60 encoded predictors / 1,000,000 cells. Reduce predictors or use local full mode.');
  const runtime:any={features,numeric,categorical,encoded_order,valid_indices:[],inputs:[],models:{}};
  const full=transformRows(rows,runtime,false);
  runtime.valid_indices=encoded_order.map((_,i)=>i).filter(i=>variance(full.map(r=>r[i]))>1e-14);
  if(!runtime.valid_indices.length)throw Error('All predictors are constant in the training partition.');
  runtime.inputs=features.map(name=>{const n=numeric.find(c=>c.name===name);if(n){const observed=rows.map(r=>r[name]).filter(v=>v!==null) as number[];return {name,type:'number',min:Math.min(...observed),max:Math.max(...observed),default:n.impute};}const c=categorical.find(c=>c.name===name)!;return {name,type:'category',options:c.categories,default:c.impute};});
  return runtime;
}
function transformRows(rows:Row[],runtime:any,valid=true):number[][]{
  return rows.map(row=>{const v=[...runtime.numeric.map((c:any)=>((missing(row[c.name])?c.impute:Number(row[c.name]))-c.mean)/c.scale),...runtime.categorical.flatMap((c:any)=>c.categories.filter((_:any,i:number)=>i!==c.drop_index).map((category:string)=>(missing(row[c.name])?c.impute:String(row[c.name]))===category?1:0))];return valid?runtime.valid_indices.map((i:number)=>v[i]):v;});
}
function scores(a:number[][],y:number[]){return a[0].map((_,i)=>{const r=correlation(a.map(row=>row[i]),y),r2=r*r;return r2>=1?Number.MAX_VALUE:r2/(1-r2)*(y.length-2);});}
function selectedIndices(a:number[][],y:number[],k:number){const f=scores(a,y);return f.map((_,i)=>i).sort((a,b)=>f[b]-f[a]||b-a).slice(0,k).sort((a,b)=>a-b);}
function ols(a:number[][],y:number[]){
  const design=new Matrix(a.map(r=>[1,...r])),svd=new SingularValueDecomposition(design,{autoTranspose:true});
  const parameters=svd.solve(Matrix.columnVector(y)).getColumn(0),predicted=design.mmul(Matrix.columnVector(parameters)).getColumn(0);
  const residual=y.map((v,i)=>v-predicted[i]),sse=sum(residual.map(v=>v*v)),rank=svd.rank,df=y.length-rank;
  const singular=svd.diagonal,v=svd.rightSingularVectors,scale=df>0?sse/df:0;
  const covariance=Array.from({length:parameters.length},(_,i)=>Array.from({length:parameters.length},(_,j)=>scale*sum(singular.map((s,k)=>s>svd.threshold?v.get(i,k)*v.get(j,k)/(s*s):0))));
  return {parameters,predicted,rank,df,scale,covariance,condition:finite(svd.condition)};
}
const point=(a:number[][],parameters:number[])=>a.map(r=>parameters[0]+sum(r.map((v,i)=>v*parameters[i+1])));
function crossValidation(rows:Row[],y:number[],config:Config,numeric:string[]){
  const order=shuffled(rows.length,config.seed),folds:number[][]=[[],[],[]];
  const sizes=Array.from({length:3},(_,i)=>Math.floor(rows.length/3)+(i<rows.length%3?1:0));let start=0;
  for(let i=0;i<3;i++){folds[i]=order.slice(start,start+sizes[i]);start+=sizes[i];}
  const errors:any={all:[],selected:[]};
  try{
    for(const validation of folds){const held=new Set(validation),training=rows.map((_,i)=>i).filter(i=>!held.has(i));
      const train=training.map(i=>rows[i]),truth=training.map(i=>y[i]),prep=fitPreprocessing(train,config.features,numeric,config.scale),a=transformRows(train,prep),b=transformRows(validation.map(i=>rows[i]),prep);
      for(const model of ['all','selected']){const indices=model==='all'?a[0].map((_,i)=>i):selectedIndices(a,truth,Math.min(config.k,a[0].length));const fitted=ols(a.map(r=>indices.map(i=>r[i])),truth);errors[model].push(metrics(validation.map(i=>y[i]),point(b.map(r=>indices.map(i=>r[i])),fitted.parameters)).rmse);}
    }
    return {models:Object.fromEntries(['all','selected'].map(name=>[name,{rmse_mean:mean(errors[name]),rmse_std:Math.sqrt(variance(errors[name])),rows:rows.length,folds:3}])),folds};
  }catch(e:any){return {models:Object.fromEntries(['all','selected'].map(name=>[name,{unavailable:`Training CV unavailable: ${e.message}`,rows:rows.length}])),folds};}
}
export function trainBrowser(rows:Row[],dataset:any,config:Config,progress:(message:string)=>void=()=>{}){
  const {target,k,seed,test_size,scale,deduplicate}=config,features=unique(config.features);
  if(!dataset.numeric.includes(target)||!dataset.targets.includes(target))throw Error('Select a valid numerical target.');
  if(!features.length||features.includes(target)||features.some(c=>!dataset.columns.includes(c)||dataset.identifiers.includes(c)||dataset.unsuitable_features[c]))throw Error('Choose suitable predictors and exclude the target and identifiers.');
  if(!Number.isInteger(k)||k<1||k>60||!Number.isInteger(seed)||seed<0||seed>4294967295||!Number.isFinite(test_size)||test_size<.1||test_size>.4)throw Error('Invalid k (1–60), seed, or test fraction (0.10–0.40).');
  progress('Removing missing targets and checking duplicates');
  const labeled=rows.map((row,index)=>({row,index})).filter(x=>x.row[target]!==null),seen=new Set<string>();let duplicates=0;
  const filtered=labeled.filter(({row})=>{const key=JSON.stringify([...features,target].map(c=>row[c]));if(seen.has(key)){duplicates++;return !deduplicate;}seen.add(key);return true;});
  if(filtered.length<12||unique(filtered.map(x=>x.row[target])).length<2)throw Error('Need at least 12 labeled rows and a nonconstant target after preprocessing.');
  const order=shuffled(filtered.length,seed),testCount=Math.ceil(filtered.length*test_size),testIndices=order.slice(0,testCount),trainIndices=order.slice(testCount);
  if(testCount<2)throw Error('At least two test observations are required.');
  const train=trainIndices.map(i=>filtered[i].row),test=testIndices.map(i=>filtered[i].row),y=train.map(r=>Number(r[target])),actual=test.map(r=>Number(r[target]));
  if(unique(y).length<2)throw Error('The training target is constant after splitting. Change the seed/test fraction or provide more observations.');
  progress('Fitting training-only imputation and encoding');
  const runtime=fitPreprocessing(train,features,dataset.numeric,scale),a=transformRows(train,runtime),b=transformRows(test,runtime),names=runtime.valid_indices.map((i:number)=>runtime.encoded_order[i]);
  if(runtime.encoded_order.length*filtered.length>BROWSER_LIMITS.cells)throw Error('Encoded browser dataset exceeds 1,000,000 cells. Reduce predictors or rows.');
  if(y.length<=names.length+5)throw Error('Too few training rows for this encoded design. Reduce predictors or test fraction.');
  const effectiveK=Math.min(k,names.length),selection=selectedIndices(a,y,effectiveK),f=scores(a,y);
  progress('Cross-validating with preprocessing refitted inside each training fold');
  const cv=crossValidation(train,y,config,dataset.numeric),outputs:any={};
  for(const model of ['all','selected']){
    progress(`Fitting and evaluating ${model} features in this browser`);
    const indices=model==='all'?names.map((_:any,i:number)=>i):selection,aa=a.map(r=>indices.map((i:number)=>r[i])),bb=b.map(r=>indices.map((i:number)=>r[i])),fit=ols(aa,y),predicted=point(bb,fit.parameters),residual=actual.map((v,i)=>v-predicted[i]),valid=fit.rank===indices.length+1&&fit.df>0;
    runtime.models[model]={indices,intercept:fit.parameters[0],coefficients:fit.parameters.slice(1),interval:valid?{ols_params:fit.parameters,covariance:fit.covariance,residual_variance:fit.scale,df_resid:fit.df,t_critical:jStat.studentt.inv(.975,fit.df)}:null};
    const sampleIndex=sampled(actual.length,Math.min(300,actual.length),seed),sample:any={actual:sampleIndex.map(i=>actual[i]),predicted:sampleIndex.map(i=>predicted[i]),residual:sampleIndex.map(i=>residual[i])};
    let coverage=0,width=0;
    if(valid){const intervals=bb.map(vector=>{
      const z=[1,...vector],variance=sum(z.map((v,i)=>v*sum(fit.covariance[i].map((c,j)=>c*z[j])))),t=runtime.models[model].interval.t_critical,mean=sum(z.map((v,i)=>v*fit.parameters[i]));
      const obs=t*Math.sqrt(Math.max(0,variance)+fit.scale),ci=t*Math.sqrt(Math.max(0,variance));return {obs_ci_lower:mean-obs,obs_ci_upper:mean+obs,mean_ci_lower:mean-ci,mean_ci_upper:mean+ci};});
      for(const key of ['obs_ci_lower','obs_ci_upper','mean_ci_lower','mean_ci_upper'])sample[key]=sampleIndex.map(i=>intervals[i][key]);
      coverage=mean(actual.map((v,i)=>v>=intervals[i].obs_ci_lower&&v<=intervals[i].obs_ci_upper?1:0));width=mean(intervals.map(i=>i.obs_ci_upper-i.obs_ci_lower));
    }
    const ordered=[...sample.residual].sort((a,b)=>a-b),n=ordered.length,probabilities=ordered.map((_:any,i:number)=>i===0?1-.5**(1/n):i===n-1?.5**(1/n):(i+1-.3175)/(n+.365));
    let vif:number[]|null=null;
    const corr=new Matrix(indices.map((_:any,i:number)=>indices.map((_:any,j:number)=>correlation(aa.map(r=>r[i]),aa.map(r=>r[j])))));
    const corrSvd=new SingularValueDecomposition(corr);if(corrSvd.rank===indices.length)vif=corrSvd.inverse().diag();
    let bp:number|null=null;try{if(valid){const auxiliary=ols(aa,y.map((v,i)=>(v-fit.predicted[i])**2)),r2=metrics(y.map((v,i)=>(v-fit.predicted[i])**2),auxiliary.predicted).r2;bp=finite(Math.max(0,Math.min(1,1-jStat.chisquare.cdf(y.length*r2,indices.length))));}}catch{/* unavailable is shown explicitly */}
    const trainMetrics=metrics(y,fit.predicted);
    outputs[model]={adjusted_r2:fit.df>0?1-(1-trainMetrics.r2)*(y.length-1)/fit.df:null,metrics:metrics(actual,predicted),train_metrics:trainMetrics,cv:cv.models[model],intercept:fit.parameters[0],
      coefficients:indices.map((index:number,i:number)=>({feature:names[index],coefficient:fit.parameters[i+1],vif:finite(vif?.[i]??NaN)})),sample,qq:{theoretical:probabilities.map(p=>jStat.normal.inv(p,0,1)),observed:ordered},intervals_valid:valid,coverage:valid?coverage:null,mean_interval_width:valid?width:null,
      diagnostics:{rank:fit.rank,design_columns:indices.length+1,condition_number:fit.condition,breusch_pagan_p:bp,diagnostic_sample_rows:y.length},out_of_bounds:target==='latent_trust_score'?predicted.filter(v=>v<0||v>100).length:null};
  }
  const result={target,features,train_count:train.length,test_count:test.length,seed,test_size,k:effectiveK,scale,removed_missing_targets:rows.length-labeled.length,duplicates_found:duplicates,duplicates_removed:deduplicate?duplicates:0,constant_columns_removed:runtime.encoded_order.length-names.length,encoded_features:names.length,
    rankings:names.map((feature:string,i:number)=>({feature,score:f[i],selected:selection.includes(i)})).sort((a,b)=>b.score-a.score),models:outputs,inputs:runtime.inputs,
    methodology:'Browser JavaScript OLS (SVD). Median numeric / most-frequent categorical imputation, drop-first one-hot encoding, optional numeric scaling, constant removal and F-regression selection fit on training data only. Three-fold training-only CV refits preprocessing and selection per fold. Split: seeded Mulberry32 Fisher-Yates; differs from NumPy splitting. No test-set tuning.',
    interval_caveat:'Classical 95% OLS prediction intervals assume linearity, independent errors, constant variance and approximately normal errors. Selected-model intervals omit selection uncertainty; rank-deficient designs have no intervals. No outputs are clipped.',
    reproducibility:{engine:'browser-ols-svd-v1',source:dataset.meta,configuration:{...config,features},split_algorithm:'mulberry32-fisher-yates-v1',train_source_indices:trainIndices.map(i=>filtered[i].index),test_source_indices:testIndices.map(i=>filtered[i].index),cv_validation_indices:cv.folds,created_at:new Date().toISOString()}};
  return {result,runtime};
}

const escapeHtml=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function browserReport(dataset:any,artifact:any,format:'markdown'|'html'){
  const r=artifact.result;
  const text=['# Browser CSV Analysis / CRISP-DM Report','',
    '## 1. Business Understanding',`Predict ${r.target} using ${r.features.length} original predictors. Model associations are not causal effects.`,
    '## 2. Data Understanding',`Dataset: ${dataset.meta.name}. Rows: ${dataset.rows}; columns: ${dataset.columns.length}. SHA-256: ${dataset.meta.sha256}. Source: local CSV read in browser; no server upload.`,
    '## 3. Data Preparation',r.methodology,`Train: ${r.train_count}; test: ${r.test_count}; seed: ${r.seed}; test fraction: ${r.test_size}; scaling: ${r.scale}; duplicates removed: ${r.duplicates_removed}; missing targets removed: ${r.removed_missing_targets}.`,
    '## 4. Modeling',`Model A: all retained encoded predictors. Model B: training F-regression selection, k=${r.k}. Numerical fitting: ml-matrix SVD; Student-t quantile: jStat.`,
    '## 5. Evaluation','| Model | R2 | MAE | MSE | RMSE |','| --- | ---: | ---: | ---: | ---: |',...Object.entries(r.models).map(([name,m]:any)=>`| ${name} | ${m.metrics.r2} | ${m.metrics.mae} | ${m.metrics.mse} | ${m.metrics.rmse} |`),r.interval_caveat,
    '## 6. Deployment','This model was trained locally in the browser from the selected file. Inputs and fitted models remain in page memory; refresh clears them. Built-in saved datasets are unaffected. No backend or Python process is involved.',
    '## Reproducibility, coefficients, diagnostics, chart data and fitted preprocessing','```json',JSON.stringify({analysis:r,runtime:artifact.runtime},(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?null:v,2),'```'].join('\n\n');
  return format==='html'?`<!doctype html><html lang="en"><meta charset="utf-8"><title>Browser CSV CRISP-DM report</title><style>body{font:15px/1.7 system-ui;max-width:1000px;margin:auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${escapeHtml(text)}</pre></html>`:text;
}

export { predictStatic };
