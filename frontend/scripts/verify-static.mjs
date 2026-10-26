import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const exported = path.join(root, 'public/static');
const manifest = read(path.join(exported, 'index.json'));
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/static-predict.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { predictStatic } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let cases = 0, maxError = 0;
function close(actual, expected, label) {
  if (expected === null) return assert.equal(actual, null, label);
  if (Array.isArray(expected)) return expected.forEach((v,i)=>close(actual[i],v,label));
  const error = Math.abs(actual-expected);
  maxError = Math.max(maxError,error);
  assert.ok(Number.isFinite(actual) && error <= 1e-7 + Math.abs(expected)*1e-10, `${label}: ${actual} != ${expected}`);
}
for (const [problem, item] of Object.entries(manifest.datasets)) {
  const bundle = read(path.join(exported, item.bundle));
  const reference = read(path.join(exported, item.validation));
  const historical = read(path.join(exported, item.historical));
  // Every historical metric, coefficient, ranking, chart coordinate and summary survives unchanged.
  const preserved = structuredClone(bundle.result);
  for (const name of Object.keys(preserved.models)) {
    if (!('adjusted_r2' in historical.analysis.models[name])) delete preserved.models[name].adjusted_r2;
  }
  assert.deepEqual(preserved,historical.analysis, `${problem}: historical analysis changed`);
  assert.equal(bundle.preview_rows.length,bundle.dataset.rows);
  assert.equal(bundle.provenance.historical_fields_verified,true);
  for (const [runtime, vectors] of [[reference.runtime,reference.cases],[reference.scaled_runtime,reference.scaled_cases]]) {
    for (const test of vectors) {
      const actual=predictStatic(runtime,test.values,test.model);
      for (const key of ['prediction','confidence_interval','prediction_interval']) close(actual[key],test.expected[key],`${problem}/${test.model}/${test.label}/${key}`);
      cases++;
    }
    const values=Object.fromEntries(runtime.inputs.map(x=>[x.name,x.default]));
    assert.throws(()=>predictStatic(runtime,values,'not-exported'),/not exported/);
    assert.throws(()=>predictStatic(runtime,{},'all'),/exactly/);
    const numeric=runtime.numeric[0];
    assert.throws(()=>predictStatic(runtime,{...values,[numeric.name]:'invalid'}),/finite/);
    if(runtime.categorical.length) assert.throws(()=>predictStatic(runtime,{...values,[runtime.categorical[0].name]:'__unknown__'}),/Unknown category/);
    const singular=structuredClone(runtime);singular.models.all.interval=null;
    assert.equal(predictStatic(singular,values,'all').prediction_interval,null);
  }
  for (const report of [item.report_markdown,item.report_html]) {
    const content=fs.readFileSync(path.join(exported,report),'utf8');
    assert.ok(content.includes(bundle.result.target) && content.includes('Evaluation') && content.includes('Deployment'));
  }
}
console.log(JSON.stringify({status:'passed',datasets:2,python_comparison_cases:cases,max_absolute_error:maxError,checked:['historical preservation','imputation','categories/reference levels','standardization','feature order/masks','both models','95% confidence/prediction intervals','invalid inputs','unavailable intervals','reports']},null,2));
