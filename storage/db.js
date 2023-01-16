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
        db.createObjectStore('data', {keyPath: 'h'});
        let scroll = db.createObjectStore('scroll', {keyPath: 'scfid'});
        scroll.createIndex('scroll', 'scroll');
        scroll.createIndex('scroll-cfid', ['scroll', 'cfid'], {unique: true});
        let decl = db.createObjectStore('decl', {keyPath: ['scfid', 'seq']});
        decl.createIndex('scfid', 'scfid');
        let branch = db.createObjectStore('branch',
          {keyPath: ['scfid', 'seq']});
        branch.createIndex('scfid', 'scfid');
    }});
    yield _this.load_scfid_next();
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
  load_scfid_next(){ return etask({_: this}, function*load_scfid_next(){
    let _this = this._;
    let tx = _this.transaction(['scroll'], 'readonly');
    let store = tx.store('scroll');
    let cursor = yield _this.cursor(store, null, 'prev');
    _this.scfid_next = cursor ? cursor.value.scfid+1 : 0;
  }); }
  copy = src=>etask({_: this}, function*copy(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._;
    assert(src.inited, 'src db not inited');
    assert(_this.inited, 'db not inited');
    let tx = _this.transaction(['scroll', 'decl', 'branch'], 'readwrite');
    let store = tx.store('scroll');
    for (let cur = yield _this.cursor(store); cur; cur = yield cur.next())
      cur.delete();
    store = tx.store('decl');
    for (let cur = yield _this.cursor(store); cur; cur = yield cur.next())
      cur.delete();
    store = tx.store('branch');
    for (let cur = yield _this.cursor(store); cur; cur = yield cur.next())
      cur.delete();
    yield tx;
    let data_scroll = [], data_decl = [], data_blob = [], data_branch = [];
    tx = src.transaction(['scroll', 'decl', 'branch'], 'readonly');
    store = tx.store('scroll');
    for (let cur = yield src.cursor(store); cur; cur = yield cur.next())
      data_scroll.push(cur.value);
    tx = src.transaction(['decl'], 'readonly');
    store = tx.store('decl');
    for (let cur = yield src.cursor(store); cur; cur = yield cur.next())
      data_decl.push(cur.value);
    tx = src.transaction(['branch'], 'readonly');
    store = tx.store('branch');
    for (let cur = yield src.cursor(store); cur; cur = yield cur.next())
      data_branch.push(cur.value);
    tx = src.transaction(['data'], 'readonly');
    store = tx.store('data');
    for (let cur = yield src.cursor(store); cur; cur = yield cur.next())
      data_blob.push(cur.value);
    tx = _this.transaction(['scroll', 'decl', 'data'], 'readwrite');
    store = tx.store('scroll');
    for (let i=0; i<data_scroll.length; i++)
      yield _this.store_put(store, data_scroll[i]);
    tx = _this.transaction(['scroll', 'decl', 'data', 'branch'], 'readwrite');
    store = tx.store('decl');
    for (let i=0; i<data_decl.length; i++)
      yield _this.store_put(store, data_decl[i]);
    store = tx.store('branch');
    for (let i=0; i<data_branch.length; i++)
      yield _this.store_put(store, data_branch[i]);
    store = tx.store('data');
    for (let i=0; i<data_blob.length; i++)
      yield _this.store_put(store, data_blob[i]);
    yield tx;
    yield _this.load_scfid_next();
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
  transaction(store_names, mode, options){
    return transaction(this.db, store_names, mode, options);
  }
  store_delete(store, key){ return store_delete(store, key); }
  store_add(store, val){ return store_add(store, val); }
  store_put(store, val){ return store_put(store, val); }
  store_get(store, val){ return store_get(store, val); }
  cursor(store, query, dir){
    let wait = etask.wait();
    store = idb.unwrap(store);
    let req = store.openCursor(query, dir);
    req.onerror = wrap_cb(e=>wait.throw(new Error('cursor '+e)));
    req.onsuccess = wrap_cb(e=>{
      let cursor = e.target.result;
      if (cursor)
        cursor.next = ()=>this.cursor_continue(cursor);
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
  only(val){ return IDBKeyRange.only(val); }
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

function transaction(db, store_names, mode, options){
  let wait = etask.wait();
  wait.tx = db.transaction(store_names, mode, options);
  wait.tx.oncomplete = wrap_cb(e=>wait.continue(e));
  wait.tx.onerror = wrap_cb(e=>wait.throw('transaction '+e));
  wait.store = name=>wait.tx.objectStore(name);
  wait.index = (sname, iname)=>wait.tx.objectStore(sname).index(iname);
  return wait;
}

DB.MAX_DECL = 64*1024;
DB.MAX_FRAME = 64*1024;
DB.init = function(opt){ global.shimIndexedDB.__setConfig(opt.shim_conf); };
