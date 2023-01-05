// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import * as idb from 'idb';
import xerr from '../util/xerr.js';
import setGlobalVars from 'indexeddbshim';
setGlobalVars(null, {addNonIDBGlobals: true});
global.ShimEventTarget.prototype.triggerErrorEvent =
  (err, evt)=>xerr.xexit(err);
global.DOMException = global.ShimDOMException;

function wrap_cb(cb){
  return function(){
    try { return cb.apply(this, arguments); }
    catch(err){ xerr.xexit(err); }
  };
}

export default class DB {
  init = (opt={})=>etask({_: this}, function*db_init(){
    let _this = this._;
    if (_this.inited)
      return xerr('db already inited');
    _this.inited = true;
    _this.postfix = opt.postfix ? '_'+opt.postfix : '';
    _this.max_frame = opt.max_frame||DB.MAX_FRAME;
    _this.max_decl = opt.max_decl||DB.MAX_DECL;
    if (opt.delete)
      yield _this.delete_db();
    _this.db = yield idb.openDB('lif_db'+_this.postfix, undefined, {
      upgrade(db, oldVersion, newVersion, transaction, event){
        // XXX how to wait for creation of table and verify both are created
        // XXX: rm obsolete scroll and rename scroll2->scroll
        db.createObjectStore('data', {keyPath: 'h'});
        let scroll2 = db.createObjectStore('scroll2', {keyPath: 'scfid'});
        // XXX: do we need both 'scroll' and 'scroll-scfid' indexes?
        scroll2.createIndex('scroll', 'scroll');
        scroll2.createIndex('scroll-cfid', ['scroll', 'cfid'], {unique: true});
        let decl2 = db.createObjectStore('decl2', {keyPath: ['scfid', 'seq']});
        decl2.createIndex('scfid', 'scfid');
    }});
    _this.scfid_next = 0; // XXX: need to load from db
  });
  get_new_scfid(){ return this.scfid_next++; }
  uninit = (opt={})=>etask({_: this}, function*db_uninit(){
    let _this = this._;
    if (!_this.inited)
      return xerr('db not inited');
    yield _this.db.close();
    _this.db = undefined;
    if (opt.delete)
      yield _this.delete_db();
    _this.inited = false;
  });
  copy = src=>etask({_: this}, function*copy(){
    // XXX HACK: write it properly
    let _this = this._;
    assert(src.inited, 'src db not inited');
    assert(_this.inited, 'db not inited');
    let tx = _this.create_transaction(['scroll2', 'decl2'], 'readwrite');
    let store = tx.tx.objectStore('scroll2');
    for (let cursor = yield _this.cursor_open(store); cursor;
      cursor = yield _this.cursor_continue(cursor))
    {
      cursor.delete();
    }
    store = tx.tx.objectStore('decl2');
    for (let cursor = yield _this.cursor_open(store); cursor;
      cursor = yield _this.cursor_continue(cursor))
    {
      cursor.delete();
    }
    yield tx;
    let data_scroll = [], data_decl = [], data_blob = [];
    let tx2 = src.create_transaction(['scroll2', 'decl2'], 'readonly');
    let store2 = tx2.tx.objectStore('scroll2');
    for (let cursor = yield src.cursor_open(store2); cursor;
      cursor = yield src.cursor_continue(cursor))
    {
      data_scroll.push(cursor.value);
    }
    tx2 = src.create_transaction(['scroll2', 'decl2'], 'readonly');
    store2 = tx2.tx.objectStore('decl2');
    for (let cursor = yield src.cursor_open(store2); cursor;
      cursor = yield src.cursor_continue(cursor))
    {
      data_decl.push(cursor.value);
    }
    tx2 = src.create_transaction(['data'], 'readonly');
    store2 = tx2.tx.objectStore('data');
    for (let cursor = yield src.cursor_open(store2); cursor;
      cursor = yield src.cursor_continue(cursor))
    {
      data_blob.push(cursor.value);
    }
    tx = _this.create_transaction(['scroll2', 'decl2', 'data'], 'readwrite');
    store = tx.tx.objectStore('scroll2');
    for (let i=0; i<data_scroll.length; i++)
      yield _this.store_put(store, data_scroll[i]);
    tx = _this.create_transaction(['scroll2', 'decl2', 'data'], 'readwrite');
    store = tx.tx.objectStore('decl2');
    for (let i=0; i<data_decl.length; i++)
      yield _this.store_put(store, data_decl[i]);
    store = tx.tx.objectStore('data');
    for (let i=0; i<data_blob.length; i++)
      yield _this.store_put(store, data_blob[i]);
    yield tx;
  });
  db_get(name, key){
    let tx = this.db.transaction(name, 'readonly');
    let store = tx.objectStore(name);
    return store_get(store, key);
  }
  db_put(name, val){
    let tx = this.db.transaction(name, 'readwrite');
    let store = tx.objectStore(name);
    return store_put(store, val);
  }
  db_add(name, val){
    let tx = this.db.transaction(name, 'readwrite');
    let store = tx.objectStore(name);
    return store_add(store, val);
  }
  create_transaction(store_names, mode, options){
    return create_transaction(this.db, store_names, mode, options);
  }
  store_delete(store, key){ return store_delete(store, key); }
  store_add(store, val){ return store_add(store, val); }
  store_put(store, val){ return store_put(store, val); }
  store_get(store, val){ return store_get(store, val); }
  cursor_open(store, query, dir){
    let wait = etask.wait();
    store = idb.unwrap(store);
    let req = store.openCursor(query, dir);
    req.onerror = wrap_cb(e=>wait.throw(new Error('cursor_open '+e)));
    req.onsuccess = wrap_cb(e=>{
      let cursor = e.target.result;
      wait.continue(cursor);
    });
    return wait;
  }
  cursor_continue(cursor){
    let wait = etask.wait();
    cursor.request.onsuccess = wrap_cb(e=>wait.continue(e.target.result));
    cursor.request.onerror = wrap_cb(
      e=>wait.throw(new Error('cursor_continue '+e)));
    cursor.continue();
    return wait;
  }
  fix_struct(o){
    if (!o)
      return;
    for (let name in o){
      let v = o[name];
      if (v instanceof Uint8Array)
        o[name] = Buffer.from(v);
      else if (v instanceof Object)
        this.fix_struct(v);
    }
    return o;
  }
  delete_db = ()=>etask({_: this}, function*delete_db(){
    let _this = this._;
    assert(!_this.db, 'db is opened');
    if (global.shimIndexedDB.__getConfig('memoryDatabase'))
      return;
    yield idb.deleteDB('lif_db'+_this.postfix);
  });
}

function store_add(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.add(val);
  req.onsuccess = wrap_cb(e=>wait.continue());
  req.onerror = wrap_cb(e=>wait.throw(new Error(store.__name+': '+req.error)));
  return wait;
}

function store_put(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.put(val);
  req.onsuccess = wrap_cb(e=>wait.continue());
  req.onerror = wrap_cb(e=>wait.throw(new Error(req.error)));
  return wait;
}

function store_get(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.get(val);
  req.onsuccess = wrap_cb(e=>wait.continue(req.result));
  req.onerror = wrap_cb(e=>wait.throw(new Error(store.__name+': '+req.error)));
  return wait;
}

function store_delete(store, key){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.delete(key);
  req.onsuccess = wrap_cb(e=>wait.continue(req.result));
  req.onerror = wrap_cb(e=>wait.throw(new Error(store.__name+': '+req.error)));
  return wait;
}

function create_transaction(db, store_names, mode, options){
  let wait = etask.wait();
  wait.tx = db.transaction(store_names, mode, options);
  wait.tx.oncomplete = wrap_cb(e=>wait.continue(e));
  wait.tx.onerror = wrap_cb(e=>wait.throw('create_transaction '+e));
  return wait;
}

DB.MAX_DECL = 64*1024;
DB.MAX_FRAME = 64*1024;
DB.init = function(opt){ global.shimIndexedDB.__setConfig(opt.shim_conf); };
