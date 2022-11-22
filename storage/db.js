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

export default class DB {
  init = opt=>etask({_: this}, function*db_init(){
    let _this = this._;
    if (_this.inited)
      return xerr('db already inited');
    _this.inited = true;
    _this.max_frame = opt.max_frame||DB.MAX_FRAME;
    _this.max_decl = opt.max_decl||DB.MAX_DECL;
    global.shimIndexedDB.__setConfig(opt.shim_conf);
    if (opt.delete)
      _this.delete_db();
    _this.db = yield idb.openDB('lif', undefined, {
      upgrade(db, oldVersion, newVersion, transaction, event){
        // XXX how to wait for creation of table and verify both are created
        db.createObjectStore('scroll', {keyPath: 'M'});
        // XXX: use scroll id from scroll table instead of M for keyPath
        db.createObjectStore('decl', {keyPath: ['scroll', 'seq']});
        db.createObjectStore('data', {keyPath: 'h'});
    }});
    _this.scrolls = new Map();
    let tx, store;
    tx = _this.db.transaction('scroll', 'readonly');
    store = tx.objectStore('scroll');
    for (let cursor = yield _this.cursor_open(store); cursor;
      cursor = yield _this.cursor_continue(cursor))
    {
      _this.scrolls.set(cursor.key, cursor.value);
    }
  });
  uninit = opt=>etask({_: this}, function*db_uninit(){
    let _this = this._;
    if (!_this.inited)
      return xerr('db not inited');
    yield _this.db.close();
    _this.db = _this.scrolls = undefined;
    if (opt.delete)
      yield _this.delete_db();
    _this.inited = false;
  });
  db_get(store, key){
    let tx = this.db.transaction(store, 'readonly');
    store = tx.objectStore(store);
    return store_get(store, key);
  }
  db_put(store, val){
    let tx = this.db.transaction(store, 'readwrite');
    store = tx.objectStore(store);
    return store_put(store, val);
  }
  cursor_open(store){
    let wait = etask.wait();
    store = idb.unwrap(store);
    let req = store.openCursor();
    req.onerror = e=>wait.throw(e);
    req.onsuccess = e=>{
      let cursor = e.target.result;
      wait.continue(cursor);
    };
    return wait;
  }
  cursor_continue(cursor){
    let wait = etask.wait();
    cursor.request.onsuccess = e=>wait.continue(e.target.result);
    cursor.request.onerror = e=>wait.throw(e);
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
      return;
    _this.fix_struct(o);
    let decl = scroll.get_decl(seq);
    decl.from_static(o);
    if (data)
      yield _this.get_decl_data(decl, seq);
  });
  get_decl_data = (decl, seq)=>etask({_: this}, function*get_decl_data(){
    let _this = this._;
    let data = decl.data_get();
    for (const [, fbuf] of data.bmap){
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
  get_branch = scroll=>etask({_: this}, function*get_branch(){
    let _this = this._;
    assert(_this.inited, 'db not inited');
    let M = b2s(scroll.M_hash(0, 0));
    yield _this.init_scroll(scroll);
    // XXX: need to get big data from data store
    let o = yield _this.db_get('scroll', M);
    _this.fix_struct(o);
    yield scroll.branch_from_static(o.branch);
  });
  put_branch = scroll=>etask({_: this}, function*put_branch(){
    let _this = this._;
    assert(_this.inited, 'db not inited');
    let s = yield _this.init_scroll(scroll);
    s.update_ts = Date.now();
    s.branch = scroll.branch_to_static();
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
    yield idb.deleteDB('lif');
  });
}

function store_put(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.put(val);
  req.onsuccess = e=>wait.continue();
  req.onerror = e=>wait.throw(e);
  return wait;
}

function store_get(store, val){
  store = idb.unwrap(store);
  let wait = etask.wait();
  let req = store.get(val);
  req.onsuccess = e=>wait.continue(req.result);
  req.onerror = e=>wait.throw(e);
  return wait;
}

DB.MAX_DECL = 64*1024;
DB.MAX_FRAME = 64*1024;
