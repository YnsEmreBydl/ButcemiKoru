import Constants from 'expo-constants';
import { isDevice } from 'expo-device';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import type { SqlRow, SqlSession } from '../../data/budget/contracts';
import { exclusiveAdapter } from '../../data/budget/exclusive-adapter';
import { ensure, labFileName, LAB_SLUG, type LabConfig, type LabConnection, type LabDriver } from './types';

export function nativeLabIdentity() {
  return { development: __DEV__, independentApp: Constants.expoConfig?.slug === LAB_SLUG,
    platform: Platform.OS, physicalDevice: isDevice, hermes: Reflect.get(globalThis,'HermesInternal') !== undefined };
}
export function assertNativeLab(): void {
  const identity=nativeLabIdentity();
  ensure(identity.development && identity.independentApp && identity.hermes && ['ios','android'].includes(identity.platform),'NOT_IN_ISOLATED_NATIVE_LAB');
}

/** Does not expose a directory or filename argument to the test UI. */
export function createNativeLabDriver(config: LabConfig, resume = false): LabDriver {
  assertNativeLab(); labFileName(config.runId,'guard');
  const directory=`${SQLite.defaultDatabaseDirectory}/gb-v3-native-lab`;
  const allocated=new Set<string>(resume?['lifecycle','wal-restored','prep-success-src','ok-backup','ok-restore','ok-candidate']:[]);
  const connections=new Set<LabConnection>(), native=new WeakMap<LabConnection,SQLite.SQLiteDatabase>();
  async function connect(key:string,fresh:boolean):Promise<LabConnection>{
    assertNativeLab();const name=labFileName(config.runId,key);
    if(fresh){ensure(!allocated.has(key),'LAB_KEY_ALREADY_ALLOCATED');}
    else ensure(allocated.has(key),'LAB_FILE_NOT_OWNED');
    const db=await SQLite.openDatabaseAsync(name,{useNewConnection:true,finalizeUnusedStatementsBeforeClosing:true},directory);
    let closed=false;
    try{
      if(fresh){
        ensure((await db.getAllAsync("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")).length===0,'LAB_FILE_ALREADY_EXISTS');
        ensure((await db.getFirstAsync<{user_version:number}>('PRAGMA user_version'))?.user_version===0,'LAB_FILE_ALREADY_VERSIONED');
        allocated.add(key);
      }
      await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=75;');
      const query:SqlSession={exec:sql=>db.execAsync(sql),run:(sql,params)=>db.runAsync(sql,...params),all:(sql,params=[])=>db.getAllAsync<SqlRow>(sql,...params)};
      const adapter=exclusiveAdapter(db);
      const connection:LabConnection={query,database:{transaction:task=>{ensure(!closed,'LAB_CONNECTION_CLOSED');return adapter.transaction(task);}},
        close:async()=>{if(!closed){await db.closeAsync();closed=true;}}};
      connections.add(connection);native.set(connection,db);return connection;
    }catch(error){await db.closeAsync();throw error;}
  }
  return {open:key=>connect(key,true),reopen:key=>connect(key,false),
    async backup(source,destination){assertNativeLab();const from=native.get(source),to=native.get(destination);ensure(from&&to&&from!==to,'UNOWNED_BACKUP_CONNECTION');
      await SQLite.backupDatabaseAsync({sourceDatabase:from,sourceDatabaseName:'main',destDatabase:to,destDatabaseName:'main'});},
    async closeAll(){for(const connection of connections)await connection.close();},
  };
}
