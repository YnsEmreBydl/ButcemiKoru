import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const require=createRequire(import.meta.url),WebSocket=require('ws');
const action=process.argv[2]??'status';
const expressions={status:'host.getSnapshot()',ui:'host.ui.inspect()',home:"host.navigate('/')",periods:"host.navigate('/periods')",history:"host.navigate('/periods/history')",expense:"host.navigate('/expense-add')",setup:"host.navigate('/budget-setup')"};
if(action!=='run'&&!Object.hasOwn(expressions,action)&&!['press','fill'].includes(action))throw Error('Unsupported integration action');
const origin='http://127.0.0.1:8103';
const targets=await(await fetch(`${origin}/json/list`,{signal:AbortSignal.timeout(3000)})).json();
if(!Array.isArray(targets)||targets.length!==1)throw Error('Independent lab must have exactly one connected native target');
const url=new URL(targets[0].webSocketDebuggerUrl);url.hostname='127.0.0.1';
const read="(()=>{const host=globalThis.__GB_V3_INTEGRATION__;return host?host.getSnapshot():{labReady:false};})()";
const expression=action==='press'?`host.ui.press(${JSON.stringify(process.argv[3])})`:action==='fill'?`host.ui.fill(${JSON.stringify(process.argv[3])},${JSON.stringify(process.argv[4])},${Number(process.argv[5]??0)})`:expressions[action];
const start=`(()=>{const host=globalThis.__GB_V3_INTEGRATION__;if(!host)return {labReady:false};const s=host.getSnapshot();if(!s.identity.independentApp||!s.identity.hermes)return {wrongTarget:true};${action==='run'?'void host.run();return {started:true};':`return ${expression};`}})()`;
const result=await new Promise((resolve,reject)=>{
  const ws=new WebSocket(url,{origin});let sequence=1,lastStage='';const pending=new Map();
  const timer=setTimeout(()=>{ws.terminate();reject(Error('Native lab timed out; no success assumed'));},120000);
  const finish=value=>{clearTimeout(timer);ws.close();resolve(value);};
  const evaluate=(expression,callback)=>{const id=++sequence;pending.set(id,callback);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));};
  const poll=()=>evaluate(read,state=>{
    if(state?.stage&&state.stage!==lastStage){lastStage=state.stage;process.stdout.write(`Native stage: ${lastStage}\n`);}
    if(state?.error||(action==='run'&&!state?.running))finish(state);
    else setTimeout(poll,400);
  });
  ws.on('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.enable'})));
  ws.on('message',data=>{
    const message=JSON.parse(String(data));
    if(message.id===1){evaluate(start,ack=>{if(action!=='run'||!ack?.started)finish(ack);else setTimeout(poll,400);});}
    else if(pending.has(message.id)){
      const callback=pending.get(message.id);pending.delete(message.id);
      if(message.result?.exceptionDetails){clearTimeout(timer);ws.close();reject(Error('Independent diagnostic evaluation failed'));}
      else callback(message.result?.result?.value);
    }
  });
  ws.on('error',()=>{clearTimeout(timer);reject(Error('Independent native inspector connection failed'));});
});
const capture=`${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
if(action==='run'){
 if(!result?.identity?.independentApp||!result?.identity?.hermes)throw Error('No native integration evidence');
 const path=`raporlar/7d3-${result.identity.platform}-native-${capture}.json`;writeFileSync(path,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({identity:result.identity,passed:result.report?.passed,failed:result.report?.failed,error:result.error,path},null,2));
 if(result.error||!result.report||result.report.failed)process.exitCode=1;
}else {console.log(JSON.stringify(result??{dispatched:true},null,2));}
