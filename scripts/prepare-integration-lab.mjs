import {randomBytes} from 'node:crypto';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir,networkInterfaces} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
const root=resolve('.'),folder=mkdtempSync(join(tmpdir(),'gb-app-integration-'));
const project=JSON.parse(readFileSync('package.json','utf8')),runId=randomBytes(16).toString('hex');
const ip=Object.values(networkInterfaces()).flat().find(x=>x?.family==='IPv4'&&!x.internal)?.address;
symlinkSync(join(root,'node_modules'),join(folder,'node_modules'),'dir');
writeFileSync(join(folder,'package.json'),JSON.stringify({...project,name:'gb-v3-integration',main:'expo-router/entry'}));
writeFileSync(join(folder,'app.json'),JSON.stringify({expo:{name:'Günlük Bütçem 7D-3 Test',slug:'gb-v3-integration',version:'1.0.0',scheme:'gb-v3-integration',extra:{integrationTesting:true},
 ios:{bundleIdentifier:'dev.gunlukbutcem.integration7d3'},android:{package:'dev.gunlukbutcem.integration7d3'},plugins:['expo-router','expo-sqlite'],web:{output:'single'}}}));
writeFileSync(join(folder,'tsconfig.json'),JSON.stringify({extends:'expo/tsconfig.base',compilerOptions:{strict:true,paths:{'@/*':[join(root,'src/*')],'@/assets/*':[join(root,'assets/*')]}}}));
writeFileSync(join(folder,'metro.config.js'),`const {getDefaultConfig}=require('expo/metro-config');\nconst c=getDefaultConfig(__dirname);c.watchFolders=[${JSON.stringify(root)}];c.resolver.nodeModulesPaths=[${JSON.stringify(join(root,'node_modules'))}];module.exports=c;\n`);
// Internal preview can use the existing modules without adding expo-dev-client.
writeFileSync(join(folder,'eas.json'),JSON.stringify({build:{preview:{distribution:'internal'}}},null,2));
writeFileSync(join(folder,'lab-config.json'),JSON.stringify({runId,receiver:{url:`http://${ip}:8104/report`,token:randomBytes(16).toString('hex')},fixtures:{v1:readFileSync('tests/expenses/v1-schema.sql','utf8'),v2:readFileSync('tests/migrations-v3/fixtures/v2-schema.sql','utf8')}}));
const app=join(folder,'src/app');mkdirSync(join(app,'periods/archive'),{recursive:true});
writeFileSync(join(folder,'host.ts'),`import{createIntegrationHost}from ${JSON.stringify(join(root,'src/devtools/application/host.native'))};import config from './lab-config.json';export const host=createIntegrationHost(config);\n`);
writeFileSync(join(app,'_layout.tsx'),`import{useEffect}from'react';import{Stack}from'expo-router';import{SafeAreaProvider}from'react-native-safe-area-context';import{BudgetApplicationProvider}from ${JSON.stringify(join(root,'src/features/application/provider'))};import{IntegrationFrame}from ${JSON.stringify(join(root,'src/devtools/application/test-frame'))};import{host}from'../../host';export default function Layout(){useEffect(()=>{globalThis.__GB_V3_INTEGRATION__=host;return()=>{globalThis.__GB_V3_INTEGRATION__=undefined}},[]);return <SafeAreaProvider><IntegrationFrame host={host}><BudgetApplicationProvider repository={host.app}><Stack screenOptions={{headerShown:false}}/></BudgetApplicationProvider></IntegrationFrame></SafeAreaProvider>;}\n`);
for(const[name,target]of Object.entries({'index.tsx':'src/features/saved-budget/home-screen','budget-setup.tsx':'src/features/budget-setup/setup-screen','expense-add.tsx':'src/features/expenses/expense-screen','demo.tsx':'src/features/demo/demo-screen','periods/_layout.tsx':'src/app/periods/_layout','periods/index.tsx':'src/app/periods/index','periods/new.tsx':'src/app/periods/new','periods/history.tsx':'src/app/periods/history','periods/archive/[periodId].tsx':'src/app/periods/archive/[periodId]'}))writeFileSync(join(app,name),`export{default}from ${JSON.stringify(join(root,target))};\n`);
writeFileSync(join(app,'explore.tsx'),`import{IntegrationControls}from ${JSON.stringify(join(root,'src/devtools/application/test-frame'))};import{host}from'../../host';export default function Tests(){return <IntegrationControls host={host}/>;}\n`);
const info={folder,runId,port:8103,url:`exp://${ip}:8103`,scope:'synthetic application integration; unique app ID; no production v3 activation'};
if(process.argv.includes('--portable')){
 cpSync(join(root,'src'),join(folder,'shared'),{recursive:true});cpSync(join(root,'assets'),join(folder,'assets'),{recursive:true});
 const walk=d=>readdirSync(d).flatMap(n=>{const f=join(d,n);return statSync(f).isDirectory()?walk(f):[f]});
 for(const file of [...walk(app),join(folder,'host.ts')]){
  let value=readFileSync(file,'utf8');const base=dirname(file);
  value=value.replaceAll(JSON.stringify(join(root,'src')).slice(1,-1)+'/',relative(base,join(folder,'shared')).replaceAll('\\','/')+'/');
  // Bare relative paths require ./ when the shared directory is adjacent.
  value=value.replaceAll('from "shared/','from "./shared/');writeFileSync(file,value);
 }
 writeFileSync(join(folder,'tsconfig.json'),JSON.stringify({extends:'expo/tsconfig.base',compilerOptions:{strict:true,paths:{'@/*':['./shared/*'],'@/assets/*':['./assets/*']}}}));
 writeFileSync(join(folder,'metro.config.js'),`const{getDefaultConfig}=require('expo/metro-config');const fs=require('node:fs'),path=require('node:path');const c=getDefaultConfig(__dirname);c.watchFolders=[fs.realpathSync(path.join(__dirname,'node_modules'))];module.exports=c;\n`);
 const pkg=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));pkg.scripts={start:'expo start',ios:'expo start --ios',android:'expo start --android'};writeFileSync(join(folder,'package.json'),JSON.stringify(pkg,null,2));
 const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));lock.name=pkg.name;if(lock.packages?.[''])lock.packages[''].name=pkg.name;writeFileSync(join(folder,'package-lock.json'),JSON.stringify(lock,null,2));
 const config=JSON.parse(readFileSync(join(folder,'lab-config.json'),'utf8'));delete config.receiver;writeFileSync(join(folder,'lab-config.json'),JSON.stringify(config));
 writeFileSync(join(folder,'.gitignore'),'node_modules\n.expo\ndist\n');info.portable=true;
}
if(!process.argv.includes('--no-register'))writeFileSync('/private/tmp/gunluk-butcem-7d3-lab-info.json',JSON.stringify(info,null,2));console.log(JSON.stringify(info,null,2));
