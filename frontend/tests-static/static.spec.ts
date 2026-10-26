import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('packaged analyses, charts, browser predictions and downloads work under the Pages subpath without an API',async({page,baseURL})=>{
  const forbidden:string[]=[], errors:string[]=[], failures:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('requestfailed',request=>failures.push(request.url()));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==new URL(baseURL!).origin || url.pathname.startsWith('/api/') || !url.pathname.startsWith(new URL(baseURL!).pathname)) {
      forbidden.push(url.href);return route.abort();
    }
    return route.continue();
  });
  await page.goto('./');
  await expect(page.getByTestId('configured-target')).toHaveText('latent_trust_score');
  const manifest=await (await page.request.get('static/index.json')).json();
  for(const problem of ['startup','trust']) {
    await page.locator('#primary-problem').selectOption(problem);
    const bundle=await (await page.request.get(`static/${manifest.datasets[problem].bundle}`)).json();
    await expect(page.getByTestId('configured-target')).toHaveText(bundle.result.target);
    await expect(page.getByLabel('Random seed')).toBeDisabled();
    await expect(page.getByLabel('Test partition')).toBeDisabled();
    await page.getByRole('button',{name:'View Saved Results',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Results with something to say.'})).toBeVisible();
    await expect(page.locator('.metric-card')).toHaveCount(5);
    await expect(page.locator('.js-plotly-plot').first()).toBeVisible();
    await expect(page.getByText('Actual vs. predicted',{exact:true})).toBeVisible();
    const plot=page.locator('.js-plotly-plot').first();
    const before=await plot.evaluate((element:any)=>element._fullLayout.xaxis.range);
    await plot.locator('a[data-title="Zoom in"]').click({force:true});
    const after=await plot.evaluate((element:any)=>element._fullLayout.xaxis.range);
    expect(after[1]-after[0]).toBeLessThan(before[1]-before[0]);
    await page.locator('nav').getByRole('button',{name:/Feature Selection/}).click();
    await expect(page.getByLabel('Selected encoded features (k)')).toBeDisabled();
    await expect(page.getByLabel('Selected encoded features (k)')).toHaveValue(String(bundle.result.k));
    await expect(page.locator('.js-plotly-plot')).toHaveCount(1);
    await page.locator('nav').getByRole('button',{name:/Data Understanding/}).click();
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.getByText(`Page 2 of ${Math.ceil(bundle.dataset.rows/10)}`,{exact:true})).toBeVisible();
    await expect(page.locator('.js-plotly-plot')).toHaveCount(4);
    await page.locator('nav').getByRole('button',{name:/Prediction/}).click();
    for(const model of ['all','selected']) {
      await page.getByLabel('View model').selectOption(model);
      await page.getByRole('button',{name:'Predict',exact:true}).click();
      const reference=await (await page.request.get(`static/${manifest.datasets[problem].validation}`)).json();
      const expected=reference.cases.find((x:any)=>x.label==='defaults'&&x.model===model).expected.prediction;
      await expect(page.locator('.prediction-result>strong')).toHaveText(expected.toLocaleString('en-US',{maximumFractionDigits:6}));
      await expect(page.locator('.prediction-result')).not.toContainText('Unavailable');
    }
    const numerical= bundle.result.inputs.find((x:any)=>x.type==='number');
    await page.getByLabel(numerical.name.replaceAll('_',' '),{exact:true}).fill('');
    await page.getByRole('button',{name:'Predict',exact:true}).click();
    await expect(page.getByText(/Training imputation applied:/)).toBeVisible();
    await page.locator('nav').getByRole('button',{name:/CRISP-DM Report/}).click();
    for(const format of ['Markdown','HTML']) {
      const downloaded=page.waitForEvent('download');
      await page.getByRole('button',{name:`Export ${format}`,exact:true}).click();
      const file=await downloaded;
      expect(file.suggestedFilename()).toBe(`crisp-dm-report.${format==='HTML'?'html':'md'}`);
      const content=fs.readFileSync((await file.path())!,'utf8');
      expect(content).toContain(bundle.result.target);expect(content).toContain('Evaluation');
    }
    await page.screenshot({path:test.info().outputPath(`${problem}-static.png`),fullPage:true});
    await page.locator('nav').getByRole('button',{name:/Overview/}).click();
  }
  await page.locator('#primary-problem').selectOption('custom');
  await expect(page.getByRole('heading',{name:'Import your dataset'})).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(1);
  await expect(page.locator('.model-bar')).toHaveCount(0);
  await expect(page.locator('.result-metrics')).toHaveCount(0);
  await page.locator('#primary-problem').selectOption('startup');
  await expect(page.getByTestId('configured-target')).toHaveText('Profit');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  await expect(page.locator('#sticky-problem')).toBeVisible();
  await page.locator('#sticky-problem').selectOption('trust');
  await expect(page.getByTestId('configured-target')).toHaveText('latent_trust_score');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(forbidden).toEqual([]);expect(errors).toEqual([]);expect(failures).toEqual([]);
});

test('teacher can upload CSV, train, configure, predict and export entirely in a browser worker',async({page,baseURL})=>{
  const forbidden:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==new URL(baseURL!).origin||!url.pathname.startsWith(new URL(baseURL!).pathname)){
      forbidden.push(url.href);return route.abort();
    }return route.continue();
  });
  await page.goto('./');
  await expect(page.getByTestId('configured-target')).toHaveText('latent_trust_score');
  const manifest=await (await page.request.get('static/index.json')).json();
  const startup=await (await page.request.get(`static/${manifest.datasets.startup.bundle}`)).json();
  const quote=(value:any)=>`"${String(value??'').replaceAll('"','""')}"`;
  const csv=[startup.dataset.columns,...startup.preview_rows.map((r:any)=>startup.dataset.columns.map((c:string)=>r[c]))].map(row=>row.map(quote).join(',')).join('\n');
  const reference=JSON.parse(fs.readFileSync('tests-static/fixtures/browser-oracle.json','utf8'));
  await page.locator('#primary-problem').selectOption('custom');
  const upload=page.locator('input[type=file]');
  await upload.setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from('a,b\n1,2')});
  await page.getByRole('button',{name:'Load Dataset',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('12');
  await upload.setInputFiles({name:'teacher-startups.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.getByRole('button',{name:'Load Dataset',exact:true}).click();
  await expect(page.getByLabel('Numerical target')).toHaveValue('Profit');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Random seed')).toBeEnabled();
  await page.getByRole('button',{name:'Run Analysis',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Results with something to say.'})).toBeVisible();
  const original=reference.cases.find((c:any)=>c.name==='startup-full');
  await expect(page.locator('.metric-card').first().locator('strong')).toHaveText(original.models.selected.metrics.r2.toLocaleString('en-US',{maximumFractionDigits:4}));
  await expect(page.locator('.js-plotly-plot')).toHaveCount(5);
  await page.locator('nav').getByRole('button',{name:/Prediction/}).click();
  await page.getByRole('button',{name:'Predict',exact:true}).click();
  await expect(page.locator('.prediction-result>strong')).toHaveText(original.predictions.find((p:any)=>p.model==='selected').prediction.toLocaleString('en-US',{maximumFractionDigits:6}));
  await page.locator('nav').getByRole('button',{name:/CRISP-DM Report/}).click();
  for(const format of ['Markdown','HTML']){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:`Export ${format}`,exact:true}).click();
    const file=await pending,content=fs.readFileSync((await file.path())!,'utf8');
    expect(content).toContain('teacher-startups.csv');expect(content).toContain('browser-ols-svd-v1');expect(content).toContain('Profit');
  }
  await page.locator('nav').getByRole('button',{name:/Data Preparation/}).click();
  await page.getByLabel('Numerical target').selectOption('Administration');
  await page.getByLabel('Selected encoded features (k)').fill('2');
  await page.getByLabel('Random seed').fill('17');await page.getByLabel('Test partition').selectOption('0.3');
  await page.getByLabel('Scale numerical features using training statistics').check();
  await page.getByRole('button',{name:'Run Analysis',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Results with something to say.'})).toBeVisible();
  const changed=reference.cases.find((c:any)=>c.name==='startup-alternate-target');
  await expect(page.locator('.metric-card').first().locator('strong')).toHaveText(changed.models.selected.metrics.r2.toLocaleString('en-US',{maximumFractionDigits:4}));
  await page.screenshot({path:test.info().outputPath('browser-upload-results.png'),fullPage:true});
  await page.locator('nav').getByRole('button',{name:/Overview/}).click();
  await page.locator('#primary-problem').selectOption('startup');await expect(page.getByTestId('configured-target')).toHaveText('Profit');
  await page.locator('#primary-problem').selectOption('custom');await expect(page.getByLabel('Numerical target')).toHaveValue('Administration');
  await expect(page.getByRole('button',{name:'Run Analysis',exact:true})).toBeEnabled();
  await expect(page.locator('.model-bar')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(forbidden).toEqual([]);expect(errors).toEqual([]);
});
