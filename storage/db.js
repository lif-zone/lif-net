// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import * as idb from 'idb';
import xerr from '../util/xerr.js';
import buf_util from '../peer-relay/buf_util.js';
import setGlobalVars from 'indexeddbshim';
const b2s = buf_util.buf_to_str;
global.window = global;
setGlobalVars(null, {checkOrigin: false, databaseBasePath: '/tmp/',
  deleteDatabaseFiles: true, useSQLiteIndexes: true});

const E = {scrolls: {}};
export default E;

function estore_put(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.put(val);
  req.onsuccess = e=>wait.continue();
  req.onerror = e=>wait.throw(e);
  return wait;
}

function edb_put(store, val){
  let tx = E.db.transaction(store, 'readwrite');
  store = tx.objectStore(store);
  return estore_put(store, val);
}

function ecursor_open(store){
  let wait = etask.wait();
  store = idb.unwrap(store);
  let req = store.openCursor();
  req.onerror = e=>wait.throw(e);
  req.onsuccess = e=>{
    let cursor = e.target.result;
    if (cursor)
      cursor.xxx_req = req;
    wait.continue(cursor);
  };
  return wait;
}

function ecursor_continue(cursor){
  let wait = etask.wait();
  cursor.xxx_req.onsuccess = e=>wait.continue(e.target.result);
  cursor.xxx_req.onerror = e=>wait.throw(e);
  cursor.continue();
  return wait;
}

E.uninit = opt=>etask(function*init(){
  if (!E.inited)
    return xerr('db not inited');
  yield E.db.close();
  E.db = E.scrolls = undefined;
  E.inited = false;
});

E.init = opt=>etask(function*init(){
  if (E.inited)
    return xerr('db already inited');
  E.inited = true;
  E.db = yield idb.openDB('lif', undefined, {
    upgrade(db, oldVersion, newVersion, transaction, event){
      db.createObjectStore('scrolls', {keyPath: 'M'});
  }});
  E.scrolls = new Map();
  let tx, store;
  tx = E.db.transaction('scrolls', 'readonly');
  store = tx.objectStore('scrolls');
  for (let cursor = yield ecursor_open(store); cursor;
    cursor = yield ecursor_continue(cursor)){
    E.scrolls.set(cursor.key, cursor.value);
  }
});

E.init_scroll = scroll=>etask(function*init_scroll(){
  assert(E.inited, 'db not inited');
  let M = b2s(scroll.M_hash(0, 0)), name = 'scroll_'+M;
  if (E.scrolls.get(M))
    return;
// XXX: if multiple, wait for it and verify we always wait for E.db
  let db_ver = E.db.version+1;
  E.db.close();
  // XXX: handle errors and make sure db is always consistent
  E.db = yield idb.openDB('lif', db_ver, {
    upgrade(db, oldVersion, newVersion, transaction, event){
      db.createObjectStore(name, {keyPath: 'seq'});
    }});
  // XXX: make it same transcation as upgrade where table created
  yield edb_put('scrolls', {M, create_ts: Date.now(), db_ver});
});

E.put_decl = (scroll, seq)=>etask(function*put_decl(){
  assert(E.inited, 'db not inited');
  let M = b2s(scroll.M_hash(0, 0)), name = 'scroll_'+M;
  yield E.init_scroll(scroll);
  let decl = scroll.get_decl(seq, {create: false});
  if (!decl)
    return;
  // XXX: need to save big data in data store
  yield edb_put(name, decl.to_static());
});

E.delete_db = ()=>etask(function*delete_db(){
  assert(!E.inited, 'db not inited');
  yield idb.deleteDB('lif');
});
