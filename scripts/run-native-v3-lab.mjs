import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const require=createRequire(import.meta.url),WebSocket=require('ws');
const action=process.argv[2]??'status';
if(!['status','run','resume'].includes(action))throw Error('Use status, run or resume');
const origin='http://127.0.0.1:8097';
const targets=await(await fetch(`${origin}/json/list`,{signal:AbortSignal.timeout(3000)})).json();
if(!Array.isArray(targets)||targets.length!==1)throw Error('Independent lab must have exactly one connected native target');
const url=new URL(targets[0].webSocketDebuggerUrl);url.hostname='127.0.0.1';
const read="(()=>{const lab=globalThis.__GB_V3_NATIVE_LAB__;return lab?lab.getSnapshot():{labReady:false};})()";
const start=`(()=>{const lab=globalThis.__GB_V3_NATIVE_LAB__;if(!lab)return {labReady:false};const s=lab.getSnapshot();if(!s.identity.independentApp||!s.identity.hermes||!['ios','android'].includes(s.identity.platform))return {wrongTarget:true};void lab.${action==='resume'?'resume':'run'}();return {started:true};})()`;
const result=await new Promise((resolve,reject)=>{
  const ws=new WebSocket(url,{origin});let sequence=1,lastStage='';const pending=new Map();
  const timer=setTimeout(()=>{ws.terminate();reject(Error('Native lab timed out; no success assumed'));},120000);
  const finish=value=>{clearTimeout(timer);ws.close();resolve(value);};
  const evaluate=(expression,callback)=>{const id=++sequence;pending.set(id,callback);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));};
  const poll=()=>evaluate(read,state=>{
    if(state?.stage&&state.stage!==lastStage){lastStage=state.stage;process.stdout.write(`Native stage: ${lastStage}\n`);}
    if(action==='status'||state?.status==='error'||(action==='run'&&state?.status==='complete')||(action==='resume'&&state?.resume))finish(state);
    else setTimeout(poll,400);
  });
  ws.on('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.enable'})));
  ws.on('message',data=>{
    const message=JSON.parse(String(data));
    if(message.id===1){if(action==='status')poll();else evaluate(start,ack=>{if(!ack?.started)finish(ack);else setTimeout(poll,400);});}
    else if(pending.has(message.id)){
      const callback=pending.get(message.id);pending.delete(message.id);
      if(message.result?.exceptionDetails){clearTimeout(timer);ws.close();reject(Error('Independent diagnostic evaluation failed'));}
      else callback(message.result?.result?.value);
    }
  });
  ws.on('error',()=>{clearTimeout(timer);reject(Error('Independent native inspector connection failed'));});
});
if(action==='status'){process.stdout.write(JSON.stringify(result,null,2)+'\n');}
else{
  const platform=result?.identity?.platform;
  if(!['ios','android'].includes(platform))throw Error('No independently verified native result');
  const runId=result.activeRunId;
  if(typeof runId!=='string'||!/^[0-9a-f]{32}$/.test(runId))throw Error('Missing isolated run identifier');
  const captureId=`${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const path=`raporlar/7d2-${platform}-${action==='resume'?'resume':'native'}-${runId}-${captureId}.json`;
  writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({platform,physicalDevice:result.identity.physicalDevice,hermes:result.identity.hermes,report:result.report?{passed:result.report.passed,failed:result.report.failed,sqlite:result.report.sqliteVersion}:null,resume:result.resume,path},null,2)+'\n');
  if(result.status==='error'||(action==='run'&&(!result.report||result.report.failed))||(action==='resume'&&!result.resume?.passed))process.exitCode=1;
}
