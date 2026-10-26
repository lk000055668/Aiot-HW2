import { parseBrowserCsv, trainBrowser, browserReport, predictStatic, BROWSER_LIMITS } from './browser-analysis';
const sessions=new Map<string,any>();
self.onmessage=async(event:MessageEvent)=>{
  const {id,action,body}=event.data;
  try{
    let result:any;
    if(action==='import'){
      if(body.bytes.byteLength>BROWSER_LIMITS.bytes)throw Error('Browser CSV limit is 10 MB.');
      const digest=await crypto.subtle.digest('SHA-256',body.bytes),sha=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
      let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(body.bytes);}catch{throw Error('CSV must be valid UTF-8 text.');}
      const parsed=parseBrowserCsv(text,body.name,sha);
      if(sessions.size>=4)throw Error('Browser dataset capacity reached. Refresh to release sessions.');
      sessions.set(parsed.dataset.id,parsed);result=parsed.dataset;
    }else{
      const session=sessions.get(body.datasetId);if(!session)throw Error('Browser dataset expired. Import your CSV again.');
      if(action==='release'){sessions.delete(body.datasetId);result={released:true};}
      else if(action==='preview')result={rows:session.rows.slice(body.page*10,(body.page+1)*10),page:body.page,total:session.rows.length};
      else if(action==='train'){const artifact=trainBrowser(session.rows,session.dataset,body.config,message=>self.postMessage({id,progress:message}));session.artifact=artifact;result=artifact.result;}
      else if(action==='predict'){if(!session.artifact)throw Error('Run Analysis first.');result=predictStatic(session.artifact.runtime,body.values,body.model);}
      else if(action==='report'){if(!session.artifact)throw Error('Run Analysis first.');result=browserReport(session.dataset,session.artifact,body.format);}
      else throw Error('Unknown browser analysis action.');
    }
    self.postMessage({id,result});
  }catch(error:any){self.postMessage({id,error:error.message||'Browser analysis failed.'});}
};
