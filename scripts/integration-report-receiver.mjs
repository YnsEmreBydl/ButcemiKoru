// Local development evidence transport only. No financial rows accepted or logged.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const info=JSON.parse(readFileSync('/private/tmp/gunluk-butcem-7d3-lab-info.json','utf8'));
const config=JSON.parse(readFileSync(`${info.folder}/lab-config.json`,'utf8'));
const token=config.receiver?.token;
if(typeof token!=='string'||!/^[0-9a-f]{32}$/.test(token))throw Error('Missing lab receiver capability');
const names=new Set(['app-startup-persistence','app-fence-concurrent-handles','app-inflight-drained','app-bad-backup','app-migration','app-before-activation','app-lost-commit-ack','app-forms-expenses-archive','app-policy-closed','app-unknown-schema']);
const server=createServer((req,res)=>{
 if(req.method!=='POST'||req.url!=='/report'||req.headers['x-gb-lab-token']!==token){res.writeHead(403);res.end();return;}
 let body='';req.on('data',chunk=>{body+=chunk;if(body.length>64000)req.destroy();});
 req.on('end',()=>{try{
  const value=JSON.parse(body),i=value.identity,r=value.report,b=value.bootProof;
  if(!i?.independentApp||!i?.hermes||(!i?.development&&!i?.testBuild)||!['ios','android'].includes(i.platform)||!Array.isArray(r?.results)||r.results.length!==names.size)throw Error('Invalid lab report');
  if(new Set(r.results.map(x=>x.id)).size!==names.size||!r.results.every(x=>names.has(x.id)&&['passed','failed'].includes(x.status)))throw Error('Invalid cases');
  const results=r.results.map(x=>({id:x.id,status:x.status,...(typeof x.detail==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(x.detail)?{detail:x.detail}:{})}));
  const passed=results.filter(x=>x.status==='passed').length,failed=results.length-passed;
  if(passed!==r.passed||failed!==r.failed||!/^\d+\.\d+\.\d+$/.test(b?.sqliteVersion??''))throw Error('Invalid counts');
  const record={transport:'device HTTP report to local lab receiver; not CDP',recordedAt:new Date().toISOString(),
   identity:{independentApp:true,development:i.development===true,testBuild:i.testBuild===true,hermes:true,physicalDevice:i.physicalDevice===true,platform:i.platform},
   executionId:typeof value.executionId==='string'&&/^[a-z0-9-]{1,80}$/.test(value.executionId)?value.executionId:null,
   bootProof:{sourceSchema:b.sourceSchema,activeSchema:b.activeSchema,catalogEpoch:b.catalogEpoch,transitionCount:b.transitionCount,sqliteVersion:b.sqliteVersion},
   report:{passed,failed,results}};
  const file=`raporlar/7d3-${i.platform}-native-http-${Date.now()}-${randomBytes(3).toString('hex')}.json`;
  writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,passed,failed,platform:i.platform,bootProof:record.bootProof}));res.writeHead(200);res.end('recorded');
 }catch{res.writeHead(400);res.end('invalid synthetic report');}});
});server.listen(8104,'0.0.0.0',()=>console.log('Independent lab report receiver ready on 8104'));
