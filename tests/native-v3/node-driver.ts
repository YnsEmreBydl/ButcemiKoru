import { backup } from 'node:sqlite';
import { join } from 'node:path';
import type { LabConfig, LabConnection, LabDriver } from '../../src/devtools/native-v3/types';
import { ensure, labFileName } from '../../src/devtools/native-v3/types';
import { RealSQLite } from '../storage/sqlite-helper';

export function createNodeLabDriver(directory:string,config:LabConfig):LabDriver{
  const owned=new Set<string>(),connections=new Map<LabConnection,{db:RealSQLite;file:string}>();
  async function connect(key:string,fresh:boolean):Promise<LabConnection>{
    const file=join(directory,labFileName(config.runId,key));
    if(fresh)ensure(!owned.has(key),'LAB_KEY_ALREADY_ALLOCATED');else ensure(owned.has(key),'LAB_FILE_NOT_OWNED');
    const db=new RealSQLite(file);
    if(fresh){ensure(db.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().length===0,'LAB_FILE_ALREADY_EXISTS');owned.add(key);}
    const connection:LabConnection={database:db,query:{exec:async sql=>{db.db.exec(sql);},run:async(sql,p)=>({changes:Number(db.db.prepare(sql).run(...p).changes)}),all:async(sql,p=[])=>db.db.prepare(sql).all(...p)},close:async()=>{db.close();}};
    connections.set(connection,{db,file});return connection;
  }
  return{open:key=>connect(key,true),reopen:key=>connect(key,false),
    async backup(source,destination){const a=connections.get(source),b=connections.get(destination);ensure(a&&b,'UNOWNED_BACKUP_CONNECTION');await backup(a.db.db,b.file);},
    async closeAll(){for(const{db}of connections.values())db.close();},
  };
}
