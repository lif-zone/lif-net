// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import xutil from '../util/util.js';
import buf_util from '../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;

/* db design
scroll = [ // KEYPATH scfid. INDEX scroll, cfid
  {scfid: 0, scroll: '4817AB', cfid: 0},
  {scfid: 1, scroll: '4817AB', cfid: 2, split: [{cfid: 0, seq: 37}]},
  {scfid: 2, scroll: '4817AB', cfid: 3, split: [{cfid: 2, seq: 472},
    {0, 37}]},
  {scfid: 3, scroll: '4817AB', cfid: 4, split: [{cfid: 2, seq: 472},
    {0, 37}], tmp: true},
];
decl = [ // KEYPATH scfid, seq
  {scfid: 0, seq: 3, M: M3, m: {0: m0_1, 1: m1}},
    D: [{sig}, {buf, h}, ...]}
  {scfid: 1, seq: 3, M: M3b1, m: {0: m0_1, 1: m1}},
    D: [{sig}, {buf, h}, ...]}
];
data = [ // KEYPATH h
  {h, buf, scfid: [1, 2]},
];
*/

export default class Storage_handler {
  constructor(opt){
    let {db} = opt;
    if (!db.inited)
      throw new Error('db not inited');
    this.db = db;
    this.db_queue = [];
    this.listeners_decl = {};
    this.sp = etask(function*Storage_handler_sp(){
      this.on('uncaught', e=>xerr.xexit(e));
      return this.wait();
    });
  }
  init(opt){ return etask({_: this}, function*init(){
    let _this = this._, db = _this.db, M = opt.M;
    if (_this.inited)
      throw new Error('storage_handler already inited');
    _this.inited = true;
    let scroll = _this.scroll = opt.scroll;
    assert.equal(scroll.top, null, 'scroll must be empty');
    assert.equal(scroll.dmap.size, 0, 'scroll must be empty');
    assert.equal(scroll.conflict.get(0).top, null, 'scroll must be empty');
    assert(!scroll.is_locked(), 'scroll is locked');
    scroll.on('conflict-removed', _this.on_conflict_removed);
    scroll.on('decl', _this.on_decl);
    if (M){
      yield scroll.lock();
      yield _this.load_conflict(M);
      yield _this.load_cfid(scroll.get_decl(0), 0);
      yield scroll.unlock();
    }
    _this.sp.spawn(etask(function*db_updater(){
      this.on('uncaught', e=>xerr.xexit(e));
      while (true){
        if (!_this.db_queue.length)
          yield _this.db_wakeup = etask.wait();
        _this.db_wakeup = null;
        let blob = {};
        let {queue_cf, queue_cf_rm, queue_decl} = _this.db_queue[0];
        let tx = db.transaction(['scroll', 'decl'], 'readwrite');
        let store = tx.store('scroll'), store2 = tx.store('decl');
        let index2 = store2.index('scfid');
        for (let i=0; i<queue_cf_rm?.length; i++){
          let scfid = queue_cf_rm[i].scfid;
          yield db.store_delete(store, scfid);
          for (let cursor = yield db.cursor(index2, db.only(scfid)); cursor;
            cursor = yield cursor.next())
          {
            cursor.delete();
          }
        }
        for (let i=0; i<queue_cf.length; i++)
          yield db.store_put(store, queue_cf[i].data);
        for (let seq in queue_decl){
          seq = +seq;
          for (let cfid in queue_decl[seq]){
            cfid = +cfid;
            if (!scroll.conflict.get(cfid)) // branch deleted
              continue;
            assert(scroll.conflict.get(cfid).db, 'missing db cfid '+cfid);
            let decl = yield scroll.get_decl(seq);
            let o = decl.to_static_cfid(cfid, {max_decl: db.max_decl,
              max_frame: db.max_frame, blob});
            yield db.store_put(store2, o);
          }
        }
        yield tx;
        for (let h in blob){
          let o = blob[h];
          let oo = (yield db.db_get('data', h))||{h, buf: o.buf, scfid: []};
          for (let cfid in o.cfid){
            cfid = +cfid;
            if (!scroll.conflict.get(cfid))
              continue;
            let scfid = scroll.conflict.get(cfid).db.data.scfid;
            if (!oo.scfid.includes(scfid))
              oo.scfid.push(scfid);
          }
          if (oo.scfid.length)
            yield db.db_put('data', oo);
        }
        _this.db_queue.shift();
        yield etask.sleep(0);
      }
    }));
  }); }
  uninit(){ return etask({_: this}, function*uninit(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._, scroll = _this.scroll;
    assert(_this.inited, 'storage_handler not inited');
    scroll.on('conflict-removed', _this.on_conflict_removed);
    scroll.on('decl', _this.on_decl);
    for (let seq in _this.listeners_decl)
      _this.rm_on_decl(_this.listeners_decl[seq]);
    yield scroll.flush();
    yield _this.sp.return();
    // XXX: how to cancel all existing running etask (eg. load_cfid)
    _this.inited = false;
  }); }
  on_conflict_removed = e=>{
    assert(this.busy, 'conflict-removed while not in update');
    assert(this.inited, 'storage_handler not inited');
    if (!e.o.db)
      return;
    this.queue_cf_rm = this.queue_cf_rm||[];
    this.queue_cf_rm.push({scfid: e.o.db.data.scfid});
    // XXX: how to cancel all existing running etask for cfid (eg. load_cfid)
    // also verify we stop load after conflict merge
  };
  on_decl = decl=>{
    assert(this.inited, 'storage_handler not inited');
    assert(!this.listeners_decl[decl.seq], 'dup decl seq'+decl.seq);
    this.listeners_decl[decl.seq] = decl;
    decl.M.on('hash', this.on_decl_update);
    for (let i=0; i<decl.m.length; i++)
      decl.m[i].on('hash', this.on_decl_update);
    decl.data.on('hash', this.on_decl_update);
    decl.data.on('data', this.on_decl_update);
  };
  rm_on_decl = decl=>{
    assert(this.inited, 'storage_handler not inited');
    delete this.listeners_decl[decl.seq];
    decl.M.off('hash', this.on_decl_update);
    for (let i=0; i<decl.m.length; i++)
      decl.m[i].off('hash', this.on_decl_update);
    decl.data.off('hash', this.on_decl_update);
    decl.data.off('data', this.on_decl_update);
  };
  on_decl_update = e=>{
    assert(this.inited, 'storage_handler not inited');
    let {seq, cfid} = e, decl = this.scroll.get_decl(seq);
    assert(this.busy, 'on_decl_update while not in update');
    assert(cfid!==undefined, 'missing cfid in event');
    assert(seq>=0, 'invalid seq in event');
    if (decl.db?.cfid[cfid]?.block_events)
      return;
    this.queue_decl = this.queue_decl||{};
    this.queue_decl[seq] = this.queue_decl[seq]||{};
    this.queue_decl[seq][cfid] = true;
  };
  flush(){ return etask({_: this}, function*flush(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._;
    assert(_this.inited, 'storage_handler not inited');
    // XXX: need to do it event based
    while (_this.db_queue.length)
      yield etask.sleep(1);
  }); }
  begin_update(){ return etask({_: this}, function*end_update(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._;
    assert(_this.inited, 'storage_handler not inited');
    assert(!_this.queue_cf_rm, 'pending quere_del');
    assert(!_this.busy, 'begin_update called while busy');
    _this.busy = true;
  }); }
  end_update(){ return etask({_: this}, function*end_update(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._, db = _this.db, scroll = _this.scroll;
    this.on('finally', ()=>_this.busy = false);
    if (!scroll.top)
      return;
    assert(_this.inited, 'storage_handler not inited');
    assert(_this.busy, 'end_update while not in update');
    let queue_cf = [];
    for (const [, o] of scroll.conflict){
      if (!o.db){
        o.db = {data: conflict_to_data(db, scroll, o)};
        queue_cf.push({new: true, data: xutil.clone_deep(o.db.data)});
      } else {
        let data = conflict_to_data(db, scroll, o);
        if (conflict_eq(o.db.data, data)) // XXX: optimize, avoid cmp
          continue;
        o.db.data = data;
        queue_cf.push({data: xutil.clone_deep(o.db.data)});
      }
      assert(o.db.data.scroll, 'missing scorll');
    }
    _this.schedule_db_update({queue_cf, queue_cf_rm: _this.queue_cf_rm,
      queue_decl: _this.queue_decl});
    _this.queue_cf_rm = _this.queue_decl = null;
  }); }
  schedule_db_update(o){
    assert(this.inited, 'storage_handler not inited');
    if (o)
      this.db_queue.push(o);
    if (this.db_wakeup)
      this.db_wakeup.continue();
  }
  load_conflict(M){ return etask({_: this}, function*load_conflict(){
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._, scroll = _this.scroll;
    assert(_this.inited, 'storage_handler not inited');
    assert.equal(scroll.top, null, 'scroll must be empty');
    assert.equal(scroll.conflict.get(0).top, null, 'scroll must be empty');
    let c = yield _this.load_conflict_static(M);
    if (!c)
      return;
    yield scroll.conflict_from_static(c, (o, co)=>{
      assert(o.db.data.scfid>=0, 'missing scfid');
      co.db = o.db;
    });
  }); }
  load_conflict_static(M){ return etask({_: this},
    function*load_conflict_static()
  {
    this.on('uncaught', e=>xerr.xexit(e));
    let _this = this._, db = _this.db, ret;
    assert(_this.inited, 'storage_handler not inited');
    let tx = db.transaction('scroll', 'readonly');
    let index = tx.index('scroll', 'scroll');
    for (let cursor = yield db.cursor(index, db.only(M)) ; cursor;
      cursor = yield cursor.next())
    {
      ret = ret||{};
      let data = db.fix_struct(cursor.value);
      let {cfid, top, split} = data;
      // XXX: do some sanity on values, throw error is invalid
      ret[cfid] = {cfid, top: {seq: top.seq, M: s2b(top.M)},
        db: {data}};
      if (split)
        ret[cfid].parent = split[0];
    }
    return ret;
  }); }
  is_loaded(decl, cfid, opt={data: true}){
    if (!decl.db?.cfid[cfid])
      return false;
    if (decl.db.cfid[cfid].busy)
      return false;
    if (opt.data)
      return decl.db.cfid[cfid].data ? !decl.db.cfid[cfid].data.busy : false;
    return true;
  }
  load_cfid(decl, cfid, opt={}){
    assert(this.inited, 'storage_handler not inited');
    assert.equal(decl.scroll, this.scroll, 'differnt decl scroll');
    assert(this.busy, 'load_cfid but not in begin_update');
    let scfid = this.scroll.conflict.get(cfid)?.db?.data.scfid;
    if (!Number.isInteger(scfid))
      return;
    if (decl.db?.cfid[cfid]){
      if (!decl.db.cfid[cfid].busy)
        return opt.data && this.load_cfid_data(decl, cfid);
      return etask({_: this}, function*load_cfid_wait(){
        this.on('uncaught', e=>xerr.xexit(e));
        let _this = this._;
        yield this.wait_ext(decl.db.cfid[cfid].busy);
        if (opt.data)
          return _this.load_cfid_data(decl, cfid);
      });
    }
    decl.db = decl.db||{cfid: {}};
    decl.db.cfid[cfid] = {};
    return decl.db.cfid[cfid].busy = etask({_: this}, function*load_cfid(){
      this.on('uncaught', e=>xerr.xexit(e));
      let _this = this._, db = _this.db;
      let tx = db.transaction('decl', 'readonly');
      let data = yield db.store_get(tx.store('decl'), [scfid, decl.seq]);
      if (!data)
        return decl.db.cfid[cfid].busy = null;
      assert.equal(scfid, _this.scroll.conflict.get(cfid).db?.data.scfid,
        'scfid was already deleted');
      data = db.fix_struct(data);
      decl.db.cfid[cfid].block_events = true;
      yield decl.from_static_cfid(cfid, data);
      decl.db.cfid[cfid].block_events = false;
      decl.db.cfid[cfid].busy = null;
      if (opt.data)
        return _this.load_cfid_data(decl, cfid);
    });
  }
  load_cfid_data(decl, cfid){
    assert(this.inited, 'storage_handler not inited');
    assert(decl.db?.cfid[cfid] && !decl.db.cfid[cfid].busy,
      'cannot load data before loading seq'+decl.seq);
    assert(this.busy, 'load_cfid_data but not in begin_update');
    if (decl.db.cfid[cfid].data){
      if (!decl.db.cfid[cfid].data.busy)
        return;
      return etask({_: this}, function*load_cfid_data_wait(){
        this.on('uncaught', e=>xerr.xexit(e));
        let _this = this._;
        return _this.wait_ext(decl.db.cfid[cfid].data.busy);
      });
    }
    decl.db.cfid[cfid].data = {};
    return decl.db.cfid[cfid].data.busy = etask({_: this},
      function*load_cfid_data()
    {
      this.on('uncaught', e=>xerr.xexit(e));
      let _this = this._, db = _this.db;
      let data = decl.data_get();
      let fbuf = data.cmap.get(cfid);
      if (!fbuf)
        return decl.db.cfid[cfid].data.busy = null;
      let frames = fbuf.get_frames();
      for (let i=0; i<frames.length; i++){
        let f = frames[i];
        if (f.h && !f.buf){
          let o = yield db.db_get('data', b2s(f.h));
          if (o?.buf)
            yield fbuf.set_frame_buf(i, Buffer.from(o.buf));
        }
      }
      decl.db.cfid[cfid].data.busy = null;
    });
  }
  init_static_cfid(o, co){
    let scfid = co.db?.data.scfid;
    if (scfid>=0)
      o.scfid = scfid;
  }
}

function conflict_to_data(db, scroll, o){
  let scfid = o.db ? o.db.data.scfid : db.get_new_scfid();
  let cfid = o.cfid, top = {seq: o.top.seq, M: b2s(o.top.M)};
  let data = {scfid, scroll: scroll.name, cfid, top};
  if (!o.parent)
    return data;
  let parent = o.parent;
  data.split = [];
  data.type = parent.type;
  while (parent){
    data.split.push({cfid: parent.cfid, seq: parent.seq, type: parent.type});
    parent = scroll.conflict.get(parent.cfid).parent;
  }
  return data;
}

function conflict_eq(data, data2){ return xutil.equal_deep(data, data2); }

