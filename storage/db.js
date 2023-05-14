// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import xutil from '../util/util.js';
import * as idb from 'idb';
import xerr from '../util/xerr.js';
const is_node = typeof navigator==='undefined';

function wrap_cb(cb){
  return function(){
    try { return cb.apply(this, arguments); }
    catch(err){ xerr.xexit(err); }
  };
}

export default class DB {
  constructor(opt){ this.soul = opt.soul; }
  init = (opt={})=>etask({_: this}, function*db_init(){
    if (!DB.inited && xutil.is_mocha()){
      // XXX: use memoryDatabase: ':memory:'
      yield DB.init({shim_conf: {checkOrigin: false, databaseBasePath: '/tmp',
        deleteDatabaseFiles: true, useSQLiteIndexes: true}});
    }
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
        let index_table = db.createObjectStore('index_table', {keyPath: 'id'});
        index_table.createIndex('scroll', 'scroll');
        db.createObjectStore('index', {keyPath: ['id', 'key', 'seq']});
    }});
    yield _this.load_scfid_next();
    yield _this.load_index_id_next();
  });
  get_new_scfid(){ return this.scfid_next++; } // XXX: mv to soul
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
  load_index_id_next(){ return etask({_: this}, function*load_index_id_next(){
    let _this = this._;
    let tx = _this.transaction(['index_table'], 'readonly');
    let store = tx.store('index_table');
    let cursor = yield _this.cursor(store, null, 'prev');
    _this.soul.index_id_next = cursor ? cursor.value.id+1 : 0;
  }); }
  copy_store = (db, name)=>etask({_: this}, function*copy_store(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._;
    assert(db.inited, 'src db not inited');
    assert(_this.inited, 'db not inited');
    let tx = _this.transaction([name], 'readwrite'), store = tx.store(name);
    for (let cur = yield _this.cursor(store); cur; cur = yield cur.next())
      cur.delete();
    yield tx;
    let data = [];
    tx = db.transaction([name], 'readonly');
    store = tx.store(name);
    for (let cur = yield db.cursor(store); cur; cur = yield cur.next())
      data.push(cur.value);
    tx = _this.transaction([name], 'readwrite');
    store = tx.store(name);
    for (let i=0; i<data.length; i++)
      yield _this.store_put(store, data[i]);
    yield tx;
  });
  copy = src=>etask({_: this}, function*copy(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._;
    yield _this.copy_store(src, 'scroll');
    yield _this.copy_store(src, 'decl');
    yield _this.copy_store(src, 'data');
    yield _this.copy_store(src, 'branch');
    yield _this.copy_store(src, 'index');
    yield _this.copy_store(src, 'index_table');
    yield _this.load_scfid_next();
    yield _this.load_index_id_next();
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
    if (DB.t.cursor_hook)
      DB.t.cursor_hook(store, query, dir);
    let req = store.openCursor(query, dir);
    req.onerror = wrap_cb(e=>wait.throw(new Error('cursor '+e)));
    req.onsuccess = wrap_cb(e=>{
      let cursor = e.target.result;
      if (cursor){
        cursor.next = ()=>{
          if (DB.t.cursor_hook)
            cursor.t = {store, query, dir};
          return this.cursor_continue(cursor);
        };
      }
      wait.continue(cursor);
    });
    return wait;
  }
  cursor_continue(cursor){
    if (DB.t.cursor_continue_hook)
      DB.t.cursor_continue_hook(cursor);
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
    if (global.shimIndexedDB?.__getConfig('memoryDatabase'))
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

function limit_to_str(v){
  if (!Array.isArray(v))
    return v===undefined ? '' : ''+v;
  let s = '';
  v.forEach(vv=>s += (s=='' ? '' : '_')+(vv===undefined ? '' : vv));
  return s;
}

function query_to_str(store, query, dir){
  let e = store.name;
  if (dir=='prev')
    e += ',rev';
  if (query){
    let lower = limit_to_str(query.lower||query.__lower);
    let upper = limit_to_str(query.upper||query.__upper);
    if (lower==upper)
      e += ',key=='+lower;
    else if (upper==='')
      e += ','+lower+'<=key';
    else if (lower==='')
      e += 'key<='+upper;
    else
      e += ','+lower+'<=key<='+upper;
  }
  return e;
}

if (is_node){
  // XXX HACK: find a better way to load it for now (without using async)
  (async function(){
    let setGlobalVars = (await import('indexeddbshim')).default;
    await setGlobalVars(null, {addNonIDBGlobals: true});
  })();
}

DB.MAX_DECL = 64*1024;
DB.MAX_FRAME = 64*1024;
DB.init = opt=>etask(function*db_init(){
  assert(!DB.inited, 'DB already inited');
  DB.inited = true;
  if (!is_node)
    return;
  // XXX HACK: we need to sleep so shim be applied
  yield etask.sleep(0);
  global.ShimEventTarget.prototype.triggerErrorEvent =
    (err, evt)=>xerr.xexit(err);
  global.DOMException = global.ShimDOMException;
  global.shimIndexedDB.__setConfig(opt.shim_conf || (opt.db_dir ?
    {checkOrigin: false, databaseBasePath: opt.db_dir,
    useSQLiteIndexes: true} : undefined));
});

DB.query_to_str = query_to_str;
DB.t = {};
