let worker:Worker|null=null,sequence=0;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;progress?:(message:string)=>void}>();
function request(action:string,body:any,progress?:(message:string)=>void):Promise<any>{
  if(!worker){
    worker=new Worker(new URL('./browser-analysis.worker.ts',import.meta.url),{type:'module'});
    worker.onmessage=event=>{const {id,result,error,progress:message}=event.data,task=pending.get(id);if(!task)return;if(message){task.progress?.(message);return;}pending.delete(id);if(error)task.reject(new Error(error));else task.resolve(result);};
    worker.onerror=()=>{for(const task of pending.values())task.reject(new Error('Browser worker failed. Reimport the CSV, or use local full mode for large datasets.'));pending.clear();worker?.terminate();worker=null;};
  }
  const id=++sequence;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,progress});worker!.postMessage({id,action,body},body.bytes?[body.bytes]:[]);});
}
export async function importBrowserCsv(file:File){if(file.size>10*1024*1024)throw Error('Browser CSV limit is 10 MB. Use local full mode for larger files.');return request('import',{name:file.name,bytes:await file.arrayBuffer()});}
export const trainBrowserCsv=(datasetId:string,config:any,progress:(message:string)=>void)=>request('train',{datasetId,config},progress);
export const browserAction=(action:string,datasetId:string,options:any={})=>request(action,{datasetId,...options});
