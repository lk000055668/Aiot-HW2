import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import Papa from 'papaparse';
const root=path.resolve(import.meta.dirname,'..');
const compiled=await build({entryPoints:[path.join(root,'src/lib/browser-analysis.ts')],bundle:true,platform:'node',format:'esm',write:false});
const engine=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const manifest=read(path.join(root,'public/static/index.json'));
const bundles=Object.fromEntries(Object.entries(manifest.datasets).map(([name,item])=>[name,read(path.join(root,'public/static',item.bundle))]));
const defaults={k:4,seed:42,test_size:.2,scale:false,deduplicate:true};
const specifications=[
  {name:'startup-full',problem:'startup'},
  {name:'startup-selected-k2-scaled',problem:'startup',config:{k:2,scale:true,seed:17,test_size:.3}},
  {name:'startup-alternate-target',problem:'startup',target:'Administration',config:{k:2,scale:true,seed:17,test_size:.3}},
  {name:'startup-missing-duplicates',problem:'startup',missing:true,duplicates:true},
  {name:'startup-rank-deficient',problem:'startup',redundant:true},
  {name:'trust-400',problem:'trust',count:400,config:{k:8}},
  {name:'trust-400-scaled',problem:'trust',count:400,config:{k:10,scale:true}},
];
const outputs=[];
for(const spec of specifications){
  let rows=structuredClone(bundles[spec.problem].preview_rows.slice(0,spec.count));
  const columns=[...bundles[spec.problem].dataset.columns];
  if(spec.missing){rows[1][columns[0]]=null;rows[3][columns[1]]=null;rows[5][columns[3]]=null;rows[8][columns.at(-1)]=null;}
  if(spec.duplicates)rows.push(structuredClone(rows[10]),structuredClone(rows[11]));
  if(spec.redundant){columns.push('duplicate_research');rows=rows.map(r=>({...r,duplicate_research:r['R&D Spend']}));}
  const csv=Papa.unparse({fields:columns,data:rows.map(r=>columns.map(c=>r[c]))});
  const parsed=engine.parseBrowserCsv(csv,`TEST ONLY: ${spec.name}`,'test-source-see-static-manifest');
  const target=spec.target || bundles[spec.problem].result.target;
  const config={...defaults,...spec.config,target,features:parsed.dataset.columns.filter(c=>c!==target&&!parsed.dataset.unsuitable_features[c])};
  const artifact=engine.trainBrowser(parsed.rows,parsed.dataset,config);
  const values=Object.fromEntries(artifact.result.inputs.map(x=>[x.name,x.default]));
  const predictions=[];
  for(const model of ['all','selected'])for(const missing of [false,true]){
    const input=missing?Object.fromEntries(Object.keys(values).map(k=>[k,null])):values;
    predictions.push({model,values:input,output:engine.predictStatic(artifact.runtime,input,model)});
  }
  const repeated=engine.trainBrowser(parsed.rows,parsed.dataset,config);
  assert.deepEqual(repeated.result.models,artifact.result.models,'Seeded training must be deterministic');
  assert.equal(artifact.result.reproducibility.test_source_indices.some(i=>artifact.result.reproducibility.train_source_indices.includes(i)),false,'Split leakage');
  const html=engine.browserReport(parsed.dataset,artifact,'html');assert.ok(html.includes('Evaluation')&&html.includes('browser'));
  outputs.push({name:spec.name,rows:parsed.rows,dataset:parsed.dataset,config,artifact,predictions});
}
assert.throws(()=>engine.parseBrowserCsv('a,a\n1,2'),'Duplicate headers');
assert.throws(()=>engine.parseBrowserCsv('a,b\n1,2'),'Too few rows');
assert.throws(()=>engine.parseBrowserCsv('a,b\n"unclosed,2'),'Malformed quotes');
const malicious=engine.parseBrowserCsv(Papa.unparse({fields:['x','y'],data:Array.from({length:30},(_,i)=>[i,i*i])}),'<script>alert(1)</script>');
const escaped=engine.browserReport(malicious.dataset,engine.trainBrowser(malicious.rows,malicious.dataset,{...defaults,k:1,target:'y',features:['x']}),'html');
assert.ok(!escaped.includes('<script>')&&escaped.includes('&lt;script&gt;'));
const outputArg=process.argv.indexOf('--output');
if(outputArg>=0){fs.writeFileSync(process.argv[outputArg+1],JSON.stringify(outputs));console.log(`Wrote ${outputs.length} actual-data analysis cases for independent Python verification.`);}
else{
  const reference=read(path.join(root,'tests-static/fixtures/browser-oracle.json'));
  let checks=0,maxRelativeError=0;
  const close=(a,b,label)=>{
    if(b===null){assert.equal(a,null,label);return;}
    if(Array.isArray(b)){assert.equal(a.length,b.length,label);b.forEach((v,i)=>close(a[i],v,`${label}[${i}]`));return;}
    if(typeof b==='object'){for(const key of Object.keys(b))close(a[key],b[key],`${label}.${key}`);return;}
    if(typeof b==='number'){
      assert.ok(Number.isFinite(a),`${label}: nonfinite`);const rel=Math.abs(a-b)/Math.max(1,Math.abs(b));maxRelativeError=Math.max(maxRelativeError,rel);
      assert.ok(Math.abs(a-b)<=2e-5+Math.abs(b)*1e-6,`${label}: ${a} != ${b}`);checks++;return;
    }assert.deepEqual(a,b,label);
  };
  for(const test of outputs){const expected=reference.cases.find(c=>c.name===test.name);assert.ok(expected,test.name);
    for(const model of ['all','selected']){
      const actual=test.artifact.result.models[model],oracle=expected.models[model];
      close(actual.metrics,oracle.metrics,`${test.name}/${model}/metrics`);close(actual.adjusted_r2,oracle.adjusted_r2,`${test.name}/${model}/adjusted_r2`);
      // Rank-deficient coefficients are not uniquely identified, so compare predictions rather than arbitrary minimum-norm representatives.
      if(actual.intervals_valid)close(actual.coefficients.map(c=>c.coefficient),oracle.coefficients,`${test.name}/${model}/coefficients`);
      close(actual.cv,oracle.cv,`${test.name}/${model}/cv`);
      close(actual.sample,oracle.sample,`${test.name}/${model}/charts`);
      close(actual.intervals_valid,oracle.intervals_valid,`${test.name}/${model}/interval availability`);
    }
    test.predictions.forEach((prediction,i)=>close(prediction.output,expected.predictions[i],`${test.name}/prediction-${i}`));
    close(test.artifact.result.rankings,expected.rankings,`${test.name}/feature rankings`);
  }
  console.log(JSON.stringify({status:'passed',actual_data_cases:outputs.length,python_numerical_checks:checks,max_relative_error:maxRelativeError,parser_validation:'passed',seed_determinism:'passed',html_escaping:'passed'},null,2));
}
