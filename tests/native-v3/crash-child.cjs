// Node-process crash experiment ONLY. Never run on a phone or production database.
const {DatabaseSync}=require('node:sqlite');
const {basename,dirname}=require('node:path');
const file=process.argv[2];
if(!/^gb-v3lab-[0-9a-f]{32}-crash\.db$/.test(basename(file??''))||!basename(dirname(file)).startsWith('gb-v3-lab-crash-'))throw Error('Unsafe crash-test filename');
const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; UPDATE budget_periods SET revision=99 WHERE id=1; INSERT INTO gb_lab_crash_probe(id) VALUES(1);');
process.send?.({uncommitted:true});setInterval(()=>{},1000);
