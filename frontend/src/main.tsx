import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { BrainCircuit, LayoutDashboard, Database, SlidersHorizontal, ListFilter, Network, ChartNoAxesCombined, FlaskConical, FileText, Moon, Sun, ArrowRight, Download, Play, LoaderCircle, AlertCircle, Check, ExternalLink } from 'lucide-react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import { Button } from './components/ui/button';
import './style.css';
import { trainBrowserCsv, browserAction } from './lib/browser-client';
import { STATIC_MODE, staticApi, staticBundle, staticReport } from './lib/static-data';
import { Hero, ModeCards, ProblemSelector, ResultMetrics, Equation, Interpretation } from './components/research';

const Plot = createPlotlyComponent(Plotly);
const API = STATIC_MODE ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const stages = ['Overview', 'Data Understanding', 'Data Preparation', 'Feature Selection', 'Modeling', 'Evaluation', 'Prediction', 'CRISP-DM Report'];
const icons = [LayoutDashboard, Database, SlidersHorizontal, ListFilter, Network, ChartNoAxesCombined, FlaskConical, FileText];
const number = (v: any, digits = 4) => v == null ? 'Unavailable' : typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: digits }) : String(v);
const human = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
async function api(path: string, opts: RequestInit = {}) {
  if (STATIC_MODE) return staticApi(path, opts);
  let response: Response;
  try { response = await fetch(API + path, opts); } catch { throw new Error('Backend unavailable. Start FastAPI and verify VITE_API_URL and CORS_ORIGINS.'); }
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || `HTTP ${response.status}`)), {status:response.status}); }
  return response.json();
}
const post = (body: any) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function Chart({ data, title, xTitle, yTitle, layout = {} }: any) {
  return <figure className="chart"><figcaption>{title}</figcaption><Plot data={data} layout={{ autosize: true, height: 390, margin: { t: 18, r: 24, b: 75, l: 65 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { family: 'Arial, sans-serif', color: '#171714', size: 12 }, colorway: ['#244be8', '#ff6534', '#bded55'], xaxis: { title: xTitle, gridcolor: '#17171418', zerolinecolor: '#17171480' }, yaxis: { title: yTitle, gridcolor: '#17171418', zerolinecolor: '#17171480' }, showlegend: false, ...layout }} config={{ responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] }} useResizeHandler style={{ width: '100%' }} /></figure>;
}
function Note({ children }: any) { return <div className="note"><AlertCircle size={17} /><div>{children}</div></div>; }
function Table({ columns, rows }: { columns: string[]; rows: any[][] }) { return <div className="table-scroll"><table><thead><tr>{columns.map(c => <th key={c}>{human(c)}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{number(v)}</td>)}</tr>)}</tbody></table></div>; }

function App() {
  const transition = useRef(false);
  const primarySelector = useRef<HTMLDivElement>(null);
  const [showStickySelector, setShowStickySelector] = useState(false);
  const customDraft = useRef<any>(null);
  const [dark, setDark] = useState(false);
  const [stage, setStage] = useState(0), [problem, setProblem] = useState('trust'), [source, setSource] = useState('upload');
  const savedMode = STATIC_MODE && problem !== 'custom';
  const [url, setUrl] = useState(''), [file, setFile] = useState<File | null>(null);
  const [dataset, setDataset] = useState<any>(null), [target, setTarget] = useState(''), [features, setFeatures] = useState<string[]>([]);
  const [k, setK] = useState(10), [split, setSplit] = useState(.2), [scale, setScale] = useState(false), [dedup, setDedup] = useState(true);
  const [seed, setSeed] = useState(42), [busy, setBusy] = useState(false), [status, setStatus] = useState('Ready to explore'), [error, setError] = useState('');
  const [job, setJob] = useState(''), [result, setResult] = useState<any>(null), [model, setModel] = useState('selected');
  const [page, setPage] = useState(0), [preview, setPreview] = useState<any[]>([]), [variable, setVariable] = useState('');
  const [values, setValues] = useState<Record<string, any>>({}), [prediction, setPrediction] = useState<any>(null);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    if (!dataset) return;
    let active = true;
    api(`/api/datasets/${dataset.id}/preview?page=${page}`).then(x => { if (active) setPreview(x.rows); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [dataset, page]);
  useEffect(() => {
    if (!job) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const j = await api(`/api/jobs/${job}`);
        if (!active) return;
        setStatus(j.message);
        if (j.status === 'complete') {
          setResult(j.result); setValues(Object.fromEntries(j.result.inputs.map((x: any) => [x.name, x.default])));
          setPrediction(null); setBusy(false); setJob(''); setStage(5);
        } else if (j.status === 'failed') { setError(j.message); setBusy(false); setJob(''); }
        else timer = setTimeout(poll, 1000);
      } catch (e: any) { if (active) { setError(e.message); setBusy(false); setJob(''); } }
    };
    poll(); return () => { active = false; clearTimeout(timer); };
  }, [job]);
  useEffect(() => {
    if (stage !== 0) { setShowStickySelector(true); return; }
    const element = primarySelector.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      setShowStickySelector(!entry.isIntersecting && entry.boundingClientRect.top < 100);
    }, { rootMargin: '-100px 0px 0px 0px', threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stage]);
  function clearAnalysis() {
    setResult(null); setPrediction(null); setValues({}); setModel('selected'); setJob('');
  }
  async function reset() {
    const oldId = dataset?.id;
    setDataset(null); clearAnalysis(); setPreview([]); setTarget(''); setFeatures([]); setPage(0); setVariable('');
    setK(10); setSplit(.2); setScale(false); setDedup(true); setSeed(42);
    if (oldId && oldId !== customDraft.current?.dataset?.id) {
      try { await api(`/api/datasets/${oldId}`, {method:'DELETE'}); }
      catch (e:any) { if (e.status !== 404) throw e; }
    }
  }
  const defaultFeatures = (d:any,t:string) => d.columns.filter((c:string) => c !== t && !d.identifiers.includes(c) && !d.unsuitable_features[c]);
  async function changeProblem(value: string) {
    if (transition.current || busy || value === problem) return;
    clearAnalysis();
    if (problem === 'custom') customDraft.current = {dataset,target,features,k,split,scale,dedup,seed,source,url,file,variable,page};
    setProblem(value);

    if (value !== 'custom') { await load(value,'builtin'); return; }
    transition.current=true; setBusy(true); setError(''); setStage(0);
    try {
      await reset();
      const draft=customDraft.current;
      setSource(STATIC_MODE ? 'upload' : draft?.source || 'upload'); setUrl(draft?.url || ''); setFile(draft?.file || null);
      if (draft?.dataset) {
        // Reuse the imported session and user configuration, but require a fresh fit.
        try { await api(`/api/datasets/${draft.dataset.id}/preview?page=0`); }
        catch (e:any) { if (e.status===404) { customDraft.current={...draft,dataset:null}; setStatus('Custom session expired · import your dataset again'); return; } throw e; }
        setDataset(draft.dataset); setTarget(draft.target); setFeatures(draft.features); setK(draft.k); setSplit(draft.split); setScale(draft.scale); setDedup(draft.dedup); setSeed(draft.seed); setVariable(draft.variable); setPage(draft.page);
        setStatus('Custom dataset restored · start a fresh analysis');
      } else setStatus('Custom problem · import a CSV URL or file');
    } catch (e:any) { setError(e.message); setStatus('Custom dataset unavailable · retry importing'); }
    finally { transition.current=false; setBusy(false); }
  }
  function changeSource(value: string) {
    if (transition.current || busy) return;
    // An import-method change does not discard an already loaded custom dataset.
    setSource(value); setError('');
  }
  async function load(selectedProblem=problem, selectedSource=problem === 'custom' ? source : 'builtin') {
    if (transition.current || busy) return;
    transition.current=true; setBusy(true); setError(''); setStage(0); setStatus(STATIC_MODE ? 'Loading verified static export' : 'Loading and validating CSV');
    const importing=selectedProblem === 'custom';
    try {
      if (!importing) await reset();
      let d;
      if (selectedSource === 'upload') {
        if (!file) throw new Error('Select a local CSV file first.');
        const body = new FormData(); body.append('file', file);
        d = await api('/api/datasets/upload', {method:'POST',body});
      } else {
        if (selectedSource === 'url' && !url.trim()) throw new Error('Enter a direct public HTTPS CSV URL.');
        d = await api('/api/datasets', post({problem:importing ? 'trust' : selectedProblem,source:selectedSource,url:url.trim()}));
      }
      // Commit a replacement only after successful validation. Failed imports keep user settings.
      if (importing) { customDraft.current=null; await reset(); }
      const t = d.meta.target || d.targets.at(-1);
      const f = defaultFeatures(d,t);
      setDataset(d); setTarget(t); setFeatures(f); setVariable(f[0] || t); setK(Math.min(10,Math.max(1,f.length))); setStatus('Dataset validated · ready for analysis');
      if (STATIC_MODE && !importing) {
        const bundle = await staticBundle(selectedProblem);
        const r = bundle.result, config = bundle.provenance.configuration;
        setResult(r); setValues(Object.fromEntries(r.inputs.map((x:any)=>[x.name,x.default])));
        setFeatures(r.features); setK(r.k); setSplit(r.test_size); setSeed(r.seed); setScale(r.scale); setDedup(config.deduplicate);
        setStatus('Verified saved analysis loaded / no backend');
      }
    } catch (e:any) { setError(e.message); setStatus(importing && dataset ? 'Import failed · previous custom dataset and settings kept' : 'Dataset unavailable · correct the source and retry'); }
    finally { transition.current=false; setBusy(false); }
  }
  useEffect(() => { void load('trust','builtin'); }, []);
  async function train() {
    if (busy || transition.current) return;
    if (savedMode) { if (result) setStage(5); else setError('No exported analysis is available. Use local full mode to train.'); return; }
    if (!dataset || !target || !features.length || !Number.isInteger(k) || k < 1 || k > (STATIC_MODE ? 60 : 100) || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) { setError('Choose a numerical target, at least one predictor, a whole-number k within the displayed limit, and a valid nonnegative seed.'); return; }
    setBusy(true); setError(''); clearAnalysis();
    if (STATIC_MODE) {
      setStatus('Starting browser CSV analysis / file stays on this device');
      try {
        const r = await trainBrowserCsv(dataset.id, { target, features, k, test_size: split, seed, scale, deduplicate: dedup }, setStatus);
        setResult(r); setValues(Object.fromEntries(r.inputs.map((x:any)=>[x.name,x.default])));
        setPrediction(null); setStage(5); setStatus('Browser analysis complete / no backend');
      } catch(e:any) { setError(e.message); setStatus('Browser analysis failed / adjust your data or configuration'); }
      finally { setBusy(false); }
      return;
    }
    try {
      const j = await api(`/api/datasets/${dataset.id}/train`, post({ target, features, k, test_size: split, seed, scale, deduplicate: dedup }));
      setJob(j.job_id); setStatus('Starting regression analysis');
    } catch (e: any) { setError(e.message); setBusy(false); }
  }
  async function makePrediction() {
    setBusy(true); setError(''); setPrediction(null);
    try { setPrediction(await api(`/api/datasets/${dataset.id}/predict`, post({ model, values }))); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function exportReport(format: 'markdown' | 'html' = 'markdown') {
    try {
      let blob: Blob;
      if (STATIC_MODE && problem === 'custom') {
        blob = new Blob([await browserAction('report', dataset.id, {format})], {type:format==='html'?'text/html':'text/markdown'});
      } else {
        const response = await fetch(STATIC_MODE ? await staticReport(problem, format) : `${API}/api/datasets/${dataset.id}/report?format=${format}`);
        if (!response.ok) throw new Error('Report unavailable. Complete an analysis first.');
        blob = await response.blob();
      }
      const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = `crisp-dm-report.${format==='html'?'html':'md'}`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e: any) { setError(e.message); }
  }
  const m = result?.models[model], all = result?.models.all, selected = result?.models.selected;
  const trust = dataset?.meta.problem === 'trust' && result?.target === 'latent_trust_score';
  const statisticCards = dataset ? [['Labeled source rows', number(dataset.rows, 0)], ['Available predictors', dataset.columns.filter((c: string) => c !== target && !dataset.identifiers.includes(c)).length], ['Target variable', target], ['Missing cells', number(Object.values(dataset.missing).reduce((a: number, b: any) => a + b, 0), 0)]] : [['Source rows', '—'], ['Predictors', '—'], ['Target variable', '—'], ['Missing cells', '—']];
  const scatter = (x: any, y: any) => ({ x, y, type: 'scatter', mode: 'markers', marker: { size: 5, opacity: .55, color: '#244be8' } });
  const configure = <div className="controls-row">{problem === 'custom' ? <label>Numerical target<select value={target} disabled={busy} onChange={e => { const t = e.target.value; setTarget(t); setFeatures(defaultFeatures(dataset,t)); setVariable(dataset.columns.find((c:string)=>c!==t) || t); clearAnalysis(); }}>{dataset?.targets.map((c: string) => <option key={c}>{c}</option>)}</select></label> : <div className="configured-target"><span>Target variable</span><strong data-testid="configured-target">{target}</strong></div>}<label>Test partition<select value={split} disabled={busy || savedMode} onChange={e => setSplit(+e.target.value)}>{[.1, .2, .25, .3, .4].map(v => <option key={v} value={v}>{Math.round((1-v)*100)}% train / {v*100}% test</option>)}</select></label><label>Random seed<input type="number" min="0" max="4294967295" value={seed} disabled={busy || savedMode} onChange={e => setSeed(+e.target.value)} /></label></div>;
  function inputGroup(name: string, inputs: any[]) {
    if (!inputs.length) return null;
    return <section className="input-group" key={name}><h3>{name}</h3><div className="input-grid">{inputs.map((input: any) => <label key={input.name}>{human(input.name)}{input.type === 'category' ? <select aria-label={human(input.name)} value={values[input.name] ?? ''} onChange={e => { setValues({ ...values, [input.name]: e.target.value }); setPrediction(null); }}>{STATIC_MODE && <option value="">Missing / training mode imputation</option>}{input.options.map((v: string) => <option key={v}>{v}</option>)}</select> : <><input aria-label={human(input.name)} type="number" step="any" value={values[input.name] ?? ''} onChange={e => { setValues({ ...values, [input.name]: e.target.value }); setPrediction(null); }} /><small>Training range {number(input.min)} – {number(input.max)}</small></>}</label>)}</div></section>;
  }
  function renderStage() {
    if (stage === 0) return <>
      <Hero><div ref={primarySelector}><ProblemSelector value={problem} disabled={busy} onChange={changeProblem}/></div></Hero>
      <div className="ticker"><span>01 / CHOOSE A PROBLEM</span><span>02 / CONFIGURE YOUR DATA</span><span>03 / RUN. READ. REPEAT.</span></div>
      <div className="stats">{statisticCards.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <section id="problem-selection" className="surface problem-section"><div className="section-heading"><div><span className="eyebrow">01 / YOUR RESEARCH PROBLEM</span><h3>Pick your question.</h3></div><Database size={22}/></div>
        <ModeCards value={problem} disabled={busy} onChange={changeProblem}/>

        {problem !== 'custom' && <div className="preconfigured-summary"><span className="eyebrow">Preconfigured Dataset</span><h3>{problem==='trust' ? 'Human–AI Interaction' : 'Startup Profit'}</h3><p>Target: <b>{problem==='trust' ? 'latent_trust_score' : 'Profit'}</b>{dataset && ` · ${number(dataset.rows,0)} rows · ${features.length} predictors`}</p>{busy && !dataset && <p role="status">Loading preconfigured dataset…</p>}{!busy && !dataset && <Button variant="outline" onClick={()=>load()}>Retry Dataset</Button>}</div>}
      </section>
      {problem === 'custom' && <section className="surface"><span className="eyebrow">YOUR DATA / YOUR EXPERIMENT</span><h3>Import your dataset</h3>{STATIC_MODE && <Note>CSV analysis runs on this device in a Web Worker. Your file is not sent to a server. Limits: 10 MB, 20,000 rows, 40 columns, 60 encoded predictors and 1,000,000 cells. Larger analyses remain available in local full mode.</Note>}<p>Upload a UTF-8 CSV with at least 12 labeled rows and a numerical target. We detect column types and validate the data before fitting.</p>{!STATIC_MODE && <div className="action-row" role="group" aria-label="Import method"><Button variant={source==='url'?'default':'outline'} aria-pressed={source==='url'} disabled={busy} onClick={()=>changeSource('url')}>CSV URL</Button><Button variant={source==='upload'?'default':'outline'} aria-pressed={source==='upload'} disabled={busy} onClick={()=>changeSource('upload')}>Upload CSV File</Button></div>}
        {!STATIC_MODE && source === 'url' ? <label>Direct public HTTPS CSV URL<input type="url" disabled={busy} placeholder="https://raw.githubusercontent.com/…/dataset.csv" value={url} onChange={e=>setUrl(e.target.value)}/></label> : <label>{STATIC_MODE ? 'UTF-8 CSV / up to 10 MB, 20,000 rows, 40 columns' : 'UTF-8 CSV / up to 150 MB'}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>setFile(e.target.files?.[0] || null)}/>{file && <small>Selected file: {file.name}</small>}</label>}
        <div className="action-row"><Button disabled={busy} onClick={()=>load()}><Database size={16}/>Load Dataset</Button><span>{dataset ? 'Importing new data replaces this custom configuration only after successful validation.' : 'Import a suitable CSV to configure your regression problem.'}</span></div>
      </section>}
      {dataset && <section className="surface"><h3>{problem === 'custom' ? 'Custom Dataset · analysis configuration' : 'Analysis configuration'}</h3>{configure}<p>Detected {dataset.numeric.length} numerical and {dataset.columns.length-dataset.numeric.length} categorical columns. {savedMode ? 'Saved predictors are read-only. Inspect their rankings in Feature Selection.' : 'Inspect your predictors below or fine-tune preprocessing in Data Preparation.'}</p>{Object.keys(dataset.unsuitable_features).length>0 && <Note>Excluded from default predictors: {Object.entries(dataset.unsuitable_features).map(([c,why])=>`${c} (${why})`).join(', ')}. No source columns are silently deleted.</Note>}<details className="feature-details" open={problem==='custom'}><summary>{features.length} selected predictors / inspect & edit</summary><div className="feature-grid">{dataset.columns.filter((c:string)=>c!==target).map((c:string)=><label className="checkbox" key={c}><input type="checkbox" checked={features.includes(c)} disabled={busy || savedMode || dataset.identifiers.includes(c) || !!dataset.unsuitable_features[c]} onChange={e=>setFeatures(e.target.checked?[...features,c]:features.filter(x=>x!==c))}/>{human(c)}<small>{dataset.types[c]}{dataset.identifiers.includes(c)?' / identifier excluded':dataset.unsuitable_features[c]?' / excluded':''}</small></label>)}</div>{!features.length && <Note>Select at least one predictor to run analysis.</Note>}</details><div className="source-line"><Check size={16}/><span>{dataset.meta.name} · {number(dataset.rows,0)} rows · {dataset.meta.source.startsWith('https://') ? <a href={dataset.meta.source} target="_blank" rel="noreferrer">Source <ExternalLink size={12}/></a> : dataset.meta.source}</span></div><div className="action-row"><Button disabled={busy || !features.length} onClick={train}><Play size={16}/>{savedMode ? 'View Saved Results' : 'Run Analysis'}</Button><Button variant="outline" disabled={busy} onClick={()=>setStage(2)}>{savedMode ? 'Inspect saved features' : 'Configure features'}</Button><span>{features.length} raw predictors · k={k} · {scale ? 'scaled' : 'original units'}</span></div></section>}
      {dataset && <section className="surface"><h3>{problem==='custom'?'Imported data preview':'Dataset preview'}</h3><Table columns={dataset.columns} rows={preview.map(row=>dataset.columns.map((c:string)=>row[c]))}/><Button variant="outline" onClick={()=>setStage(1)}>Explore imported dataset</Button></section>}
      <Note>{(dataset ? dataset.meta.problem === 'trust' : problem === 'trust') ? 'Human–AI Interaction is a synthetic educational dataset. Trust scores describe statistical associations, not causal effects or validated behavior of real users.' : 'Educational regression analysis. Check source provenance and variable meaning; associations do not establish causation.'}</Note>
      <div className="journey">{['Understand', 'Prepare', 'Model', 'Evaluate'].map((x, i) => <button key={x} onClick={() => setStage([1,2,4,5][i])}><span>0{i+1}</span><strong>{x}</strong><ArrowRight size={17}/></button>)}</div>
    </>;
    if (!dataset) return <section className="empty surface"><Database size={40}/><h2>Begin with a documented dataset</h2><p>Built-in problems load automatically. Choose Custom Problem to import a CSV URL or upload your dataset.</p><Button onClick={() => setStage(0)}>Choose dataset <ArrowRight size={16}/></Button></section>;
    if (stage === 1) return <>
      <div className="section-heading"><div><h2>Meet your data</h2><p>{number(dataset.rows,0)} rows · {dataset.columns.length} columns · {dataset.duplicates} exact duplicate rows</p></div><span className="pill">Visualization sample ≤ 1,500</span></div>
      <section className="surface"><h3>Data preview</h3><Table columns={dataset.columns} rows={preview.map(row => dataset.columns.map((c: string) => row[c]))}/><div className="action-row"><Button variant="outline" disabled={!page} onClick={() => setPage(page-1)}>Previous</Button><span>Page {page+1} of {Math.ceil(dataset.rows/10)}</span><Button variant="outline" disabled={(page+1)*10 >= dataset.rows} onClick={() => setPage(page+1)}>Next</Button></div></section>
      <div className="chart-grid"><Chart title={`${target} distribution`} data={[{ x: dataset.sample[target], type:'histogram', marker: {color:'#244be8'}, nbinsx: 40 }]} xTitle={target} yTitle="Sample count"/><Chart title="Numerical correlations · full dataset (up to 40 columns)" data={[{ type:'heatmap', x: dataset.correlation.columns, y:dataset.correlation.columns, z:dataset.correlation.values, zmin:-1, zmax:1, colorscale:'Tealrose', reversescale:true }]} layout={{height:430,margin:{t:10,b:145,l:145,r:15}}}/></div>
      <label className="inline-control">Explore feature<select value={variable} onChange={e => setVariable(e.target.value)}>{dataset.columns.filter((c: string) => c !== target).map((c: string) => <option key={c}>{c}</option>)}</select></label><div className="chart-grid"><Chart title={`${human(variable)} distribution`} data={dataset.numeric.includes(variable) ? [{x:dataset.sample[variable],type:'histogram',nbinsx:35}] : [{type:'bar',x:dataset.categories[variable]?.map((v:any)=>v.value),y:dataset.categories[variable]?.map((v:any)=>v.count)}]} xTitle={variable} yTitle={dataset.numeric.includes(variable) ? 'Sample count' : 'Full dataset count (top 30 levels)'}/><Chart title={`${human(variable)} vs. target`} data={dataset.numeric.includes(variable) ? [scatter(dataset.sample[variable],dataset.sample[target])] : [{type:'box',x:dataset.sample[variable],y:dataset.sample[target],boxpoints:false}]} xTitle={variable} yTitle={target}/></div>
      <section className="surface"><h3>Statistical summary & missing values</h3><Table columns={['Feature','Type','Missing','Mean','Std','Min','Median','Max']} rows={dataset.columns.map((c: string) => [c,dataset.types[c],dataset.missing[c],dataset.summary[c]?.mean,dataset.summary[c]?.std,dataset.summary[c]?.min,dataset.summary[c]?.['50%'],dataset.summary[c]?.max])}/></section>
      {dataset.meta.problem === 'trust' && <section className="surface"><h3>Understanding human–AI trust</h3><p>Explore human experience, AI performance and explainability, interaction quality, and task context. Category effects compare with an omitted reference level. These are associations in synthetic data, not evidence of causation or differences in real populations.</p><p>Documented target scale: 0–100. Missing targets are excluded from training. No prediction or interval is clipped.</p></section>}
    </>;
    if (stage === 2 || stage === 3) return <>
      <div><h2>{stage === 2 ? 'Prepare with care' : 'Select with evidence'}</h2><p>{savedMode ? 'These are the fixed settings of the saved analysis. Changing predictors, k, split, seed, or scaling requires a new Python export or local full mode.' : 'Configuration changes take effect when you run analysis.'} The held-out test set is never used to choose k.</p></div>
      <section className="surface">{configure}<div className="controls-row"><label className="checkbox"><input type="checkbox" checked={dedup} disabled={busy || savedMode} onChange={e => setDedup(e.target.checked)}/>Remove exact predictor/target duplicates before splitting</label><label className="checkbox"><input type="checkbox" checked={scale} disabled={busy || savedMode} onChange={e => setScale(e.target.checked)}/>Scale numerical features using training statistics</label></div><h3>Predictor columns <span className="muted">{features.length} included</span></h3><div className="feature-grid">{dataset.columns.filter((c: string) => c !== target).map((c: string) => <label className="checkbox" key={c}><input type="checkbox" checked={features.includes(c)} disabled={busy || savedMode || dataset.identifiers.includes(c) || !!dataset.unsuitable_features[c]} onChange={e => setFeatures(e.target.checked ? [...features,c] : features.filter(x => x !== c))}/>{human(c)}{(dataset.identifiers.includes(c) || dataset.unsuitable_features[c]) && <small>{dataset.unsuitable_features[c] || "Identifier excluded"}</small>}</label>)}</div><div className="controls-row"><label>Selected encoded features (k)<input type="number" min="1" max={STATIC_MODE ? 60 : 100} value={k} disabled={busy || savedMode} onChange={e => setK(+e.target.value)}/></label><p>Model A retains all nonconstant encoded features. Model B uses SelectKBest with f_regression. k is capped at the available encoded feature count.</p></div><Button disabled={busy || !features.length || !Number.isInteger(k) || k < 1 || k > 100} onClick={train}><Play size={16}/>{savedMode ? 'View Saved Results' : 'Run Analysis'}</Button></section>
      <Note>Missing targets are removed; numerical predictors use median imputation, categorical predictors use most-frequent imputation and drop-first one-hot encoding. Transformations fit on training data only. High-cardinality text and IDs are rejected.</Note>
      {result && <><section className="surface"><h3>Last completed preprocessing</h3><p>{result.train_count.toLocaleString()} training / {result.test_count.toLocaleString()} testing rows · {result.duplicates_removed} duplicates removed · {result.removed_missing_targets} missing targets removed · {result.constant_columns_removed} constant columns removed · {result.encoded_features} encoded features.</p><p>{result.methodology}</p></section><Chart title="Training-only univariate feature rankings" data={[{type:'bar',x:result.rankings.map((r: any)=>r.score),y:result.rankings.map((r: any)=>r.feature),orientation:'h',marker:{color:result.rankings.map((r: any)=>r.selected?'#244be8':'#d5d0c2')}}]} xTitle="F statistic · not causal importance" layout={{height:Math.max(350,result.rankings.length*24),margin:{t:10,b:70,l:205,r:20},yaxis:{autorange:'reversed',automargin:true}}}/><Table columns={['Feature','F score','Selected']} rows={result.rankings.map((r: any)=>[r.feature,r.score,r.selected?'Yes':'No'])}/><Note>Selection may improve or worsen held-out performance. Correlated predictors can receive similar univariate scores. Selection acts on encoded columns, so individual category levels can be selected.</Note></>}
    </>;
    if (!result) return <section className="empty surface"><FlaskConical size={40}/><h2>Your model is ready to be built</h2><p>Select your predictors and run analysis to calculate real metrics and prediction intervals.</p><Button disabled={busy || !features.length} onClick={train}><Play size={16}/>{savedMode ? 'View Saved Results' : 'Run Analysis'}</Button></section>;
    if (stage === 4) return <><h2>An interpretable regression</h2><Equation model={m} target={result.target}/><section className="surface"><div className="equation">ŷ = {number(m.intercept)} + Σ βⱼxⱼ</div><p>Predicted {result.target} = intercept + weighted sum of the retained encoded predictors.</p><p>{m.coefficients.length} retained columns · {result.train_count.toLocaleString()} training rows · seed {result.seed} · {result.scale ? 'standardized numerical inputs' : 'original numerical units'}</p></section><Chart title="OLS coefficient estimates" data={[{type:'bar',orientation:'h',x:m.coefficients.map((c: any)=>c.coefficient),y:m.coefficients.map((c: any)=>c.feature)}]} xTitle="Coefficient in model units" layout={{height:Math.max(350,m.coefficients.length*25),margin:{t:10,b:60,l:205,r:20},yaxis:{autorange:'reversed',automargin:true}}}/><Table columns={['Encoded predictor','Coefficient','Approx. VIF (train sample)']} rows={m.coefficients.map((c: any)=>[c.feature,c.coefficient,c.vif])}/><Note>Coefficients depend on units, encoding, and collinearity. They are not causal effects or automatically comparable feature importance. Large VIF values suggest multicollinearity; VIF is unavailable for singular sampled correlation matrices. Category coefficients are relative to the omitted training reference level.</Note></>;
    if (stage === 5) {
      const sample = m.sample;
      const order = sample.predicted.map((_: any,i: number)=>i).sort((a: number,b: number)=>sample.predicted[a]-sample.predicted[b]);
      const sorted = (key: string) => order.map((i: number)=>sample[key]?.[i]);
      const coverage = m.coverage == null ? 'Unavailable' : `${number(m.coverage*100,2)}%`;
      return <><div className="section-heading"><div><span className="eyebrow">THE EVIDENCE / HELD-OUT EVALUATION</span><h2>Results with something to say.</h2><p>Metrics use all {result.test_count.toLocaleString()} held-out rows. Figures show up to 300 representative points.</p></div><span className="pill">95% prediction intervals</span></div><ResultMetrics model={m}/><Interpretation model={m} result={result}/><Equation model={m} target={result.target}/><section className="surface"><h3>Feature coefficients</h3><Table columns={['Encoded predictor','Coefficient','Approx. VIF']} rows={m.coefficients.map((c:any)=>[c.feature,c.coefficient,c.vif])}/></section><section className="surface"><h3>Dataset preview</h3><Table columns={dataset.columns} rows={preview.map(row=>dataset.columns.map((c:string)=>row[c]))}/></section><section className="surface"><h3>All features vs. selected features</h3><Table columns={['Model','R²','MAE','MSE','RMSE','Train RMSE','CV RMSE ± SD']} rows={Object.entries(result.models).map(([key,v]: any)=>[key==='all'?'A · All features':'B · Selected features',v.metrics.r2,v.metrics.mae,v.metrics.mse,v.metrics.rmse,v.train_metrics.rmse,v.cv.unavailable || `${number(v.cv.rmse_mean)} ± ${number(v.cv.rmse_std)}`])}/><p>Three-fold CV fits preprocessing and selection within each training fold, using up to 20,000 training rows. Test metrics remain separate. A negative R² is possible.</p></section><div className="chart-grid"><Chart title="Actual vs. predicted" data={[scatter(sample.actual,sample.predicted),{type:'scatter',mode:'lines',x:[Math.min(...sample.actual),Math.max(...sample.actual)],y:[Math.min(...sample.actual),Math.max(...sample.actual)],line:{dash:'dash',color:'#96a6af'}}]} xTitle="Actual" yTitle="Predicted"/><Chart title="Residual vs. predicted" data={[scatter(sample.predicted,sample.residual)]} xTitle="Predicted" yTitle="Actual − predicted"/><Chart title="Residual distribution" data={[{type:'histogram',x:sample.residual,nbinsx:35}]} xTitle="Residual" yTitle="Sample count"/><Chart title="Normal Q-Q plot" data={[scatter(m.qq.theoretical,m.qq.observed)]} xTitle="Theoretical normal quantile" yTitle="Ordered residual"/></div>
      {m.intervals_valid ? <Chart title="Held-out observations and 95% prediction intervals" data={[{x:sorted('predicted'),y:sorted('obs_ci_lower'),type:'scatter',mode:'lines',line:{width:0},name:'Lower bound'},{x:sorted('predicted'),y:sorted('obs_ci_upper'),type:'scatter',mode:'lines',line:{width:0},fill:'tonexty',fillcolor:'rgba(14,153,160,0.18)',name:'95% prediction interval'},scatter(sorted('predicted'),sorted('actual'))]} xTitle="Predicted value (sorted sample)" yTitle={result.target}/> : <Note>Prediction intervals are disabled because the design matrix is rank deficient. Remove redundant predictors.</Note>}
      <section className="surface"><h3>Assumptions & uncertainty</h3><div className="detail-grid"><p><b>Observed interval coverage</b><br/>{coverage} of all held-out observations</p><p><b>Mean interval width</b><br/>{number(m.mean_interval_width)}</p><p><b>Design rank / columns</b><br/>{m.diagnostics.rank} / {m.diagnostics.design_columns}</p><p><b>Condition number</b><br/>{number(m.diagnostics.condition_number)}</p><p><b>Breusch–Pagan p-value</b><br/>{number(m.diagnostics.breusch_pagan_p,6)} ({m.diagnostics.diagnostic_sample_rows} training rows)</p></div><p>Inspect residual plots for nonlinearity, changing variance, outliers, and non-normal tails. Independence depends on how records were generated and cannot be established by these plots. A small Breusch–Pagan p-value suggests nonconstant variance; a large value does not prove assumptions hold.</p><p>{result.interval_caveat}</p><p>A <b>confidence interval</b> estimates the conditional mean response; a <b>prediction interval</b> also includes variation in a new individual observation.</p></section>
      <section className="surface"><h3>Prediction interval sample</h3><Table columns={['Observed','Predicted','Lower 95% PI','Upper 95% PI']} rows={sample.actual.slice(0,20).map((v: number,i: number)=>[v,sample.predicted[i],sample.obs_ci_lower?.[i],sample.obs_ci_upper?.[i]])}/></section>
      <Note>R² measures fit relative to a constant-mean prediction. MAE is average absolute error. MSE weights large errors more heavily; RMSE is in target units. {trust && `OLS is unbounded: ${m.out_of_bounds} held-out predictions fall outside [0,100]. Predictions and intervals are never clipped.`}</Note></>;
    }
    if (stage === 6) {
      const groups: Record<string,string[]> = { 'Human factors': ['age','education_level','technical_experience','prior_ai_exposure','cognitive_load'], 'AI factors': ['model_accuracy','explainability_score','bias_level','decision_latency','error_rate'], 'Interaction factors': ['interaction_frequency','ui_complexity','feedback_quality','trust_history','override_frequency'] };
      const grouped = Object.values(groups).flat();
      return <><h2>A new observation</h2><p>Inputs and defaults come from the fitted training partition. Current fit: {result.train_count.toLocaleString()} training rows, seed {result.seed}, k={result.k}, {result.scale ? "scaled" : "original units"}. {model === 'selected' ? 'Model B uses its selected encoded predictors.' : 'Model A uses all retained encoded predictors.'}</p>{trust ? <>{Object.entries(groups).map(([name,cols])=>inputGroup(name,result.inputs.filter((i: any)=>cols.includes(i.name))))}<details className="surface" open><summary>Advanced settings · task context</summary>{inputGroup('Contextual factors',result.inputs.filter((i: any)=>!grouped.includes(i.name)))}</details></> : inputGroup('Observation inputs',result.inputs)}<Button disabled={busy || (!STATIC_MODE && Object.values(values).some(x=>x===''))} onClick={makePrediction}><FlaskConical size={17}/>Predict</Button>
      {STATIC_MODE && <Note>Predictions run in this browser using the fitted training parameters. Blank numerical/category inputs use fitted training medians/modes. No model is retrained. The 95% intervals use the fitted OLS covariance, residual variance and Student-t critical value; the browser implementation is checked against Python.</Note>}
      {prediction && <section className="prediction-result"><span className="eyebrow">MODEL {model==='all'?'A · ALL FEATURES':'B · SELECTED FEATURES'}</span><h3>Predicted {trust ? "AI Trust Score" : result.target}</h3><strong>{number(prediction.prediction,6)}</strong>{trust && <p>Trust score · documented scale 0–100</p>}<p>95% prediction interval: {prediction.prediction_interval ? prediction.prediction_interval.map((v: number)=>number(v,6)).join(' to ') : 'Unavailable for rank-deficient design'}</p><p>95% mean confidence interval: {prediction.confidence_interval ? prediction.confidence_interval.map((v: number)=>number(v,6)).join(' to ') : 'Unavailable'}</p>{prediction.imputed_features?.length>0 && <Note>Training imputation applied: {prediction.imputed_features.join(', ')}.</Note>}{prediction.extrapolated_features.length>0 && <Note>Extrapolation beyond observed training ranges: {prediction.extrapolated_features.join(', ')}. Interpret cautiously.</Note>}{trust && (prediction.prediction<0 || prediction.prediction>100 || prediction.prediction_interval?.some((v: number)=>v<0 || v>100)) && <Note>The prediction or interval extends beyond [0,100]. This is an unbounded OLS estimate; it has not been clipped and should be interpreted cautiously on the trust-score scale.</Note>}<p>This is an estimated conditional outcome, subject to regression assumptions and new-observation variation.</p></section>}
      <Note>{trust ? 'Synthetic research data. This estimate does not validate real user trust.' : 'Educational regression estimate. Associations do not establish causation.'} {result.interval_caveat}</Note></>;
    }
    return <><div className="section-heading"><div><h2>The complete research story</h2><p>A dataset-specific record of the six CRISP-DM stages.</p></div><div className="action-row"><Button onClick={()=>exportReport()}><Download size={16}/>Export Markdown</Button><Button variant="outline" onClick={()=>exportReport('html')}>Export HTML</Button></div></div>{[
      ['Business Understanding',`Estimate ${result.target} from ${result.features.length} original predictors. ${trust?'Understand factors associated with human trust in AI using synthetic educational data; no causal or real-population claims.':'Explore associations in this regression problem; no causal claims are made.'}`],
      ['Data Understanding',`${dataset.meta.name}: ${number(dataset.rows,0)} rows, ${dataset.columns.length} columns, ${dataset.duplicates} duplicates. Source: ${dataset.meta.source}. Inspect missingness, distributions, and full numerical correlations in Data Understanding.`],
      ['Data Preparation',`${result.duplicates_removed} duplicates and ${result.removed_missing_targets} missing targets removed. Reproducible ${result.train_count}/${result.test_count} train/test split (seed ${result.seed}). ${result.methodology}`],
      ['Modeling',`All-feature and SelectKBest (k=${result.k}) Multiple Linear Regression. ${result.reproducibility?.engine==='browser-ols-svd-v1'?'Fitted in this browser with SVD and OLS covariance intervals.':'sklearn LinearRegression matched to statsmodels OLS.'} Intercept and encoded coefficients are available in Modeling.`],
      ['Evaluation',`All-feature test RMSE: ${number(all.metrics.rmse,6)}; selected-feature test RMSE: ${number(selected.metrics.rmse,6)}. Selection ${selected.metrics.rmse<all.metrics.rmse?'reduced':'did not reduce'} held-out RMSE for this run. Both use all ${result.test_count} held-out rows. Do not tune k against these test results. ${result.interval_caveat}`],
      ['Deployment',STATIC_MODE ? 'GitHub Pages browser mode: built-in analyses come from preserved JSON. Uploaded CSVs are actually trained in a local Web Worker, including preprocessing, feature selection and OLS. Files and models remain in browser memory. No backend is required.' : 'The interactive frontend supports two preconfigured regression problems and a custom problem, public CSV import, upload, retraining, dynamic inputs, and report export. This running instance uses ephemeral sessions. Reproduce using the recorded source, checksum, seed, preprocessing, and features. No public hosting is claimed.']
      ].map(([name,text],i)=><section className="report-section" key={name}><span className="report-number">0{i+1}</span><div><h3>{name}</h3><p>{text}</p></div></section>)}<section className="surface"><h3>Methodological limits</h3><p>OLS does not constrain bounded outcomes. Interval validity depends on linearity, independence, homoskedasticity, and approximate normality. Selection uncertainty is omitted by classical conditional intervals. Coefficients and univariate F scores are not causal feature importance. Data source licensing must be checked before redistribution.</p><p>Export includes configuration, metrics, coefficients, diagnostics, and JSON figure data. Figures can be downloaded as PNG using each Plotly toolbar.</p></section></>;
  }
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setStage(0);}}><span className="brand-icon"><BrainCircuit size={25}/></span><span>REGRESSION LAB<small>AIoT / HW2 ? THE DATA EDITION</small></span></a><span className="nav-label">FOLLOW THE EXPERIMENT</span><nav aria-label="Analysis stages">{stages.map((name,i)=>{const Icon=icons[i];return <button aria-current={stage===i?'page':undefined} className={stage===i?'active':''} key={name} onClick={()=>setStage(i)}><Icon size={18}/><span>{name}</span><small>{String(i+1).padStart(2,'0')}</small></button>;})}</nav><div className="sidebar-bottom"><span className="status-dot"/><span>Ordinary least squares<br/><small>Evidence over guesswork</small></span></div></aside><div className="main-shell"><header className="sticky-header"><div><h1>Human–AI Trust Prediction Lab</h1><p>Interactive Multiple Linear Regression Analysis</p></div><div className="header-actions">{showStickySelector && <ProblemSelector value={problem} disabled={busy} onChange={changeProblem} compact/>}<span className="pill">AIoT HW2</span><Button size="icon" variant="ghost" aria-label="Toggle color theme" onClick={()=>setDark(!dark)}>{dark?<Sun size={19}/>:<Moon size={19}/>}</Button></div></header><main><div className="breadcrumb"><span>Workspace</span><span>/</span><b>{stages[stage]}</b><span className={`live-status ${busy?'is-busy':''}`} role="status" aria-live="polite">{busy?<LoaderCircle size={13} className="spin"/>:<span className="status-dot"/>}{status}</span></div>{busy && <div className="progress-banner" role="progressbar" aria-label={status}><LoaderCircle className="spin" size={20}/><div><b>{job?'BUILDING YOUR MODEL':'PREPARING THE EXPERIMENT'}</b><span>{status}</span></div><div className="progress-track"><span/></div></div>}{error && <div className="error" role="alert"><AlertCircle size={19}/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}{result && stage>=4 && <div className="model-bar"><span>Fitted target: <b>{result.target}</b></span><label>View model<select aria-label="View model" value={model} onChange={e=>{setModel(e.target.value);setPrediction(null);}}><option value="all">Model A — All features</option><option value="selected">Model B — Selected features</option></select></label></div>}{renderStage()}<footer><span>Human–AI Trust Prediction Lab <span className="muted">/</span> AIoT HW2</span><span>Reproducible by design · Seed {result?.seed ?? seed}</span></footer></main></div></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);


