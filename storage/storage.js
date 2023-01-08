// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
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
  {h, buf, scfid: [1]},
];
*/

export default class Storage_handler {
  constructor(opt){
    let {db} = opt;
    if (!db.inited)
      throw new Error('db not inited');
    this.db = db;
    this.db_queue = [];
    // XXX: derry
    this.sp = etask(function*Storage_handler_sp(){ return this.wait(); });
  }
  init(opt){ return etask({_: this}, function*init(){
    let _this = this._, db = _this.db, M = opt.M;
    if (_this.inited)
      throw new Error('storage_handler already inited');
    _this.inited = true;
    let scroll = _this.scroll = opt.scroll;
    assert.equal(scroll.top, null, 'scroll must be empty');
    assert.equal(scroll.conflict.get(0).top, null, 'scroll must be empty');
    if (M){
      yield _this.load_conflict(M);
      yield _this.load_cfid(scroll.get_decl(0), 0);
    }
    _this.on_decl(scroll.get_decl(0));
    scroll.on('conflict-removed', _this.on_conflict_removed);
    scroll.on('decl', _this.on_decl);
    // XXX: 1. run in a worker 2. abort transcation on error
    _this.sp.spawn(etask(function*db_updater(){
      while (true){
        try {
          if (!_this.db_queue.length)
            yield _this.db_wakeup = etask.wait();
          _this.db_wakeup = null;
          let blob = {};
          let {queue_cf, queue_cf_rm, queue_decl} = _this.db_queue[0];
          let tx = db.transaction(['scroll2', 'decl2'], 'readwrite');
          let store = tx.store('scroll2'), store2 = tx.store('decl2');
          let index2 = store2.index('scfid');
          for (let i=0; i<queue_cf_rm?.length; i++){
            let scfid = queue_cf_rm[i].scfid;
            yield db.store_delete(store, scfid);
            // XXX: wrap in api
            let query = IDBKeyRange.only(scfid);
            for (let cursor = yield db.cursor(index2, query); cursor;
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
              // XXX: WIP - should never happy, handle with events
              if (!scroll.conflict.get(cfid)) // XXX: TODO (branch deleted)
                continue;
              if (!scroll.conflict.get(cfid).db) // XXX: TODO
                continue;
              let decl = yield scroll.get_decl(seq);
              let o = decl.to_static_cfid(cfid, {max_decl: db.max_decl,
                max_frame: db.max_frame, blob});
              yield db.store_put(store2, o);
            }
          }
          yield tx;
          // XXX NOW: need blob cache (and to do it only if blob was not
          // before in db)
          for (let h in blob) // XXX: save scfid in array
            yield db.db_put('data', {h, buf: blob[h]});
          _this.db_queue.shift();
          yield etask.sleep(0);
        }
        // XXX: decide how to handle errors
        catch(err){ assert.fail('error '+(err?.message||err)); }
      }
    }));
  }); }
  uninit(){ return etask({_: this}, function*uninit(){
    let _this = this._;
    yield _this.flush();
    _this.sp.return();
    // XXX: need to unregister all cb
  }); }
  on_conflict_removed = e=>{
    assert(this.busy, 'conflict-removed while not in update');
    if (!e.o.db)
      return;
    this.queue_cf_rm = this.queue_cf_rm||[];
    this.queue_cf_rm.push({scfid: e.o.db.data.scfid});
  };
  on_decl = decl=>{
    if (this.block_events)
      return;
    decl.M.on('hash', this.on_decl_update);
    for (let i=0; i<decl.m.length; i++)
      decl.m[i].on('hash', this.on_decl_update);
    decl.data.on('hash', this.on_decl_update);
    decl.data.on('data', this.on_decl_update);
  };
  on_decl_update = e=>{
    if (this.block_events)
      return;
    // XXX: enable once old db code is removed
    // assert(this.busy, 'on_decl_update while not in update');
    assert(e.cfid!==undefined, 'missing cfid in event');
    assert(e.seq>=0, 'invalid seq in event');
    this.queue_decl = this.queue_decl||{};
    this.queue_decl[e.seq] = this.queue_decl[e.seq]||{};
    this.queue_decl[e.seq][e.cfid] = true;
    // XXX: need to remove range for new created decl
  };
  flush(){ return etask({_: this}, function*flush(){
    let _this = this._;
    // XXX: need to do it event based
    while (_this.db_queue.length)
      yield etask.sleep(1);
  }); }
  begin_update(){ return etask({_: this}, function*end_update(){
    let _this = this._;
    assert(_this.inited, 'storage_handler not inited');
    assert(!_this.queue_cf_rm, 'pending quere_del');
    // XXX: review with derry and wrap it
    while (_this.busy)
      this.wait_ext(_this.busy);
    _this.busy = etask.wait();
  }); }
  end_update(){ return etask({_: this}, function*end_update(){
    let _this = this._, db = _this.db, scroll = _this.scroll;
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
    let wait = _this.busy;
    _this.busy = _this.queue_cf_rm = _this.queue_decl = null;
    wait.continue();
  }); }
  schedule_db_update(o){
    assert(this.inited, 'storage_handler not inited');
    if (o)
      this.db_queue.push(o);
    if (this.db_wakeup)
      this.db_wakeup.continue();
  }
  load_conflict(M){ return etask({_: this}, function*load_conflict(){
    let _this = this._, scroll = _this.scroll;
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
    let _this = this._, db = _this.db, ret;
    let tx = db.transaction('scroll2', 'readonly');
    let index = tx.index('scroll2', 'scroll');
    let query = IDBKeyRange.only(M);
    for (let cursor = yield db.cursor(index, query) ; cursor;
      cursor = yield cursor.next())
    {
      ret = ret||{};
      let data = db.fix_struct(cursor.value);
      let {cfid, top, split} = data;
      // XXX: do some sanity on valeus, throw error is invalid
      ret[cfid] = {cfid, top: {seq: top.seq, M: s2b(top.M)},
        db: {data}};
      if (split)
        ret[cfid].parent = split[0];
    }
    return ret;
  }); }
  load_cfid(decl, cfid, opt={}){
    assert.equal(decl.scroll, this.scroll, 'differnt decl scroll');
    let scfid = this.scroll.conflict.get(cfid)?.db?.data.scfid;
    if (!Number.isInteger(scfid))
      return;
    if (decl.db?.cfid[cfid]){
      if (!decl.db.cfid[cfid].busy && (!opt.data || decl.db.cfid[cfid].data))
        return;
      // XXX: is there better way
      return etask({_: this}, function*load_cfid_wait(){
        let _this = this._;
        this.on('finally', ()=>decl.db.cfid[cfid].busy = null);
        while (this.wait_ext(decl.db.cfid[cfid].busy))
          yield this.wait_ext(decl.db.cfid[cfid].busy);
        if (!opt.data || decl.db?.cfid[cfid].data)
          return;
        decl.db.cfid[cfid].busy = this;
        yield _this.load_cfid_data(decl, cfid);
      });
    }
    decl.db = decl.db||{cfid: {}};
    decl.db.cfid[cfid] = {};
    // XXX: handle errors
    return decl.db.cfid[cfid].busy = etask({_: this}, function*load_cfid(){
      let _this = this._, db = _this.db;
      this.on('finally', ()=>decl.db.cfid[cfid].busy = null);
      let tx = db.transaction('decl2', 'readonly');
      let data = yield db.store_get(tx.store('decl2'), [scfid, decl.seq]);
      if (!data)
        return;
      assert.equal(scfid, _this.scroll.conflict.get(cfid).db?.data.scfid,
        'scfid was already deleted');
      data = db.fix_struct(data);
      _this.block_events = true;
      yield decl.from_static_cfid(cfid, data);
      _this.block_events = false;
      if (!opt.data)
        return;
      yield _this.load_cfid_data(decl, cfid);
    });
  }
  load_cfid_data(decl, cfid){ return etask({_: this}, function*load_cfid_data()
  {
    let _this = this._, db = _this.db;
    let data = decl.data_get();
    let fbuf = data.cmap.get(cfid);
    if (!fbuf)
      return;
    let frames = fbuf.get_frames();
    for (let i=0; i<frames.length; i++){
      let f = frames[i];
      if (f.h && !f.buf){
        let o = yield db.db_get('data', b2s(f.h));
        if (o?.buf)
          yield fbuf.set_frame_buf(i, Buffer.from(o.buf));
      }
    }
    decl.db.cfid[cfid].data = true;
  }); }
}

// XXX: need test
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

// XXX: need test (and fix to avoid equal_deep)
function conflict_eq(data, data2){ return xutil.equal_deep(data, data2); }

// XXX TODO:
// 1. need to lock scroll/db so only one is doing changes at the same time
//    (and decide when need to lock read during update operations)
//    review _this.wait
//    and make sure that when we read data from db, it's only after
//    flush/no-lock
// 2. begin_update/end_update for scroll.decl and verify if other places we
//    update data
// 4. verify we rebuild minfo/conflicts on scroll.conflict when loading scroll
//    from db
// 5. handle db.uninit (need to notify Storage_handler to write to db)
// 6. run db operations in a worker
// 10. _this -> this_
// 11. move storage part to storage.js
// 12. check what to do when Data.copy is called (this.cmap.delete(csrc))
// 13. rm obsolete scroll/decl stores
// 15. rename to_static2 and rm obsolete to_static/from_static etc
// 16. save blob
// 18. rename struct_from_db2 -> struct_from_db and rm struct_from_db
// 19. rm xxx_db_old_to_new
// 20. change decl table to include also scroll name
//     (for easy delete of scorll)
// 21. review all possible errors and handle properly
// 23. wait for success on db.init
// 26. review fbuf_load_async/regular usage
// 27. verify behavior of loading data that was declared in memory and not yet
//     flushed
// 28. verify we don't queue stuff during load from db
// 29. test read/write with multiple tables and verify no scfid confusion and
//     scfid_next is loaded correctly
// 30. write scfid to blob data table so we can do purge
// 31. verify that multiple load will not try to load more than once
// 32. protect put (verify diff is valid)
// 33. rm scfid/db direct usage in scroll
// 34. stop etasks after branch removed-merge etc and decl.db.cfid[cfid]
// 35. make all conflict changes event-based and rm conflict_eq

// XXX derry:
// 1. _this -> this_
// 2. mv _this to etask(function*(_this)) and consider make this of etask _this
// 3. EventEmitterAsync
// 4. review storage in scroll
// 5. review load_cfid
// 6. review db_updater + this.sp
// 7. blob - how to delete scfid from array when branch is removed (or merge)
