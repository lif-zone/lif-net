// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import * as idb from 'idb';
import xerr from '../util/xerr.js';
import buf_util from '../peer-relay/buf_util.js';
import setGlobalVars from 'indexeddbshim';
const b2s = buf_util.buf_to_str;
setGlobalVars();

const E = {scrolls: {}};
E.MAX_DECL = 32*1024;
E.MAX_FRAME = 32*1024;
export default E;

// XXX NOW: change estore_put -> store_put
function estore_put(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.put(val);
  req.onsuccess = e=>wait.continue();
  req.onerror = e=>wait.throw(e);
  return wait;
}

// XXX NOW: change estore_get -> store_get
function estore_get(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.get(val);
  req.onsuccess = e=>wait.continue(req.result);
  req.onerror = e=>wait.throw(e);
  return wait;
}

function edb_get(store, key){
  let tx = E.db.transaction(store, 'readonly');
  store = tx.objectStore(store);
  return estore_get(store, key);
}

E.edb_get = edb_get;

function edb_put(store, val){
  let tx = E.db.transaction(store, 'readwrite');
  store = tx.objectStore(store);
  return estore_put(store, val);
}

E.cursor_open = function cursor_continue(store){
  let wait = etask.wait();
  store = idb.unwrap(store);
  let req = store.openCursor();
  req.onerror = e=>wait.throw(e);
  req.onsuccess = e=>{
    let cursor = e.target.result;
    wait.continue(cursor);
  };
  return wait;
};

E.cursor_continue = function(cursor){
  let wait = etask.wait();
  cursor.request.onsuccess = e=>wait.continue(e.target.result);
  cursor.request.onerror = e=>wait.throw(e);
  cursor.continue();
  return wait;
};

E.uninit = opt=>etask(function*init(){
  if (!E.inited)
    return xerr('db not inited');
  yield E.db.close();
  E.db = E.scrolls = undefined;
  if (opt.delete)
    yield E.delete_db();
  E.inited = false;
});

E.init = opt=>etask(function*db_init(){
  if (E.inited)
    return xerr('db already inited');
  E.inited = true;
  E.max_frame = opt.max_frame||E.MAX_FRAME;
  E.max_decl = opt.max_decl||E.MAX_DECL;
  global.shimIndexedDB.__setConfig(opt.shim_conf);
  if (opt.delete)
    E.delete_db();
  E.db = yield idb.openDB('lif', undefined, {
    upgrade(db, oldVersion, newVersion, transaction, event){
      // XXX how to wait for creation of table and verify both are created
      db.createObjectStore('scroll', {keyPath: 'M'});
      // XXX: use scroll id from scroll table instead of M for keyPath
      db.createObjectStore('decl', {keyPath: ['scroll', 'seq']});
      db.createObjectStore('data', {keyPath: 'h'});
  }});
  E.scrolls = new Map();
  let tx, store;
  tx = E.db.transaction('scroll', 'readonly');
  store = tx.objectStore('scroll');
  for (let cursor = yield E.cursor_open(store); cursor;
    cursor = yield E.cursor_continue(cursor))
  {
    E.scrolls.set(cursor.key, cursor.value);
  }
});

E.init_scroll = scroll=>etask(function*init_scroll(){
  assert(E.inited, 'db not inited');
  let M = b2s(scroll.M_hash(0, 0));
  let o = E.scrolls.get(M);
  if (o)
    return o;
  // XXX: handle errors and make sure db is always consistent
  let db_ver = E.db.version+1, ts = Date.now();
  o = {M, create_ts: ts, update_ts: ts, db_ver};
  yield edb_put('scroll', o);
  E.scrolls.set(M, o);
  return o;
});

E.get_decl = (scroll, opt)=>etask(function*get_decl(){
  let {seq, data} = opt;
  assert(E.inited, 'db not inited');
  let M = b2s(scroll.M_hash(0, 0));
  yield E.init_scroll(scroll);
  // XXX: need to get big data from data store
  let o = yield edb_get('decl', [M, seq]);
  if (!o)
    return;
  E.fix_struct(o);
  let decl = scroll.get_decl(seq);
  decl.from_static(o);
  if (data)
    yield E.get_decl_data(decl, seq);
});

E.get_decl_data = (decl, seq)=>etask(function*get_decl_data(){
  let data = decl.data_get();
  for (const [, fbuf] of data.bmap){
    let frames = fbuf.get_frames();
    for (let i=0; i<frames.length; i++){
      let f = frames[i];
      if (f.h && !f.buf){
        let o = yield edb_get('data', b2s(f.h));
        if (o.buf)
          fbuf.set_frame_buf(i, Buffer.from(o.buf));
      }
    }
  }
});

E.get_branch = scroll=>etask(function*get_branch(){
  assert(E.inited, 'db not inited');
  let M = b2s(scroll.M_hash(0, 0));
  yield E.init_scroll(scroll);
  // XXX: need to get big data from data store
  let o = yield edb_get('scroll', M);
  E.fix_struct(o);
  yield scroll.branch_from_static(o.branch);
});

E.put_branch = scroll=>etask(function*put_branch(){
  assert(E.inited, 'db not inited');
  let s = yield E.init_scroll(scroll);
  s.update_ts = Date.now();
  s.branch = scroll.branch_to_static();
  yield edb_put('scroll', s);
});

E.put_decl = (scroll, seq)=>etask(function*put_decl(){
  assert(E.inited, 'db not inited');
  yield E.init_scroll(scroll);
  let decl = scroll.get_decl(seq, {create: false});
  if (!decl)
    return;
  // XXX: do all in transcation
  // XXX: need to save big data in data store
  let blob = {};
  yield edb_put('decl', decl.to_static({max_decl: E.max_decl,
    max_frame: E.max_frame, blob}));
  // XXX: need blob cache (and to do it only if blob was not before in db)
  for (let h in blob)
    yield edb_put('data', {h, buf: blob[h]});
});

// XXX: decide on better way to handle buffers
E.fix_struct = function fix_struct(o){
  if (!o)
    return;
  for (let name in o){
    let v = o[name];
    if (v instanceof Uint8Array)
      o[name] = Buffer.from(v);
    else if (v instanceof Object)
      E.fix_struct(v);
  }
  return o;
};

E.get_decl_static = (scroll, seq)=>etask(function*get_decl_static(){
  assert(E.inited, 'db not inited');
  let M = b2s(scroll.M_hash(0, 0));
  if (!E.scrolls.get(M))
    return null;
  // XXX: decide on better way to handle buffers
  let o = yield edb_get('decl', [M, seq]);
  E.fix_struct(o);
  return o;
});

E.delete_db = ()=>etask(function*delete_db(){
  assert(!E.db, 'db is opened');
  if (global.shimIndexedDB.__getConfig('memoryDatabase'))
    return;
  yield idb.deleteDB('lif');
});
