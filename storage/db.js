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

function wrap_cb(cb){
  return function(){
    try { return cb.apply(this, arguments); }
    catch(err){ xerr.xexit(err); }
  };
}

/* XXX: design
scrolls = [ // KEYPATH scfid. INDEX scroll, cfid
  {scfid: 0, scroll: '4817AB', cfid: 0},
  {scfid: 1, scroll: '4817AB', cfid: 2, splits: [{cfid: 0, seq: 37}]},
  {scfid: 2, scroll: '4817AB', cfid: 3, splits: [{cfid: 2, seq: 472},
    {0, 37}]},
  {scfid: 3, scroll: '4817AB', cfid: 4, splits: [{cfid: 2, seq: 472},
    {0, 37}], tmp: true},
];
decls = [ // KEYPATH scfig, seq
  {scfid: 0, seq: 3, M: M3, m: {0: m0_1, 1: m1}},
    D: [{sig}, {buf, h}, ...]}
  {scfid: 1, seq: 3, M: M3b1, m: {0: m0_1, 1: m1}},
    D: [{sig}, {buf, h}, ...]}
];
blob = // XXX: add scfid array so we can purge scroll
*/

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
        db.createObjectStore('scroll', {keyPath: 'M'});
        // XXX: use scroll id from scroll table instead of M for keyPath
        db.createObjectStore('decl', {keyPath: ['scroll', 'seq']});
        db.createObjectStore('data', {keyPath: 'h'});
        let scroll2 = db.createObjectStore('scroll2', {keyPath: 'scfid'});
        // XXX: do we need both 'scroll' and 'scroll-scfid' indexes?
        scroll2.createIndex('scroll', 'scroll');
        scroll2.createIndex('scroll-cfid', ['scroll', 'cfid'], {unique: true});
        let decl2 = db.createObjectStore('decl2', {keyPath: ['scfid', 'seq']});
        decl2.createIndex('scfid', 'scfid');
    }});
    _this.scrolls = new Map();
    let tx = _this.db.transaction('scroll', 'readonly');
    let store = tx.objectStore('scroll');
    for (let cursor = yield _this.cursor_open(store); cursor;
      cursor = yield _this.cursor_continue(cursor))
    {
      _this.scrolls.set(cursor.key, cursor.value);
    }
    _this.scfid_next = 0; // XXX: need to load from db
  });
  get_new_scfid(){ return this.scfid_next++; }
  uninit = (opt={})=>etask({_: this}, function*db_uninit(){
    let _this = this._;
    if (!_this.inited)
      return xerr('db not inited');
    yield _this.db.close();
    _this.db = _this.scrolls = undefined;
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
    let data_scroll = [], data_decl = [];
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
    tx = _this.create_transaction(['scroll2', 'decl2'], 'readwrite');
    store = tx.tx.objectStore('scroll2');
    for (let i=0; i<data_scroll.length; i++)
      yield _this.store_put(store, data_scroll[i]);
    tx = _this.create_transaction(['scroll2', 'decl2'], 'readwrite');
    store = tx.tx.objectStore('decl2');
    for (let i=0; i<data_decl.length; i++)
      yield _this.store_put(store, data_decl[i]);
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
  init_scroll = scroll=>etask({_: this}, function*init_scroll(){
    let _this = this._;
    assert(_this.inited, 'db not inited');
    let M = b2s(scroll.M_hash(0, 0));
    let o = _this.scrolls.get(M);
    if (o)
      return o;
    // XXX: handle errors and make sure db is always consistent
    let db_ver = _this.db.version+1, ts = Date.now();
    o = {M, create_ts: ts, update_ts: ts, db_ver};
    yield _this.db_put('scroll', o);
    _this.scrolls.set(M, o);
    return o;
  });
  get_decl = (scroll, opt)=>etask({_: this}, function*get_decl(){
    let _this = this._;
    let {seq, data} = opt;
    assert(_this.inited, 'db not inited');
    let M = b2s(scroll.M_hash(0, 0));
    yield _this.init_scroll(scroll);
    // XXX: need to get big data from data store
    let o = yield _this.db_get('decl', [M, seq]);
    if (!o)
      return scroll.get_decl(seq, {create: false});
    _this.fix_struct(o);
    let decl = scroll.get_decl(seq);
    decl.from_static(o);
    if (data)
      yield _this.get_decl_data(decl, seq);
    return decl;
  });
  get_decl_data = (decl, seq)=>etask({_: this}, function*get_decl_data(){
    let _this = this._;
    let data = decl.data_get();
    for (const [, fbuf] of data.cmap){
      let frames = fbuf.get_frames();
      for (let i=0; i<frames.length; i++){
        let f = frames[i];
        if (f.h && !f.buf){
          let o = yield _this.db_get('data', b2s(f.h));
          if (o.buf)
            fbuf.set_frame_buf(i, Buffer.from(o.buf));
        }
      }
    }
  });
  get_conflict = scroll=>etask({_: this}, function*get_conflict(){
    let _this = this._;
    assert(_this.inited, 'db not inited');
    let M = b2s(scroll.M_hash(0, 0));
    yield _this.init_scroll(scroll);
    // XXX: need to get big data from data store
    let o = yield _this.db_get('scroll', M);
    _this.fix_struct(o);
    yield scroll.conflict_from_static(o.conflict);
  });
  put_conflict = scroll=>etask({_: this}, function*put_conflict(){
    let _this = this._;
    assert(_this.inited, 'db not inited');
    let s = yield _this.init_scroll(scroll);
    s.update_ts = Date.now();
    s.conflict = scroll.conflict_to_static();
    yield _this.db_put('scroll', s);
  });
  put_decl = (scroll, seq)=>etask({_: this}, function*put_decl(){
    let _this = this._;
    assert(_this.inited, 'db not inited');
    yield _this.init_scroll(scroll);
    let decl = scroll.get_decl(seq, {create: false});
    if (!decl)
      return;
    // XXX: do all in transcation
    // XXX: need to save big data in data store
    let blob = {};
    yield _this.db_put('decl', decl.to_static({max_decl: _this.max_decl,
      max_frame: _this.max_frame, blob}));
    // XXX NOW: need blob cache (and to do it only if blob was not
    // before in db)
    for (let h in blob)
      yield _this.db_put('data', {h, buf: blob[h]});
  });
  get_scroll = scroll=>etask({_: this}, function*get_scroll(){
    let _this = this._;
    yield _this.get_conflict(scroll);
    // XXX HACK: need to iterate over all scroll decl data
    for (let i=0; i<=scroll.top.seq; i++)
      yield _this.get_decl(scroll, {seq: i, data: true});
  });
  // XXX: need test + only to update dirty data
  put_scroll = scroll=>etask({_: this}, function*put_scroll(){
    let _this = this._;
    yield _this.put_conflict(scroll);
    for (const [seq] of scroll.dmap)
      yield _this.put_decl(scroll, seq);
  });
  // XXX: decide on better way to handle buffers
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
  get_decl_static = (scroll, seq)=>etask({_: this}, function*get_decl_static(){
    let _this = this._;
    assert(_this.inited, 'db not inited');
    let M = b2s(scroll.M_hash(0, 0));
    if (!_this.scrolls.get(M))
      return null;
    // XXX: decide on better way to handle buffers
    let o = yield _this.db_get('decl', [M, seq]);
    _this.fix_struct(o);
    return o;
  });
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
