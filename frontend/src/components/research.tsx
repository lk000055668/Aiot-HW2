import type { ReactNode } from 'react';
import { ArrowDown, ArrowUpRight, Check, Database, Upload } from 'lucide-react';
import { Button } from './ui/button';

export const modes = [
  { id: 'startup', number: '01', title: 'Problem 1', tag: 'BUILT-IN / STARTUP PROFIT', description: 'From business spending to profit. Explore what the numbers can explain.', icon: Database },
  { id: 'trust', number: '02', title: 'Human–AI Trust Prediction', tag: 'BUILT-IN / SYNTHETIC DATA', description: 'Model trust through human experience, AI performance, and interaction.', icon: ArrowUpRight },
  { id: 'custom', number: '03', title: 'Upload by User', tag: 'YOUR CSV / YOUR QUESTION', description: 'Bring a dataset. Choose your target, select predictors, and investigate.', icon: Upload },
];

export function ProblemSelector({ value, disabled, onChange, compact = false }: { value:string; disabled:boolean; onChange:(id:string)=>void; compact?:boolean }) {
  const id = compact ? 'sticky-problem' : 'primary-problem';
  const selected = modes.find(mode => mode.id === value)!;
  return <div className={`problem-selector ${compact ? 'problem-selector-compact' : ''}`}>
    <label htmlFor={id}>CHOOSE YOUR PROBLEM</label>
    <select id={id} value={value} disabled={disabled} onChange={event=>onChange(event.target.value)} aria-describedby={compact ? undefined : `${id}-description`}>
      {modes.map(mode=><option key={mode.id} value={mode.id}>{mode.id==='startup'?'HW1 50-Startups':mode.title}</option>)}
    </select>
    {!compact && <p id={`${id}-description`} aria-live="polite">{selected.description} {value==='custom'?'Upload your CSV and choose the target and features.':'The dataset and target load automatically; no upload is needed.'}</p>}
  </div>;
}

export function Hero({ children }: { children?:ReactNode }) {
  return <section className="hero"><div className="hero-copy"><span className="eyebrow">AIoT HW2 / DATA MODELING / VOL. 02</span><h2>MULTIPLE<br/>LINEAR<br/><span>REGRESSION</span><span className="hero-period">.</span></h2>{children}<p>Big questions. Real coefficients.<br/>Turn data into predictions—and understand what they mean.</p><Button onClick={() => document.getElementById('problem-selection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Start Analysis <ArrowDown size={20}/></Button><span className="hero-footnote">TWO BUILT-IN PROBLEMS. ONE DATA EXPLORER.</span></div><div className="regression-art" aria-label="Illustration of a fitted regression line"><span className="art-label">FIND YOUR LINE.</span><svg viewBox="0 0 360 290" role="img" aria-label="Points scattered around an upward regression line"><path d="M40 20V250H335" fill="none" stroke="currentColor" strokeWidth="3"/><path d="M65 218L315 55" fill="none" stroke="currentColor" strokeWidth="5"/>{[[75,198],[105,215],[126,153],[155,171],[183,125],[213,150],[245,88],[271,113],[301,39]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="9" fill={i%2?'#ff6534':'#fffdf5'} stroke="currentColor" strokeWidth="3"/>)}<text x="322" y="275" fontSize="18" fontWeight="900">X</text><text x="13" y="30" fontSize="18" fontWeight="900">Y</text></svg><div className="art-equation">ŷ = β₀ + β₁x₁ + … + βₚxₚ</div><span className="art-sticker">LESS GUESS.<br/>MORE EVIDENCE.</span></div></section>;
}

export function ModeCards({ value, disabled, onChange }: { value:string; disabled:boolean; onChange:(id:string)=>void }) {
  return <div className="mode-cards" role="group" aria-label="Analysis modes">{modes.map(mode => { const Icon=mode.icon; return <button key={mode.id} className={`mode-card mode-${mode.id} ${value===mode.id?'selected':''}`} disabled={disabled} aria-pressed={value===mode.id} onClick={()=>onChange(mode.id)}><div className="mode-top"><span className="mode-number">{mode.number}</span>{value===mode.id?<span className="selected-mark"><Check size={16}/> SELECTED</span>:<Icon size={27}/>}</div><span className="mode-tag">{mode.tag}</span><h4>{mode.title}</h4><p>{mode.description}</p><span className="mode-action">{value===mode.id?'CURRENT EXPERIMENT':'EXPLORE THIS PROBLEM'} <ArrowUpRight size={18}/></span></button>; })}</div>;
}

const fmt=(n:number|null,digits=4)=>n==null?'Unavailable':n.toLocaleString(undefined,{maximumFractionDigits:digits});

export function ResultMetrics({ model }: {model:any}) {
  const metrics=[['R²',model.metrics.r2,'Held-out goodness of fit'],['Adjusted R²',model.adjusted_r2,'Training fit, adjusted for model size'],['MAE',model.metrics.mae,'Average absolute test error'],['MSE',model.metrics.mse,'Average squared test error'],['RMSE',model.metrics.rmse,'Test error in target units']];
  return <div className="result-metrics">{metrics.map(([label,value,description])=><article key={label} className="metric-card"><span>{label}</span><strong>{fmt(value as number)}</strong><small>{description}</small></article>)}</div>;
}

export function Equation({model,target}:{model:any;target:string}) {
  return <section className="surface equation-panel"><span className="eyebrow">THE FITTED EQUATION / {target}</span><h3>Every prediction, explained.</h3><div className="equation" tabIndex={0} aria-label="Regression equation">ŷ = {fmt(model.intercept,6)}{model.coefficients.map((c:any)=><span key={c.feature}> {c.coefficient<0?'−':'+'} {fmt(Math.abs(c.coefficient),6)} × <b>{c.feature}</b></span>)}</div><p>Inputs use the fitted encoding{model.coefficients.length?' and retained predictors':''}. Numerical coefficients use the original units unless scaling was enabled; categorical terms compare with the omitted reference level.</p></section>;
}

export function Interpretation({model,result}:{model:any;result:any}) {
  const r2=model.metrics.r2;
  const positive=model.coefficients.filter((c:any)=>c.coefficient>0).sort((a:any,b:any)=>b.coefficient-a.coefficient);
  const negative=model.coefficients.filter((c:any)=>c.coefficient<0).sort((a:any,b:any)=>a.coefficient-b.coefficient);
  return <section className="interpretation surface"><span className="eyebrow">READ THE RESULT / NOT JUST THE NUMBER</span><h3>So, what does it mean?</h3><p className="interpretation-lead">{r2<0?'This model predicts worse than the held-out mean baseline.':`The model explains approximately ${fmt(r2*100,1)}% of the variation in ${result.target} on the held-out test set.`} Its average absolute error is <b>{fmt(model.metrics.mae)} target units</b>.</p><p>{r2>=.8?'This is a strong fit for this split.':r2>=.5?'This fit captures part of the pattern, with substantial variation left unexplained.':r2>=0?'The model has limited explanatory performance on this split.':'Review predictors, data quality, and linearity before relying on these predictions.'} Whether the error is acceptable depends on the target scale and intended use; these thresholds are descriptive, not a validation standard.</p><div className="direction-grid"><div><span className="direction-label">↗ POSITIVE ASSOCIATIONS</span><p>{positive.length?positive.slice(0,3).map((c:any)=>`${c.feature} (+${fmt(c.coefficient)})`).join(' · '):'No positive coefficients in this model.'}</p></div><div><span className="direction-label">↘ NEGATIVE ASSOCIATIONS</span><p>{negative.length?negative.slice(0,3).map((c:any)=>`${c.feature} (${fmt(c.coefficient)})`).join(' · '):'No negative coefficients in this model.'}</p></div></div><p>Holding other encoded inputs constant, a one-unit increase in a numerical input changes the fitted prediction by its coefficient. A scaled numerical input uses one training standard deviation. Category coefficients are differences from the reference category. These are model associations, not causal effects; coefficient sizes across different units are not comparable importance scores.</p></section>;
}
