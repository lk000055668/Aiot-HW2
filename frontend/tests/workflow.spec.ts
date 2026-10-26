import {test,expect} from '@playwright/test';
import type {Page,APIRequestContext} from '@playwright/test';
const API=process.env.TEST_API_URL || 'http://127.0.0.1:8000';
const URL='https://raw.githubusercontent.com/Avik-Jain/100-Days-Of-ML-Code/master/datasets/50_Startups.csv';
let datasets:string[]=[];
test.beforeEach(async({page})=>{
 datasets=[];
 page.on('response',async response=>{
  if(response.request().method()==='POST' && /\/api\/datasets(?:\/upload)?$/.test(response.url()) && response.ok()){
   const d=await response.json().catch(()=>null);if(d?.id)datasets.push(d.id);
  }
 });
});
test.afterEach(async({request})=>{
 for(const id of datasets)await request.delete(`${API}/api/datasets/${id}`);
});
async function nav(page:Page,name:RegExp){await page.locator('nav').getByRole('button',{name}).click();}
async function loaded(page:Page,target:string){
 if(await page.getByLabel('Problem Selection').inputValue()==='custom') await expect(page.getByLabel('Numerical target')).toHaveValue(target,{timeout:60000});
 else await expect(page.getByTestId('configured-target')).toHaveText(target,{timeout:60000});
 await expect(page.getByRole('button',{name:'Start Analysis',exact:true})).toBeEnabled();
 await expect(page.getByRole('alert')).toHaveCount(0);
}
async function train(page:Page,request:APIRequestContext,target:string){
 const started=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/train'));
 await page.getByRole('button',{name:'Start Analysis',exact:true}).click();
 const response=await started;expect(response.status()).toBe(202);
 const {job_id}=await response.json();
 await expect(page.getByRole('heading',{name:'Measure what the model learns'})).toBeVisible({timeout:120000});
 await expect(page.getByRole('alert')).toHaveCount(0);
 const job=await (await request.get(`${API}/api/jobs/${job_id}`)).json();
 expect(job.status).toBe('complete');expect(job.result.target).toBe(target);
 for(const model of Object.values(job.result.models) as any[]){
  for(const key of ['r2','mae','mse','rmse'])expect(Number.isFinite(model.metrics[key])).toBeTruthy();
  expect(model.intervals_valid).toBeTruthy();
  expect(model.sample.obs_ci_lower.length).toBeGreaterThan(0);
 }
 await expect(page.getByText('Actual vs. predicted',{exact:true})).toBeVisible();
 await expect(page.getByText('Residual vs. predicted',{exact:true})).toBeVisible();
 await expect(page.getByText('Held-out observations and 95% prediction intervals',{exact:true})).toBeVisible();
 await test.info().attach(`${target}-actual-model-results`,{body:JSON.stringify(job.result,null,2),contentType:'application/json'});
 return job.result;
}
async function predict(page:Page,target:string){
 await nav(page,/Prediction/);
 await page.getByRole('button',{name:'Predict',exact:true}).click();
 await expect(page.getByRole('heading',{name:target==='latent_trust_score'?'Predicted AI Trust Score':`Predicted ${target}`,exact:true})).toBeVisible();
 const interval=page.getByText('95% prediction interval:',{exact:false});
 await expect(interval).toBeVisible();await expect(interval).not.toContainText('Unavailable');
 await expect(page.getByRole('alert')).toHaveCount(0);
 expect(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth)).toBeTruthy();
}

test('bonus 1: trust to startup to trust reloads data, models and inputs without stale results',async({page,request})=>{
 test.skip(!process.env.TEST_TRUST,'Run dataset acquisition and enable TEST_TRUST.');
 await page.goto('/');await loaded(page,'latent_trust_score');
 await expect(page.getByLabel('Problem Selection').locator('option')).toHaveText(['Problem 1 — Human–AI Trust Prediction','Problem 2 — Startup Profit Prediction','Custom Problem — Upload Your Dataset']);
 await expect(page.getByLabel('Dataset Source')).toHaveCount(0);await expect(page.getByRole('button',{name:'Load Dataset'})).toHaveCount(0);
 await expect(page.getByText('Preconfigured Dataset',{exact:true})).toBeVisible();
 const trust=await train(page,request,'latent_trust_score');await predict(page,'latent_trust_score');
 await expect(page.getByLabel('education level')).toBeVisible();
 await nav(page,/Overview/);
 // Switching loads directly. No second Load Dataset click is permitted in this test.
 await page.getByLabel('Problem Selection').selectOption('startup');await loaded(page,'Profit');
 await expect(page.getByText('Fitted target:',{exact:false})).toHaveCount(0);
 await nav(page,/Prediction/);await expect(page.getByRole('heading',{name:'Your model is ready to be built'})).toBeVisible();
 await expect(page.getByLabel('education level')).toHaveCount(0);
 await nav(page,/Data Understanding/);
 await expect(page.getByText('50 rows · 5 columns · 0 exact duplicate rows')).toBeVisible();
 await expect(page.locator('figure').filter({hasText:'Profit distribution'})).toBeVisible();
 await nav(page,/Data Preparation/);
 await expect(page.getByLabel('model accuracy',{exact:true})).toHaveCount(0);
 const startup=await train(page,request,'Profit');expect(startup.models.all.metrics.rmse).not.toBe(trust.models.all.metrics.rmse);
 await predict(page,'Profit');await expect(page.getByLabel('R&D Spend')).toBeVisible();await expect(page.getByLabel('State',{exact:true})).toBeVisible();
 await nav(page,/CRISP-DM Report/);await expect(page.getByText('Startup Profit:',{exact:false})).toBeVisible();
 await nav(page,/Overview/);await page.getByLabel('Problem Selection').selectOption('trust');await loaded(page,'latent_trust_score');
 await nav(page,/Evaluation/);await expect(page.getByRole('heading',{name:'Your model is ready to be built'})).toBeVisible();
 await expect(page.getByText('All features vs. selected features',{exact:true})).toHaveCount(0);
 await nav(page,/Data Understanding/);await page.getByLabel('Explore feature').selectOption('education_level');
 await expect(page.locator('figure').filter({hasText:'education level distribution'})).toBeVisible();
 await nav(page,/Overview/);await train(page,request,'latent_trust_score');await predict(page,'latent_trust_score');
 await page.screenshot({path:test.info().outputPath('bonus-1-problem-switch.png'),fullPage:true});
});

test('bonus 2: professor CSV URL completes feature selection, evaluation, prediction and report',async({page,request})=>{
 await page.goto('/');await page.getByLabel('Problem Selection').selectOption('custom');
 await expect(page.getByRole('button',{name:'CSV URL',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Upload CSV File',exact:true})).toBeVisible();
 await page.getByLabel('Direct public HTTPS CSV URL').fill(URL);
 await page.getByRole('button',{name:'Load Dataset'}).click();await loaded(page,'Profit');
 await expect(page.getByRole('heading',{name:'Imported data preview'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Custom Dataset · analysis configuration'})).toBeVisible();
 await page.getByLabel('Numerical target').selectOption('Profit');
 await nav(page,/Data Preparation/);await page.getByLabel('Marketing Spend',{exact:true}).uncheck();
 await page.getByLabel('Selected encoded features (k)').fill('2');
 const result=await train(page,request,'Profit');expect(result.features).not.toContain('Marketing Spend');expect(result.k).toBe(2);
 await nav(page,/Feature Selection/);await expect(page.getByText('Training-only univariate feature rankings',{exact:true})).toBeVisible();
 await nav(page,/Evaluation/);await page.screenshot({path:test.info().outputPath('bonus-2-custom-evaluation.png'),fullPage:true});
 await predict(page,'Profit');await expect(page.getByLabel('State',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Marketing Spend',{exact:true})).toHaveCount(0);
 await nav(page,/CRISP-DM Report/);await expect(page.getByText('Custom CSV:',{exact:false})).toBeVisible();
 for(const format of ['Markdown','HTML']){
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:`Export ${format}`,exact:true}).click();
  expect((await downloaded).suggestedFilename()).toBe(`crisp-dm-report.${format==='HTML'?'html':'md'}`);
 }
 await nav(page,/Overview/);await page.getByLabel('Problem Selection').selectOption('startup');await loaded(page,'Profit');
 await expect(page.getByRole('heading',{name:'Import your dataset'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Load Dataset'})).toHaveCount(0);
 await page.getByLabel('Problem Selection').selectOption('custom');await loaded(page,'Profit');
 await expect(page.getByLabel('Direct public HTTPS CSV URL')).toHaveValue(URL);
 await nav(page,/Data Preparation/);await expect(page.getByLabel('Marketing Spend',{exact:true})).not.toBeChecked();
 await expect(page.getByLabel('Selected encoded features (k)')).toHaveValue('2');
 await nav(page,/Evaluation/);await expect(page.getByRole('heading',{name:'Your model is ready to be built'})).toBeVisible();

});

test('local upload accepts unrelated headers and an alternative numerical target',async({page,request})=>{
 const csv=await request.get(URL);expect(csv.ok()).toBeTruthy();
 // Real source values with renamed headers exercise generic columns, not new placeholder records.
 const raw=await csv.text();const changed=raw.replace('R&D Spend','research_budget').replace('Administration','office_cost').replace('Marketing Spend','advertising').replace('State','region').replace('Profit','earnings');
 await page.goto('/');await page.getByLabel('Problem Selection').selectOption('custom');await page.getByRole('button',{name:'Upload CSV File',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'renamed-startup.csv',mimeType:'text/csv',buffer:Buffer.from(changed)});
 await page.getByRole('button',{name:'Load Dataset'}).click();await loaded(page,'earnings');
 // Change target away from the final column to prove generic target selection.
 await page.getByLabel('Numerical target').selectOption('office_cost');
 await train(page,request,'office_cost');await predict(page,'office_cost');
 await expect(page.getByLabel('region',{exact:true})).toBeVisible();await expect(page.getByLabel('earnings',{exact:true})).toBeVisible();
});

test('invalid URL clears old results, reports useful errors and recovers',async({page,request})=>{
 await page.goto('/');await page.getByLabel('Problem Selection').selectOption('startup');await loaded(page,'Profit');
 await train(page,request,'Profit');await nav(page,/Overview/);
 await page.getByLabel('Problem Selection').selectOption('custom');
 await expect(page.getByLabel('Numerical target')).toHaveCount(0);
 for(const url of ['http://example.com/data.csv','https://127.0.0.1/data.csv',URL.replace('50_Startups.csv','missing-bonus-file.csv')]){
  await page.getByLabel('Direct public HTTPS CSV URL').fill(url);await page.getByRole('button',{name:'Load Dataset'}).click();
  await expect(page.getByRole('alert')).toContainText(/HTTPS|public IP|HTTP 404/,{timeout:60000});
  await expect(page.getByRole('button',{name:'Load Dataset'})).toBeEnabled();
  await expect(page.getByText('Fitted target:',{exact:false})).toHaveCount(0);
 }
 await page.getByLabel('Direct public HTTPS CSV URL').fill(URL);await page.getByRole('button',{name:'Load Dataset'}).click();await loaded(page,'Profit');
});

test('invalid upload validation and mobile controls remain usable',async({page})=>{
 await page.goto('/');await page.getByLabel('Problem Selection').selectOption('custom');await page.getByRole('button',{name:'Upload CSV File',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('a,b\n1,2')});
 await page.getByRole('button',{name:'Load Dataset'}).click();await expect(page.getByRole('alert')).toContainText(/12|at least/,{timeout:60000});
 await expect(page.getByRole('button',{name:'Load Dataset'})).toBeEnabled();
 const before=await page.locator('html').evaluate(el=>el.classList.contains('dark'));
 await page.getByRole('button',{name:'Toggle color theme'}).click();await expect.poll(()=>page.locator('html').evaluate(el=>el.classList.contains('dark'))).toBe(!before);
 expect(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth)).toBeTruthy();
});


test('failed problem switch clears results, locks controls while loading and allows retry',async({page,request})=>{
 test.skip(!process.env.TEST_TRUST,'Requires downloaded trust data.');
 await page.goto('/');await page.getByLabel('Problem Selection').selectOption('startup');await loaded(page,'Profit');
 await train(page,request,'Profit');await nav(page,/Overview/);
 let release:()=>void=()=>{};
 const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/datasets',async route=>{
  if(route.request().method()==='POST' && route.request().postDataJSON()?.problem==='trust'){
   await pending;await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'Test-only simulated source failure. Retry loading.'})});
  }else await route.continue();
 });
 await page.getByLabel('Problem Selection').selectOption('trust');
 await expect(page.getByLabel('Problem Selection')).toBeDisabled();
 await expect(page.getByRole('button',{name:'Load Dataset'})).toHaveCount(0);
 await expect(page.getByText('Fitted target:',{exact:false})).toHaveCount(0);
 release();await expect(page.getByRole('alert')).toContainText('Retry loading');
 await expect(page.getByRole('button',{name:'Retry Dataset'})).toBeEnabled();
 await page.unroute('**/api/datasets');
 await page.getByRole('button',{name:'Retry Dataset'}).click();await loaded(page,'latent_trust_score');
 await nav(page,/Evaluation/);await expect(page.getByRole('heading',{name:'Your model is ready to be built'})).toBeVisible();
});


test('failed custom replacement preserves target, features and import choices',async({page,request})=>{
 await page.goto('/');await page.getByLabel('Problem Selection').selectOption('custom');
 await page.getByLabel('Direct public HTTPS CSV URL').fill(URL);await page.getByRole('button',{name:'Load Dataset'}).click();await loaded(page,'Profit');
 await page.getByLabel('Numerical target').selectOption('Administration');
 await nav(page,/Data Preparation/);await page.getByLabel('Marketing Spend',{exact:true}).uncheck();await page.getByLabel('Selected encoded features (k)').fill('2');
 await page.getByLabel('Random seed').fill('17');await page.getByLabel('Test partition').selectOption('0.3');
 await nav(page,/Overview/);await page.getByRole('button',{name:'Upload CSV File',exact:true}).click();
 await expect(page.getByLabel('Numerical target')).toHaveValue('Administration');
 await page.locator('input[type=file]').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('a,b\n1,2')});
 await page.getByRole('button',{name:'Load Dataset'}).click();await expect(page.getByRole('alert')).toContainText('12');
 await expect(page.getByLabel('Numerical target')).toHaveValue('Administration');
 await page.getByRole('button',{name:'CSV URL',exact:true}).click();await expect(page.getByLabel('Direct public HTTPS CSV URL')).toHaveValue(URL);
 await page.getByLabel('Problem Selection').selectOption('startup');await loaded(page,'Profit');
 await page.getByLabel('Problem Selection').selectOption('custom');await loaded(page,'Administration');
 await expect(page.getByLabel('Random seed')).toHaveValue('17');await expect(page.getByLabel('Test partition')).toHaveValue('0.3');
 await nav(page,/Data Preparation/);await expect(page.getByLabel('Marketing Spend',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Selected encoded features (k)')).toHaveValue('2');
 await train(page,request,'Administration');await predict(page,'Administration');
});
