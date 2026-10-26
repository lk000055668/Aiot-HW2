import { predictStatic } from './static-predict';
import { importBrowserCsv, browserAction } from './browser-client';

export const STATIC_MODE = import.meta.env.VITE_APP_MODE === 'static';
const root = `${import.meta.env.BASE_URL}static/`;
const cache = new Map<string,Promise<any>>();
async function json(path:string) {
  const response=await fetch(root+path);
  if(!response.ok) throw new Error(`Static export unavailable (${response.status}). Run scripts/export_static.py and rebuild.`);
  return response.json();
}
const index = ()=>{
  if(!cache.has('index')) cache.set('index',json('index.json'));
  return cache.get('index')!;
};
export async function staticBundle(problem:string) {
  if(!['startup','trust'].includes(problem)) throw new Error('Custom CSV training requires local full mode.');
  if(!cache.has(problem)) cache.set(problem,index().then(manifest=>json(manifest.datasets[problem].bundle)));
  return cache.get(problem)!;
}
export async function staticReport(problem:string,format:'markdown'|'html') {
  const manifest=await index();
  return root+manifest.datasets[problem][format==='html'?'report_html':'report_markdown'];
}

/** Explicit static adapter: only packaged files and in-browser prediction, never API fetches. */
export async function staticApi(path:string, opts:RequestInit={}) {
  if(path==='/api/datasets/upload' && opts.method==='POST') {
    const file=opts.body instanceof FormData?opts.body.get('file'):null;
    if(!(file instanceof File)) throw new Error('Select a CSV file first.');
    return importBrowserCsv(file);
  }
  const body=typeof opts.body==='string'?JSON.parse(opts.body):{};
  if(path==='/api/datasets' && opts.method==='POST') return (await staticBundle(body.problem)).dataset;
  const custom=path.match(/^\/api\/datasets\/(custom-[a-f0-9-]+)(?:\/(preview|predict))?(?:\?page=(\d+))?$/);
  if(custom) {
    if(opts.method==='DELETE') return browserAction('release',custom[1]);
    if(custom[2]==='preview') return browserAction('preview',custom[1],{page:Number(custom[3]||0)});
    if(custom[2]==='predict') return browserAction('predict',custom[1],body);
  }
  const match=path.match(/^\/api\/datasets\/(startup|trust)(?:\/(preview|predict))?(?:\?page=(\d+))?$/);
  if(!match) throw new Error('Unsupported action. Use the local CSV upload and browser analysis controls.');
  if(opts.method==='DELETE') return {released:true};
  const bundle=await staticBundle(match[1]);
  if(match[2]==='preview') {
    const page=Number(match[3]||0);
    return {rows:bundle.preview_rows.slice(page*10,(page+1)*10),page,total:bundle.dataset.rows};
  }
  if(match[2]==='predict') return predictStatic(bundle.runtime,body.values,body.model);
  throw new Error('Unsupported static action.');
}
