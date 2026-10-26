/** Evaluate an exported sklearn/statsmodels fit; never fit or estimate parameters here. */
export function predictStatic(runtime: any, values: Record<string, any>, model = 'selected') {
  const fitted = runtime.models[model];
  if (!fitted) throw new Error('This model was not exported. Use local full mode to train it.');
  if (Object.keys(values).length !== runtime.features.length || runtime.features.some((key:string)=>!(key in values))) throw new Error('Provide exactly the exported input features.');
  const missing = (value:any)=>value===null || value===undefined || value==='';
  const encoded: number[] = [];
  const extrapolated: string[] = [];
  const imputed: string[] = [];
  for (const column of runtime.numeric) {
    if (missing(values[column.name])) imputed.push(column.name);
    const value = missing(values[column.name]) ? column.impute : Number(values[column.name]);
    if (!Number.isFinite(value)) throw new Error(`${column.name} must be a finite number.`);
    const input = runtime.inputs.find((x:any)=>x.name===column.name);
    if (value < input.min || value > input.max) extrapolated.push(column.name);
    encoded.push((value-column.mean)/column.scale);
  }
  for (const column of runtime.categorical) {
    if (missing(values[column.name])) imputed.push(column.name);
    const value = missing(values[column.name]) ? column.impute : String(values[column.name]);
    if (!column.categories.includes(value)) throw new Error(`Unknown category for ${column.name}.`);
    column.categories.forEach((category:string,index:number)=>{if(index!==column.drop_index) encoded.push(value===category?1:0);});
  }
  if(encoded.length!==runtime.encoded_order.length) throw new Error('Exported preprocessing dimensions do not match.');
  const valid = runtime.valid_indices.map((i:number)=>encoded[i]);
  const vector = fitted.indices.map((i:number)=>valid[i]);
  if(vector.length!==fitted.coefficients.length) throw new Error('Exported coefficient order does not match.');
  const dot = (a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  const prediction = fitted.intercept + dot(vector,fitted.coefficients);
  let prediction_interval:number[]|null=null, confidence_interval:number[]|null=null;
  if(fitted.interval) {
    const interval=fitted.interval, design=[1,...vector];
    const mean=dot(design,interval.ols_params);
    const variance=dot(design,interval.covariance.map((row:number[])=>dot(row,design)));
    // Round-off can make a zero quadratic form slightly negative; do not mask invalid exports.
    if(variance < -1e-8 || interval.residual_variance < 0) throw new Error('Invalid exported interval covariance.');
    const meanWidth=interval.t_critical*Math.sqrt(Math.max(0,variance));
    const obsWidth=interval.t_critical*Math.sqrt(Math.max(0,variance)+interval.residual_variance);
    confidence_interval=[mean-meanWidth,mean+meanWidth];
    prediction_interval=[mean-obsWidth,mean+obsWidth];
  }
  return {prediction,model,prediction_interval,confidence_interval,extrapolated_features:extrapolated,imputed_features:imputed};
}
