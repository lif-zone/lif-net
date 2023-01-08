'use strict'; /*global describe,it,beforeEach,afterEach*/
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';
import enc from 'compact-encoding';
import tparser from './test_parser.js';
import xtest from '../util/test_lib.js'; // eslint-disable-line no-unused-vars
import etask from '../util/etask.js';
import crypto from '../util/crypto.js';
import string from '../util/string.js';
import Storage_handler from './storage.js';
import xsinon from '../util/sinon.js';
import Scroll from './scroll.js';
import Soul from './soul.js';
import DB from './db.js';
import buf_util from '../peer-relay/buf_util.js';
import {r_str, r_from_str, r_parent} from './range.js';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;
const assign = Object.assign; // XXX: rm, use ...
function enc_u64(v){ return enc.encode(enc.uint64, v); }
let t_soul, t_soul_id, t_soul_mode, t_state;
let t_scroll, t_genesis_scroll, t_prev_scroll, t_def, t_keypair;

// XXX: need test and move to buf_util.js
function b2s_obj(o, ret){
  if (!o || !(o instanceof Object))
    return o;
  ret = ret||{};
  for (let name in o){
    let v = o[name];
    if (v instanceof Uint8Array)
      ret[name] = b2s(Buffer.from(v));
    else if (Buffer.isBuffer(v))
      ret[name] = b2s(v);
    else if (v instanceof Object){
      ret[name] = {};
      b2s_obj(v, ret[name]);
    } else
      ret[name] = v;
  }
  return ret;
}

// XXX: use memoryDatabase: ':memory:'
DB.init({shim_conf: {checkOrigin: false, databaseBasePath: '/tmp',
  deleteDatabaseFiles: true, useSQLiteIndexes: true}});

// XXX: make it automatic for all node/browser in proc.js
process.on('uncaughtException', err=>xerr.xexit(err));
process.on('unhandledRejection', err=>xerr.xexit(err));
xerr.set_exception_handler('test', (prefix, o, err)=>xerr.xexit(err));

if (!xutil.is_inspect())
  beforeEach(function(){ xerr.set_buffered(true, 1000); });

afterEach(function(){
  if (this.currentTest.timedOut){
    xerr.notice(this.currentTest.err.stack);
    assert.fail(this.currentTest.fullTitle()+': FAILED TIMEOUT');
  }
  xerr.clear();
  xerr.set_buffered(false);
});

function space(s){ return s ? s+' ' : ''; }

function tjoin(v, cmd, arg){
  let s = v ? v+'.'+cmd : cmd;
  return arg ? s+'('+arg+')' : s;
}

function macro_to_m(val, dst){
  const to_nd = ch=>{
    let n = /[a-z]/.test(ch) ? ch.charCodeAt(0)-'a'.charCodeAt(0) :
      /[A-Z]/.test(ch) ? ch.charCodeAt(0)-'A'.charCodeAt(0) : +ch;
    let d = dst+(/[a-z]/.test(ch) ? '1' : /[A-Z]/.test(ch) ? '2' : '');
    return {n, d};
  };
  assert(dst, 'missing dst');
  let s = '', a = string.split_ws(val);
  for (let i=0; i<a.length; i++){
    if (/^[\da-zA-Z]$/.test(a[i])){
      let ch = a[i];
      let {n, d} = to_nd(ch);
      s = space(s)+(i==a.length-1 ? d+'.sig'+n+' '+d+'.D'+n : d+'.m'+n);
      continue;
    }
    let m = a[i].split('_');
    // XXX: need to assert if valid m
    assert(m.length>1, 'invalid m '+val);
    let {n, d} = to_nd(m[m.length-1]);
    let n0 = to_nd(m[0]).n;
    s = space(s)+d+'.m'+n0+'_'+n;
  }
  return s;
}

const array_from_str = exp=>etask(function*array_from_str(){
  let ret=[], a=[];
  for (let curr=exp, i=0; curr = tparser.parse_get_next(curr); i++)
    a.push(curr.exp);
  for (let i=0; i<a.length; i++)
    ret.push(yield get_val(a[i]));
  return ret;
});

const struct_from_str = exp=>etask(function*struct_from_str(){
  let a=[], seq, ret;
  for (let curr=exp, i=0; curr = tparser.parse_get_next(curr); i++)
    a.push(curr.exp);
  for (let i=0; i<a.length; i++){
    let t = tparser.parse_exp_arg_pair(a[i]);
    let ol = parse_var(t.l), type = ol.type, cfid = ol.cfid||0, r = ol.range;
    let val = yield get_val(t.r);
    assert(seq===undefined || seq==ol.seq, 'multiple seq in struct');
    assert(!ol.ctx, 'cannot have ctx for left strcut');
    assert(['sig', 'd', 'm', 'M', 'D'].includes(type), 'invalid type '+type);
    seq = ol.seq;
    ret = ret||{};
    ret[cfid] = ret[cfid]||{seq};
    if (type=='m'){
      ret[cfid].m = ret[cfid].m||{};
      ret[cfid].m[r[0]] = val;
    } else
      ret[cfid][type] = val;
  }
  return ret;
});

const struct_from_db = (scroll, seq)=>etask(function*struct_from_db(){
  let db_c = yield db_get_c(scroll.soul.db, scroll.name);
  let db = scroll.soul.db, tx = db.transaction('decl2', 'readonly');
  let store = tx.store('decl2');
  let ret = {};
  for (let scfid in db_c){
    scfid = +scfid;
    let cfid = db_c[scfid].cfid;
    let o = yield db.store_get(store, [scfid, seq]);
    if (o)
      ret[cfid] = o;
    if (o){
      assert.equal(o?.scfid, scfid, 'missing scfid seq'+seq);
      delete o.scfid;
    }
  }
  return ret;
});

function struct_from_decl(decl){
  if (!decl)
    return null;
  let o = decl.to_static();
  for (let cfid in o){
    delete o[cfid].scfid;
    if (Object.keys(o[cfid]).length==1 && Object.keys(o[cfid])[0]=='seq')
      delete o[cfid];
  }
  if (!Object.keys(o).length)
    return null;
  return o;
}

function parse_var(v){
  let m;
  if (m = v.match(/^\{(.*)\}$/))
    return {type: 'struct', val: m[1]};
  if (m = v.match(/^\[(.*)\]$/))
    return {type: 'array', val: m[1]};
  m = v.match(/^([a-zA-Z]\d*)(\.|\.\.)([^.]*)$/);
  let ctx = m ? m[1] : '', def = m ? m[2]=='..' : false;
  v = m ? m[3] : v;
  if (['db_c', 'db_data', 'mem_c'].includes(v))
    return {type: v, ctx, def};
  if (m = v.match(/^(sig|m|M|d|D|mem|db)((\d+)|((\d+)_(\d+)))(c(\d+))?$/)){
    let type = m[1], range = r_from_str(m[2]), seq = range[1];
    let cfid = m[8] ? +m[8] : 0;
    assert(type=='m' || range[0]==range[1], 'invalid range '+v);
    return {seq, type, range, cfid, ctx, def};
  }
  if (m = v.match(/^D(\d+)(f|F)(\d+)(c(\d+))?$/)){
    let cfid = m[5] ? +m[5] : 0;
    let seq = +m[1], range = [seq, seq], type = 'D'+m[2], i = +m[3];
    return {seq, type, range, i, cfid, ctx, def};
  }
  assert.fail('invalid var '+v);
}

function get_scroll(name, may_not_exist){
  let scroll = t_scroll[name];
  if (!may_not_exist)
    assert(scroll, 'scroll not found '+name);
  return scroll;
}

function set_def(type, val){
  assert(['left', 'right'].includes(type), 'invalid default type '+type);
  assert(val, 'invalid default '+type+' val '+val);
  return t_def[type] = val;
}

function get_def(type){
  assert(['left', 'right'].includes(type), 'invalid default type '+type);
  assert(t_def[type], 'no default type '+type);
  return t_def[type];
}

function fix_buf(o){
  if (!o)
    return;
  let ret = {};
  for (let name in o){
    let v = o[name];
    if (Buffer.isBuffer(v))
      ret[name] = b2s(v);
    else if (v instanceof Object)
      ret[name] = fix_buf(v);
    else
      ret[name] = v;
  }
  return ret;
}

function assert_kb(s){
  let m = s.match(/^(\d+)KB$/);
  assert(m&&m[1], 'invalid KB: '+s);
  return +m[1]*1024;
}

function assert_buffer(a, b, desc){
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b))
    assert.equal(b2s(a), b2s(b), 'buffer not equal '+desc);
  else if (a || b)
    assert.deepEqual(a, b, 'not equal '+desc);
  else
    assert.equal(a, b, 'not equal '+desc);
}

function assert_b2s_obj(a, b, desc){
  assert.deepEqual(b2s_obj(a), b2s_obj(b), desc); }

function assert_no_corruption(scroll){
  for (const [i] of scroll.conflict){
    let curr = scroll.conflict.get(i);
    if (!i)
      continue;
    assert.equal(scroll.conflict.get(curr.parent?.cfid).conflicts.
      get(curr.cfid), curr, 'conflict corruption c'+i);
    for (const [j] of curr.conflicts){
      assert.equal(scroll.conflict.get(j).parent?.cfid, i,
        'conflict corruption c'+i);
    }
  }
}

const calc_m = (scroll, range)=>etask(function*calc_m(){
  let [s, e] = range;
  assert(Number.isInteger(Math.log2(e-s+1)), 'invalid merkel range '+
  r_str(range));
  let q = [];
  assert(e<scroll.conflict.get(0).top.seq+1, 'scroll too small '+
    e+'<'+(scroll.conflict.get(0).top.seq+1));
  for (let i=s; i<=e; i++)
    q.push({s: i, e: i, m: yield scroll.m_hash(0, i)});
  while (q.length!=1){
    let q2 = [];
    for (let i=0; i<q.length/2; i++){
      q2.push({s: q[2*i].s, e: q[2*i+1].e,
        m: Scroll.hconcat_safe([Scroll.PARENT_TYPE,
        enc.encode(enc.uint64, q[2*i+1].e-q[2*i].s+1),
        q[2*i].m, q[2*i+1].m])});
    }
    q = q2;
  }
  let scroll_m = yield scroll.m_hash(0, [s, e]);
  let test_m = q[0].m;
  if (scroll_m && test_m)
    assert.equal(b2s(scroll_m), b2s(test_m));
  return scroll_m||test_m;
});

function c_id2pos(scroll, cfid){
  return Array.from(scroll.conflict.keys()).indexOf(cfid); }

const get_val = (exp, def_type='right')=>etask(function*_get_val(){
  let m;
  assert(typeof exp=='string', 'invalid get_val '+exp);
  if (exp=='null')
    return null;
  if ('prev_scroll1'==exp)
    return t_prev_scroll.M_hash(0, 1);
  if (/^\d+$/.test(exp))
    return enc.encode(enc.uint64, +exp);
  if (m = exp.match(/^0x([0-9a-f]+)$/))
    return s2b(m[1]);
  if (m = exp.match(/^h\((.*)\)$/)){ // h(d10+sig11)
    let a=[], vars = m[1].split('+');
    for (let i=0; i<vars.length; i++)
      a.push(yield get_val(vars[i]));
    return Scroll.hconcat_safe(a);
  }
  if (m = exp.match(/^hleaf\((.*)\)$/)){
    let a=[Scroll.LEAF_TYPE], vars = m[1].split('+');
    for (let i=0; i<vars.length; i++)
      a.push(yield get_val(vars[i]));
    return Scroll.hconcat(a);
  }
  if (m = exp.match(/^hroot\((.*)\)$/)){
    let a=[Scroll.ROOT_TYPE], vars = m[1].split('+');
    for (let i=0; i<vars.length; i++){
      let v = vars[i];
      let r = r_from_str(v.replace(/^([a-zA-Z]+[\d]+\.)?m(.*)$/, '$2'));
      a.push(yield get_val(v));
      a.push(enc_u64(r[0]));
      a.push(enc_u64(r[1]-r[0]+1));
    }
    return Scroll.hconcat(a);
  }
  if (m = exp.match(/^sign\((.*)\+(.*)\)$/)){ // sign(d10+M9)
    return crypto.sign(Scroll.hconcat([yield get_val(m[1]),
      yield get_val(m[2])]), t_keypair.key);
  }
  if (m = exp.match(/^sign\((.*)\)$/)) // sign(d10)
    return crypto.sign(crypto.blake2b(yield get_val(m[1])), t_keypair.key);
  let o = parse_var(exp), {type, seq, cfid} = o, r0 = o.range&&o.range[0];
  if (o.def)
    set_def(def_type, o.ctx);
  let name = o.ctx||get_def(def_type||'right'), scroll = get_scroll(name);
  switch (type){
  case 'sig': return scroll.seq_sig(cfid, seq);
  case 'M': return scroll.M_hash(cfid, seq);
  case 'd': return scroll.seq_d(cfid, seq);
  case 'D': return scroll.seq_D(cfid, seq);
  case 'Df': return scroll.seq_D(cfid, seq)[o.i]?.h ?
    {h: scroll.seq_D(cfid, seq)[o.i]?.h} : null;
  case 'DF': return scroll.seq_D(cfid, seq)[o.i]?.sig ||
    scroll.seq_D(cfid, seq)[o.i]?.buf ? scroll.seq_D(cfid, seq)[o.i] : null;
  // XXX: do we need calc_m?
  case 'm': return r0==seq ? scroll.m_hash(cfid, seq) :
    cfid ? scroll.m_hash(cfid, o.range) : calc_m(scroll, o.range);
  case 'db': return yield struct_from_db(scroll, seq);
  case 'mem':
    return yield struct_from_decl(scroll.get_decl(seq, {create: false}));
  case 'struct': return yield struct_from_str(o.val);
  case 'array': return yield array_from_str(o.val);
  }
  assert.fail('invalid val exp '+exp);
});

const test_decl = (scroll, data)=>etask(function*test_decl(){
  yield scroll.decl(data);
  yield xsinon.tick(1, {force: true});
});

const test_start = ()=>etask(function*test_start(){
  t_soul_mode = 'differnt';
  t_soul = {};
  t_soul_id = 0;
  t_scroll = {};
  t_def = {};
  t_state = {};
  t_keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef75'+
    'ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
      'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  xsinon.clock_set({now: 0, auto_inc: true});
  t_genesis_scroll = yield Scroll.create({key: t_keypair.key,
    pub: t_keypair.pub}, {topic: 'genesis'});
  t_scroll['genesis'] = t_genesis_scroll;
  t_genesis_scroll.t = {name: 'genesis'};
  yield t_genesis_scroll.decl('1');
  assert(t_genesis_scroll.M_hash(0, 0), 'missing M0');
  assert(t_genesis_scroll.M_hash(0, 1), 'missing M1');
  t_prev_scroll = yield Scroll.create({key: t_keypair.key,
    pub: t_keypair.pub, prev_scroll: yield t_genesis_scroll.M_hash(0, 1)},
    {topic: 'prev_scroll'});
  t_scroll['prev'] = t_prev_scroll;
  t_prev_scroll.t = {name: 'prev'};
  yield t_prev_scroll.decl('1');
  assert(t_prev_scroll.M_hash(0, 0), 'missing M0');
  assert(t_prev_scroll.M_hash(0, 1), 'missing M1');
});

const test_end = ()=>etask(function*test_end(){
  yield xsinon.wait();
  for (let name in t_scroll){
    let scroll = t_scroll[name];
    if (scroll.storage)
      yield scroll.storage.uninit();
    if (scroll.soul?.db.inited)
      yield scroll.soul.db.uninit({delete: true});
  }
  Scroll.soul.clear();
});

function cmd_conf(t){
  let soul;
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp);
    switch (tt.cmd){
      case 'soul':
        soul = tt.r;
        assert(['differnt', 'same', 'manual'].includes(soul),
          'invalid soul '+soul);
        break;
    default: assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  if (soul!==undefined)
    t_soul_mode = soul;
}

function parse_db_init(t){
  let max_decl, max_frame;
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case 'max_decl': max_decl = assert_kb(tt.r); break;
    case 'max_frame': max_frame = assert_kb(tt.r); break;
    default: assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  return {need_init: true, max_decl, max_frame};
}

const cmd_db_init = t=>etask(function*cmd_db_init(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  assert(!scroll.soul.db.inited, 'db already inited');
  let {max_decl, max_frame} = parse_db_init(t);
  yield scroll.soul.db.init({max_decl, max_frame, delete: true,
    postfix: scroll.soul.name});
});

const cmd_db_copy = t=>etask(function*cmd_db_copy(){
  let d_sname = t.ctx, s_soul, m = t.r.match(/(^[^.]*)\.soul$/);
  if (m?.[1])
    s_soul = get_scroll(m[1]).soul;
  else
    s_soul = t_soul[t.r];
  assert(s_soul, 'src soul not found '+t.r);
  let soul = t_soul[d_sname] = t_soul[d_sname] || new Soul({name: d_sname});
  if (!soul.db.inited)
    yield soul.db.init({delete: true, postfix: soul.name});
  yield soul.db.copy(s_soul.db);
});

const new_scroll = (name, M, prev_scroll, sname, db_opt)=>etask(
  function*new_scroll(){
  let soul, scroll;
  if (t_soul_mode=='differnt'){
    sname = sname || 'auto_soul'+t_soul_id++;
    soul = t_soul[sname] = t_soul[sname] || new Soul({name: sname});
  }
  else if (t_soul_mode=='manual'){
    assert(sname, 'missing soul name in manual mode');
    soul = t_soul[sname] = t_soul[sname] || new Soul({name: sname});
  } else if (t_soul_mode=='same'){
    assert(!sname, 'no soul name in same mode');
    sname = 'same';
    soul = t_soul[sname] = t_soul[sname] || new Soul({name: sname});
  } else
    assert.fail('invalid soul mode '+t_soul_mode);
  let storage;
  if (db_opt?.need_init){
    if (!soul.db.inited){
      yield soul.db.init({max_decl: db_opt.max_decl,
        max_frame: db_opt.max_frame, delete: true, postfix: soul.name});
    }
    storage = new Storage_handler({db: soul.db});
  }
  if (M){
    scroll = yield Scroll.open({soul, key: t_keypair.key,
      pub: t_keypair.pub, M, storage});
  }
  else {
    scroll = yield Scroll.create({soul, key: t_keypair.key,
      pub: t_keypair.pub, prev_scroll, storage}, {topic: 'test'});
  }
  t_scroll[name] = scroll;
  scroll.t = {name};
  return scroll;
});

const cmd_flush = t=>etask(function*cmd_flush(){
  for (let name in t_scroll){
    let scroll = t_scroll[name];
    if (scroll.storage)
      yield scroll.storage.flush();
  }
});

const cmd_scroll = t=>etask(function*cmd_scroll(){
  let prev_scroll = yield t_prev_scroll.M_hash(0, 1), db_opt;
  let name = t.ctx||get_def('left'), M, a, scroll, d;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!t_scroll[name], 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp), t2;
    switch (tt.cmd){
    case 'db': db_opt = parse_db_init(tt); break;
    case '!':
      if ('prev_scroll'==tt.r)
        prev_scroll = null;
      else
        assert.fail('invalid arg '+t.meta.s);
      break;
    case 'd':
      if (a=tt.r.match(/^(\d+)-(\d+)$/))
        d = [+a[1], +a[2]];
      else if (a=tt.r.match(/^(\d+)$/))
        d = [+a[1], +a[1]];
      break;
    default:
      t2 = tparser.parse_exp_arg_pair(curr.exp);
      if (a = t2.l.match(/^M(\d+)$/)){
        let h = yield get_val(t2.r);
        M = +a[1] ? {seq: +a[1], h} : h;
        break;
      }
      assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  scroll = yield new_scroll(name, M, prev_scroll, t.prev?.ctx, db_opt);
  if (d!==undefined){
    for (let j=d[0]; j<=d[1]; j++)
      yield test_decl(scroll, ''+j);
  }
});

const cmd_clone = (curr, t)=>etask(function*cmd_clone(){
  let dst = t.ctx||get_def('left'), m, db_opt;
  assert(!t_scroll[dst], 'scroll already exist '+dst);
  assert(!t.l, 'invalid arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case 'db': db_opt = parse_db_init(tt); break;
    default:
      m = tt.meta.s.match(/^([a-z0-9-]+)(()||(\.)|(\.\.))(M(\d+))?$/);
      assert(m, 'invalid clone '+t.meta.s);
    }
  }
  let src = m[1];
  if (m[2]=='..')
    set_def('right', src);
  let s_src = get_scroll(src);
  let s_dst = yield new_scroll(dst, s_src.M_hash(0, 0), null, t.prev?.ctx,
    db_opt);
  let seq = m[6] ? +m[7] : s_src.top.seq;
  // XXX: use conflict_to_static/conflict_from_static
  if (Array.from(s_src.conflict.keys()).length>1){ // XXX: rm this if
    for (let [cfid, co] of s_src.conflict){
      assert(co.top.seq<=seq, 'cannot clone < conflict top '+co.top.seq);
      let o = {cfid: cfid, top: {seq: co.top.seq, M: Buffer.from(co.top.M)},
        parent: co.parent && assign({}, co.parent), conflicts: new Map()};
      s_dst.conflict.set(cfid, o);
      if (o.parent)
        s_dst.conflict.get(o.parent.cfid).conflicts.set(cfid, o);
    }
  }
  if (s_dst.storage) // XXX: rm
      yield s_dst.storage.begin_update();
  for (let [seq2, decl] of s_src.dmap){
    if (seq2<=seq)
      yield s_dst.get_decl(seq2).from_static(decl.to_static());
  }
  if (s_dst.storage)
      yield s_dst.storage.end_update();
});

const cmd_decl = t=>etask(function*cmd_decl(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp), a, data=[];
    switch (tt.cmd){
    case 'data':
      a = tt.r.split(' ');
      for (let j=0; j<a.length; j++){
        let sz = assert_kb(a[j]);
        data.push(Buffer.alloc(sz, scroll.conflict.get(0).top.seq+j));
      }
      yield test_decl(scroll, data);
      break;
    case '-':
      assert(/^\d+$/.test(tt.l) && /^\d+$/.test(tt.r), 'invalid -: '+t.meta.s);
      for (let j=+tt.l; j<=+tt.r; j++)
        yield test_decl(scroll, ''+j);
      break;
    default:
      if (/^\d+$/.test(tt.cmd))
        yield test_decl(scroll, tt.cmd);
      else
        assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
});

function state_split_var(v, def){
  let o = parse_var(v), {type, seq, cfid} = o;
  if (o.def)
    set_def('left', o.ctx);
  let name = o.ctx||def||get_def('left');
  if (['db_c', 'db_data', 'mem_c'].includes(type))
    return {name, type};
  assert(['mem', 'db'].includes(type), 'invalid type '+type);
  assert.equal(cfid, '0', 'invalid conflict usage');
  return {name, type, seq};
}

const state_split = (exp, def)=>etask(function*state_split(){
  let o = tparser.parse_exp(exp);
  switch (o.cmd){
  case '!': return assign(state_split_var(o.r, def), {val: null});
  case '=':
    if (['db_data'].includes(o.l)){
      return assign(state_split_var(o.l, def),
        {val: yield get_static_db_data(o.r)});
    }
    if (['db_c', 'mem_c'].includes(o.l)){
      return assign(state_split_var(o.l, def),
        {val: yield get_static_c(o.r)});
    }
    return assign(state_split_var(o.l, def),
      {val: fix_buf(yield get_val(o.r, 'right'))});
  default: assert.fail('invalid state_split '+exp);
  }
});

function state_apply(state, o){
  let {type, seq, val} = o;
  if (['db_c', 'db_data', 'mem_c'].includes(type)){
    if (val)
      state[type] = val;
    else
      delete state[type];
    return;
  }
  if (val)
    state[type][seq] = val;
  else
    delete state[type][seq];
}

function get_filter(s){
  let a = s.split(' ');
  for (let i=0; i<a.length; i++){
    switch (a[i]){
    case 'db': break;
    case 'db_data': break;
    case 'db_c': break;
    case 'mem': break;
    case 'mem_c': break;
    default: return;
    }
  }
  return a;
}

const cmd_state = (curr, t)=>etask(function*cmd_state(){
  let state = {mem: {}, db: {}};
  let name = t.ctx||get_def('left');
  let scroll = get_scroll(t.ctx||get_def('left'), true);
  let soul = scroll?.soul;
  state.mem = {};
  if (scroll){
    for (const [seq, decl] of scroll.dmap){
      let o = struct_from_decl(decl);
      if (o)
        state.mem[seq] = o;
    }
    state.mem_c = yield mem_get_c(scroll);
  }
  let db = soul?.db;
  if (db?.inited){
    state.db = yield db_get_scroll_decl(scroll.soul.db, scroll);
    state.db_c = yield db_get_c(scroll.soul.db, scroll.M_hash(0, 0));
    state.db_data = yield db_get_db_data(scroll.soul.db);
  } else {
    state.db = {};
    state.db_c = {};
    state.db_data = {};
  }
  state = fix_buf(state);
  if (!t_state[name]){
    if (get_filter(t.r))
      t_state.filter = get_filter(t.r);
    else
      assert(!t.r, 'first # must be empty or list of types');
    t_state[name] = state;
    return;
  }
  for (let curr=t.r; curr = tparser.parse_get_next(curr);)
    state_apply(t_state[name], yield state_split(curr.exp, name));
  if (!t_state.filter || t_state.filter.includes('mem_c')){
    assert_b2s_obj(state.mem_c, t_state[name].mem_c,
      'mem conflict state mismach '+t.meta.s);
  }
  if (!t_state.filter || t_state.filter.includes('mem')){
    assert_b2s_obj(state.mem, t_state[name].mem,
      'mem state mismach '+t.meta.s);
  }
  if (!t_state.filter || t_state.filter.includes('db_c')){
    assert_b2s_obj(state.db_c, t_state[name].db_c,
      'db conflict state mismach '+t.meta.s);
  }
  if (!t_state.filter || t_state.filter.includes('db'))
    assert_b2s_obj(state.db, t_state[name].db, 'db state mismach '+t.meta.s);
  if (!t_state.filter || t_state.filter.includes('db_data')){
    assert_b2s_obj(state.db_data, t_state[name].db_data,
      'db_data state mismach '+t.meta.s);
  }
  t_state[name] = state;
});

function cmd_tput(curr, t){
  let dst = t.ctx||get_def('left'), src = get_def('right');
  tparser.parse_push(curr, tjoin(dst, 'put', macro_to_m(t.r, src)));
}

const cmd_put = (curr, t)=>etask(function*cmd_put(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let diff = {}, err='';
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg_pair(curr.exp);
    if (t2.l=='err'){
      assert(!err, 'err already defined');
      err = t2.r||true;
      continue;
    }
    let o = parse_var(t2.l), type = o.type, seq = o.range[1];
    let seq_o = diff[seq] = diff[seq]||{};
    let val = yield get_val(t2.r);
    assert(['sig', 'd', 'm', 'M', 'D'].includes(type), 'invalid type '+type);
    if (type=='m'){
      seq_o.m = seq_o.m||{};
      seq_o.m[o.range[0]] = val;
    } else
      seq_o[type] = val;
  }
  let ret = yield scroll.put(diff);
  assert.deepEqual(Object.keys(ret.errors), err ?
    string.split_trim(err, /,\s*/) : []);
  assert_no_corruption(scroll);
});

// XXX: rm api
const cmd_unload = (curr, t)=>etask(function cmd_unload(){
  assert(t.ctx=='mem', 'missing mem prefix');
  let name = t.prev?.ctx||get_def('left'), scroll = get_scroll(name);
  for (let curr=t.r; curr = tparser.parse_get_next(curr);)
    assert(!curr.exp, 'invalid arg '+curr.exp);
  scroll.unload();
});

const cmd_load_c = t=>etask(function*cmd_load_c(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name), o, data;
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    switch (curr.exp)
    {
    case 'data': data = true; break;
    default: o = parse_cfid_seq(curr.exp);
    }
  }
  let decl = yield scroll.get_decl(o.seq);
  yield decl.load(o.cfid, data && {data: true});
});

const cmd_test = t=>etask(function*cmd_test(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let tested = {};
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg_pair(curr.exp);
    let l=name+'.'+t2.l, r=t2.r, o=parse_var(t2.l), cfid=o.cfid;
    tested[cfid] = tested[cfid]||{};
    tested[cfid][o.seq] = tested[cfid][o.seq]||{M: false, sig: false, d: false,
      m: {}};
    if (o.type=='m')
      tested[cfid][o.seq].m[o.range[0]] = true;
    else
      tested[cfid][o.seq][o.type] = true;
    let val = yield get_val(l);
    let exp = yield get_val(r);
    assert_buffer(val, exp, curr.exp);
  }
  for (const [cfid] of scroll.conflict){
    for (let seq=0; seq<=scroll.conflict.get(cfid).top.seq; seq++){
      seq = +seq;
      let decl = yield scroll.get_decl(seq, {create: false});
      ['sig', 'd', 'M', 'm'].forEach(type=>{
        if (type=='m'){
          let a = Scroll.merkel_ranges(seq);
          for (let i=0; i<a.length; i++){
            let s = a[i][0];
            if (tested[cfid] && tested[cfid][seq]?.m[s])
              continue;
            assert(!decl || !decl.m_get([s, seq]).h, 'm'+r_str([s, seq])+
              'c'+cfid+' exists '+t.meta.s);
          }
          return;
        }
        if (tested[cfid] && tested[cfid][seq] && tested[cfid][seq][type])
          return;
        switch (type){
        case 'sig':
          assert(!decl || !decl.sig_get(0), 'sig'+seq+'c'+cfid+
            ' exists '+t.meta.s);
          break;
        case 'd':
          assert(!decl || !decl.fbuf_get_sync(cfid).h, 'd'+seq+'c'+cfid+
            ' exists '+t.meta.s);
          break;
        case 'M':
          assert(!decl || !decl.M.h, 'M'+seq+'c'+cfid+' exists '+t.meta.s);
          break;
        default: assert.fail('invalid type '+type+'c'+cfid);
        }
      });
    }
  }
});

function parse_cfid_seq(s){
  let m = s.match(/^(\d+)(([c])(\d+))?$/);
  assert(m, 'invalid cfid_seq');
  let seq = +m[1];
  let cfid = +m[4]||0;
  return {seq, cfid};
}

function parse_conflict(s){
  let m = s.match(/^([^=]+)=([^=]+)$/);
  let l= m ? m[1] : s, r = m&&m[2];
  m = l.match(/^((\d+):)?((\d+)(([c|t])(\d+))?\.)?M(\d+)$/);
  assert(m, 'invalid conflict '+s);
  r = r||'M'+m[8];
  let cfid = m[2];
  let top = {seq: +m[8], M: r};
  let parent = m[4] ? {seq: +m[4], cfid: +m[7]||0, type: m[6]||'t'} :
    undefined;
  let ret = {};
  if (cfid!==undefined)
    ret.cfid = +cfid;
  ret.top = top;
  if (parent!==undefined)
    ret.parent = parent;
  return ret;
}

const cmd_c = t=>etask(function*cmd_c(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let tested = {}, i=0;
  for (let curr=t.r; curr = tparser.parse_get_next(curr); i++)
    tested[i] = parse_conflict(curr.exp);
  assert.equal(scroll.conflict.size, i, 'conflict count mismatch '+t.r);
  for (const [i, o] of scroll.conflict){
    let ii = c_id2pos(scroll, i);
    assert.deepEqual(o.parent?.cfid!==undefined ?
      {seq: o.parent.seq, cfid: c_id2pos(scroll, o.parent.cfid),
      type: o.parent?.type} :
      undefined, tested[ii].parent, 'conflict '+i+' mismatch '+t.r);
    assert.equal(o.top.seq, tested[ii].top.seq, 'top seq mismatch c'+i+
      ' '+t.r);
    assert_buffer(o.top.M, yield get_val(tested[ii].top.M),
      'top M mismatch c'+i+' '+t.r);
  }
  assert_no_corruption(scroll);
});

const get_static_db_data = exp=>etask(function*get_static_db_data(){
  let m;
  if (m = exp.match(/^\{(.*)\}$/))
    exp = m[1];
  let o = {};
  for (let curr=exp; curr = tparser.parse_get_next(curr);){
    let val = yield get_val(curr.exp);
    assert(val?.buf && val?.h, 'invalid static db data');
    o[b2s(val.h)] = b2s(val.buf);
  }
  return o;
});

const db_get_db_data = db=>etask(function*db_get_db_data(){
  let ret = {};
  let tx = db.transaction('data', 'readonly');
  let store = tx.store('data');
  // XXX: optimize, just get data of scroll from DB
  for (let cursor=yield db.cursor(store); cursor; cursor = yield cursor.next())
  {
    assert.equal(cursor.key, b2s(cursor.value.h));
    ret[cursor.key] = b2s(Buffer.from(cursor.value.buf));
  }
  return ret;
});

const get_static_c = exp=>etask(function*get_static_c(){
  let m;
  if (m = exp.match(/^\{(.*)\}$/))
    exp = m[1];
  let o = {};
  for (let curr=exp; curr = tparser.parse_get_next(curr);){
    m = curr.exp.match(/^(\d+):(.*)$/);
    assert(m?.length==3, 'invalid db_c '+curr.exp);
    o[m[1]] = parse_conflict(m[2]);
    o[m[1]].top.M = b2s(yield get_val(o[m[1]].top.M));
  }
  return o;
});

const db_get_scroll_decl = (db, scroll)=>etask(function*db_get_scroll_decl(){
  let db_c = yield db_get_c(db, scroll.M_hash(0, 0)), ret={};
  let tx = db.transaction('decl2', 'readonly');
  for (let scfid in db_c){
    scfid = +scfid;
    let cfid = db_c[scfid].cfid;
    let index = tx.store('decl2').index('scfid');
    let query = IDBKeyRange.only(scfid);
    for (let cursor=yield db.cursor(index, query); cursor;
      cursor = yield cursor.next())
    {
      let o = db.fix_struct(cursor.value);
      assert.equal(o.scfid, scfid, 'missing scfid seq'+o.seq);
      delete o.scfid;
      ret[o.seq] = ret[o.seq]||{};
      ret[o.seq][cfid] = o;
    }
  }
  let scfids = {}, store = tx.store('decl2');
  for (let cursor=yield db.cursor(store); cursor; cursor = yield cursor.next())
    scfids[cursor.value.scfid] = true;
  for (let scfid in scfids)
    assert(yield db.db_get('scroll2', +scfid), 'scfid '+scfid+' not found');
  return ret;
});

const db_get_c = (db, M)=>etask(function*db_get_c(){
  let tx = db.transaction('scroll2', 'readonly'), ret;
  let index = tx.index('scroll2', 'scroll');
  let query = IDBKeyRange.only(b2s(M));
  for (let cursor=yield db.cursor(index, query); cursor;
    cursor = yield cursor.next())
  {
    let o = db.fix_struct(cursor.value);
    ret = ret||{};
    ret[o.scfid] = {cfid: o.cfid, top: {seq: o.top.seq, M: s2b(o.top.M)}};
    // XXX: need assert to check ret of split array is correct
    if (o.split){
      ret[o.scfid].parent = o.split[0];
      assert.equal(o.type, o.split[0].type, 'invalid type');
    }
  }
  return ret;
});

const mem_get_c = scroll=>etask(function mem_get_c(){
  let ret;
  for (const [cfid, o] of scroll.conflict){
    ret = ret||{};
    ret[cfid] = {top: {seq: o.top.seq, M: o.top.M}};
    if (o.parent){
      ret[cfid].parent = {seq: o.parent.seq, cfid: o.parent.cfid,
        type: o.parent.type};
    }
  }
  assert_no_corruption(scroll);
  return ret;
});

const cmd_def = o=>etask(function*cmd_def(){
  let m = o.r.match(/^([a-zA-Z0-9]+)\.\.$/);
  assert(m?.[1], 'invalid cmd_def '+o.meta.s);
  set_def('right', m[1]);
});

const cmd_eq = o=>etask(function*cmd_eq(){
  let l, r;
  if (!o.l){
    assert(o.r, 'invalid exp '+o.meta.s);
    let t2 = tparser.parse_exp_arg_pair(o.r);
    l = yield get_val(t2.l, 'left');
    r = yield get_val(t2.r, 'right');
  } else {
    assert(o.l, 'missing left '+o.meta.s);
    assert(o.r, 'missing right '+o.meta.s);
    l = yield get_val((o.ctx ? o.ctx+'.' : '')+o.l, 'left');
    r = yield get_val(o.r, 'right');
  }
  if (Buffer.isBuffer(l) || Buffer.isBuffer(r))
    assert_buffer(l, r, o.meta.s);
  else if (Array.isArray(l) || Array.isArray(r))
    assert.deepEqual(l||[{}], r||[{}]);
  else
    assert.deepEqual(b2s_obj(l), b2s_obj(r));
});

const test_run_single = (curr, o)=>etask(function*_test_run_single(){
  let o2;
  switch (o.cmd){
  case 'conf': yield cmd_conf(o); break;
  case 'db_init': yield cmd_db_init(o); break;
  case 'db_copy': yield cmd_db_copy(o); break;
  case 'flush': yield cmd_flush(o); break;
  case 'scroll': yield cmd_scroll(o); break;
  case 'clone': yield cmd_clone(curr, o); break;
  case 'decl': yield cmd_decl(o); break;
  case 'put': yield cmd_put(curr, o); break;
  case 'unload': yield cmd_unload(curr, o); break;
  case 'load_c': yield cmd_load_c(o); break;
  case 'tput': yield cmd_tput(curr, o); break;
  case '#': yield cmd_state(curr, o); break;
  case 'def': yield cmd_def(o); break;
  case '=': yield cmd_eq(o); break;
  case '==': yield cmd_test(o); break;
  case 'c': yield cmd_c(o); break;
  // XXX need db_data api
  case '//': break;
  case 'dbg': debugger; break; // eslint-disable-line no-debugger
  case '.':
  case '..':
  case '...': // XXX: rm from here and move to parser
    assert(o.l, 'invalid "." operator');
    o2 = tparser.parse_exp(o.r);
    o2.ctx = o.l;
    o2.prev = o;
    if (o.cmd=='...'){
      set_def('left', o.l);
      set_def('right', o.l);
    } else if (o.cmd=='..')
      set_def('left', o.l);
    yield test_run_single(curr, o2);
    break;
  default:
    if (o.cmd[0]=='!'){
      yield cmd_eq({cmd: '=', l: o.meta.s.substr(1), r: 'null',
        meta: {s: o.meta.s}});
    }
    else
      assert.fail('invalid cmd "'+o.cmd+'" in '+o.meta.s);
  }
});

const test_run = test=>etask(function*test_run(){
  yield test_start();
  for (let curr=test, i=0; curr = tparser.parse_get_next(curr); i++){
    let o = tparser.parse_exp(curr.exp);
    xerr.notice('cmd %s %s', i, o.meta.s);
    yield test_run_single(curr, o);
  }
  yield test_end();
});

describe('range', ()=>{
  it('r_from_str', ()=>{
    const t = (val, exp)=>assert.deepEqual(r_from_str(val), exp);
    t('1', [1, 1]);
    t('10', [10, 10]);
    t('10_100', [10, 100]);
  });
  it('r_parent', ()=>{
    const t = (val, exp)=>{
      let _val = r_from_str(val), e = r_from_str(exp);
      let res = r_parent(_val);
      assert.deepEqual(res.parent, e, 'failed parent '+val);
      let d = (e[1] - e[0]+1)/2;
      assert.deepEqual(res.left, [e[0], e[0]+d-1]);
      assert.deepEqual(res.right, [e[0]+d, e[1]]);
    };
    t('0', '0_1');
    t('1', '0_1');
    t('2', '2_3');
    t('3', '2_3');
    t('4', '4_5');
    t('5', '4_5');
    t('6', '6_7');
    t('7', '6_7');
    t('0_1', '0_3');
    t('2_3', '0_3');
    t('4_5', '4_7');
    t('6_7', '4_7');
    t('0_3', '0_7');
    t('4_7', '0_7');
    t('0_7', '0_15');
    t('8_15', '0_15');
    t('16_23', '16_31');
    t('24_31', '16_31');
    t('0_15', '0_31');
    t('16_31', '0_31');
  });
});

describe('test_util', ()=>{
  it('parse_var', ()=>{
    const t = (v, exp)=>{
      let a = exp.split(' '), range = r_from_str(a[1]);
      let cfid = a[2] ? +a[2] : 0, ctx = a[3]||'', def = a[4]=='def'||false;
      let exp2 = {type: a[0], seq: range[1], range, cfid, ctx, def};
      assert.deepEqual(parse_var(v), exp2);
    };
    t('d0', 'd 0');
    t('d0', 'd 0');
    t('D0', 'D 0');
    t('m0', 'm 0');
    t('M0', 'M 0');
    t('sig0', 'sig 0');
    t('sig10', 'sig 10');
    t('m0_0', 'm 0');
    t('m0_1', 'm 0_1');
    t('m2_3', 'm 2_3');
    t('d0c10', 'd 0 10');
    t('D0c10', 'D 0 10');
    t('m0c10', 'm 0 10');
    t('M0c10', 'M 0 10');
    t('sig0c10', 'sig 0 10');
    t('m0_1c10', 'm 0_1 10');
    t('s2.d0', 'd 0 0 s2');
    t('s2.m0_1c10', 'm 0_1 10 s2');
    t('s2..d0', 'd 0 0 s2 def');
    t('s2..m0_1c10', 'm 0_1 10 s2 def');
    // XXX: test db_c, db_data
  });
  it('parse_cfid_seq', ()=>{
    const t = (val, exp)=>assert.deepEqual(parse_cfid_seq(val), exp);
    t('1', {seq: 1, cfid: 0});
    t('1c2', {seq: 1, cfid: 2});
  });
  it('parse_conflict', ()=>{
    const t = (val, exp)=>assert.deepEqual(parse_conflict(val), exp);
    t('M9=s.M9', {top: {seq: 9, M: 's.M9'}});
    t('3.M9=s.M9', {top: {seq: 9, M: 's.M9'},
      parent: {seq: 3, cfid: 0, type: 't'}});
    t('3c1.M9=s.M9', {top: {seq: 9, M: 's.M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('3t1.M9=s.M9', {top: {seq: 9, M: 's.M9'},
      parent: {seq: 3, cfid: 1, type: 't'}});
    t('M9', {top: {seq: 9, M: 'M9'}});
    t('1:M9', {cfid: 1, top: {seq: 9, M: 'M9'}});
    t('3.M9', {top: {seq: 9, M: 'M9'}, parent: {seq: 3, cfid: 0, type: 't'}});
    t('3c1.M9', {top: {seq: 9, M: 'M9'},
      parent: {seq: 3, cfid: 1, type: 'c'}});
    t('3t1.M9', {top: {seq: 9, M: 'M9'},
      parent: {seq: 3, cfid: 1, type: 't'}});
  });
});

describe('parser', ()=>{
  it('parse_get_next', ()=>{
    const t = (s, exp)=>{
      let curr = s;
      while (curr = tparser.parse_get_next(curr)){
        assert(exp.length, 'unexpected '+curr.exp);
        assert.equal(curr.exp, exp[0]);
        exp.shift();
      }
      assert(!exp.length, 'missing '+exp.join(' ')+' for "'+s+'"');
    };
    t('', []);
    t(' ', []);
    t('a', ['a']);
    t(' a', ['a']);
    t('a ', ['a']);
    t('a\n', ['a']);
    t(' a ', ['a']);
    t('ab', ['ab']);
    t('a:b', ['a:b']);
    t('a b', ['a', 'b']);
    t('a  b', ['a', 'b']);
    t('a\nb', ['a', 'b']);
    t('#a', ['#a']);
    t('#a b', ['#a', 'b']);
    t('a(b)', ['a(b)']);
    t('a[b]', ['a[b]']);
    t('a{b}', ['a{b}']);
    t('a(b c)', ['a(b c)']);
    t('a(b(c))', ['a(b(c))']);
    t('a(b(c) d(e))', ['a(b(c) d(e))']);
    t('a[b(c) d{e}]', ['a[b(c) d{e}]']);
    t('a==b', ['a==b']);
    t('a..b', ['a..b']);
    t('a...b', ['a...b']);
    t('a.s.b', ['a.s.b']);
    t('a(1)==b(2)', ['a(1)==b(2)']);
    t('a==b(c==d)', ['a==b(c==d)']);
    t('a b(c) d==e', ['a', 'b(c)', 'd==e']);
    t('b..c(d..e)', ['b..c(d..e)']);
    t('a //', ['a', '//']);
    t('a // XXX', ['a', '// XXX']);
    t('a // XXX b', ['a', '// XXX b']);
    t(`a // XXX b
      c`, ['a', '// XXX b', 'c']);
    t(`a // XXX b
      `, ['a', '// XXX b']);
    t(`a
      // XXX`, ['a', '// XXX']);
  });
  it('parse_exp', ()=>{
    const t = (s, exp)=>assert.deepEqual(tparser.parse_exp(s),
      {...exp, meta: {s: s.trim()}});
    t(' a ', {cmd: 'a', l: '', r: ''});
    t('a(b)', {cmd: 'a', l: '', r: 'b'});
    t('a(b c)', {cmd: 'a', l: '', r: 'b c'});
    t('a(b+c)', {cmd: 'a', l: '', r: 'b+c'});
    t('a(b==c)', {cmd: 'a', l: '', r: 'b==c'});
    t('a==b', {cmd: '==', l: 'a', r: 'b'});
    t('a..b', {cmd: '..', l: 'a', r: 'b'});
    t('a...b', {cmd: '...', l: 'a', r: 'b'});
    t('test(a)', {cmd: 'test', l: '', r: 'a'});
    t('==(a)', {cmd: '==', l: '', r: 'a'});
    t('a.b', {cmd: '.', l: 'a', r: 'b'});
    t('a:b', {cmd: ':', l: 'a', r: 'b'});
    t('a:=b', {cmd: ':=', l: 'a', r: 'b'});
    t('a=b', {cmd: '=', l: 'a', r: 'b'});
    t('a+b', {cmd: '+', l: 'a', r: 'b'});
    t('a=b(2)', {cmd: '=', l: 'a', r: 'b(2)'});
    t('a(1)==b(2)', {cmd: '==', l: 'a(1)', r: 'b(2)'});
    t('a1==b(c+d)', {cmd: '==', l: 'a1', r: 'b(c+d)'});
    t('a.b(c)', {cmd: '.', l: 'a', r: 'b(c)'});
    t('M7=s.M8', {cmd: '=', l: 'M7', r: 's.M8'});
    t('s.M7=s2.M8', {cmd: '.', l: 's', r: 'M7=s2.M8'});
    t('//', {cmd: '//', l: '', r: ''});
    t('// XXX', {cmd: '//', l: '', r: 'XXX'});
    t('s1..put(s2.sig)', {cmd: '..', l: 's1', r: 'put(s2.sig)'});
    t('!a', {cmd: '!', l: '', r: 'a'});
    t('!a.b', {cmd: '!', l: '', r: 'a.b'});
    t('!(a.b)', {cmd: '!', l: '', r: '(a.b)'});
    t('#(a)', {cmd: '#', l: '', r: 'a'});
    t('#a', {cmd: '#', l: '', r: 'a'});
    t('#ab', {cmd: '#', l: '', r: 'ab'});
  });
  it('parse_exp_arg', ()=>{
    const t = (s, exp)=>assert.deepEqual(tparser.parse_exp_arg(s),
      {...exp, meta: {s: s.trim()}});
    t('d0', {cmd: 'd0', l: '', r: ''});
    t('s.d0', {cmd: '.', l: 's', r: 'd0'});
    t('d0:d1', {cmd: 'd0', l: '', r: 'd1'});
    t('d0:s.d1', {cmd: 'd0', l: '', r: 's.d1'});
    t('s.d0:d1', {cmd: '.', l: 's', r: 'd0:d1'});
    t('s.d0:s2.d1', {cmd: '.', l: 's', r: 'd0:s2.d1'});
  });
  it('parse_exp_arg_pair', ()=>{
    const t = (s, exp)=>assert.deepEqual(tparser.parse_exp_arg_pair(s), exp);
    t('d0', {l: 'd0', r: 'd0'});
    t('s0.d0', {l: 'd0', r: 's0.d0'});
    t('s0..d0', {l: 'd0', r: 's0..d0'});
    t('s0...d0', {l: 'd0', r: 's0...d0'});
    t('d0:d1', {l: 'd0', r: 'd1'});
    t('d0:s1.d1', {l: 'd0', r: 's1.d1'});
    t('s0.d0:d1', {l: 's0.d0', r: 'd1'});
    t('s0.d0:s1.d1', {l: 's0.d0', r: 's1.d1'});
    t('s0.d0:s1..d1', {l: 's0.d0', r: 's1..d1'});
    t('s0.d0:s1...d1', {l: 's0.d0', r: 's1...d1'});
    t('d0(d1)', {l: 'd0', r: 'd1'});
  });
  // XXX: test invalid parsing
});

describe('scroll', ()=>{
  describe('util', ()=>{
    it('seq_merkel_array_size', ()=>{
      const t = (seq, exp)=>assert.equal(Scroll.seq_merkel_array_size(seq),
        exp, 'seq '+seq);
      t(0, 1);
      t(1, 2);
      t(2, 1);
      t(3, 3);
      t(4, 1);
      t(5, 2);
      t(6, 1);
      t(7, 4);
      t(8, 1);
      t(9, 2);
      t(10, 1);
      t(11, 3);
      t(12, 1);
      t(13, 2);
      t(14, 1);
      t(15, 5);
    });
    it('merkel_ranges', ()=>{
      const t = (seq, exp)=>{
        let a = [];
        exp.split(' ').forEach(s=>a.push(r_from_str(s)));
        assert.deepEqual(Scroll.merkel_ranges(seq), a);
      };
      t(0, '0');
      t(1, '1_1 0_1');
      t(2, '2');
      t(3, '3 2_3 0_3');
      t(4, '4');
      t(5, '5 4_5');
      t(6, '6');
      t(7, '7 6_7 4_7 0_7');
    });
    it('merkel_array_pos', ()=>{
      const t = (range, exp)=>assert.equal(
        Scroll.merkel_array_pos(range), exp, 'range '+range);
      t(0, 0);
      t(1, 0);
      t(2, 0);
      t(3, 0);
      t([3], 0);
      t([3, 3], 0);
      t([2, 3], 1);
      t([0, 3], 2);
      t([15], 0);
      t([15, 15], 0);
      t([14, 15], 1);
      t([12, 15], 2);
      t([8, 15], 3);
      t([0, 15], 4);
    });
    it('calc_roots', ()=>{
      const t = (seq, exp)=>{
        let roots = Scroll.calc_roots(seq+1);
        let a = [];
        roots.forEach(r=>a.push(r_str(r)));
        assert.equal(a.join(' '), exp);
      };
      t(0, '0');
      t(1, '0_1');
      t(2, '0_1 2');
      t(3, '0_3');
      t(4, '0_3 4');
      t(5, '0_3 4_5');
      t(6, '0_3 4_5 6');
      t(7, '0_7');
      t(8, '0_7 8');
      t(9, '0_7 8_9');
      t(10, '0_7 8_9 10');
      t(11, '0_7 8_11');
      t(12, '0_7 8_11 12');
      t(13, '0_7 8_11 12_13');
      t(14, '0_7 8_11 12_13 14');
      t(15, '0_15');
      t(30, '0_15 16_23 24_27 28_29 30');
      t(31, '0_31');
      t(32, '0_31 32');
    });
    it('calc_merge_info', ()=>{
      const t = (seq, exp_all, exp_any)=>{
        let ret = Scroll.calc_merge_info(seq);
        let a = [];
        ret.all.forEach(r=>a.push(r_str(r)));
        assert.equal(a.join(' '), exp_all, 'all mismatch seq '+seq);
        a = [];
        ret.any.forEach(r=>a.push(r_str(r)));
        assert.equal(a.join(' '), exp_any, 'any mismatch seq '+seq);
      };
      t(0, '0', '1');
      t(1, '0_1', '2 2_3');
      t(2, '0_1 2', '3');
      t(3, '0_3', '4 4_5 4_7');
      t(4, '0_3 4', '5');
      t(5, '0_3 4_5', '6 6_7');
      t(6, '0_3 4_5 6', '7');
      t(7, '0_7', '8 8_9 8_11 8_15');
      t(8, '0_7 8', '9');
      t(9, '0_7 8_9', '10 10_11');
      t(10, '0_7 8_9 10', '11');
      t(11, '0_7 8_11', '12 12_13 12_15');
      t(12, '0_7 8_11 12', '13');
      t(13, '0_7 8_11 12_13', '14 14_15');
      t(14, '0_7 8_11 12_13 14', '15');
      t(15, '0_15', '16 16_17 16_19 16_23 16_31');
    });
    it('parse_buf_ref', ()=>{
      const t = (val, exp)=>assert.deepEqual(Scroll.parse_buf_ref(val), exp);
      t(null, {l: '_'});
      t(undefined, {l: '_'});
      t(0, {d: 0});
      t(1, {d: 1});
      t('', {buf: Buffer.from('')});
      t('a', {buf: Buffer.from('a')});
      t({d: 1}, {d: 1});
      t({d: '_'}, {l: '_'}); // XXX: derry, rename to l: '_'
    });
  });
  describe('macro', ()=>{
    it('to_m', ()=>{
      const t = (val, exp)=>assert.equal(macro_to_m(val, 's'), exp);
      t('0', 's.sig0 s.D0');
      t('0 1', 's.m0 s.sig1 s.D1');
      t('0_1', 's.m0_1');
      t('0_1 2', 's.m0_1 s.sig2 s.D2');
      t('0_1_2_3 4_5 6', 's.m0_3 s.m4_5 s.sig6 s.D6');
      t('0_1 2        ', 's.m0_1 s.sig2 s.D2');
      t('a', 's1.sig0 s1.D0');
      t('a b', 's1.m0 s1.sig1 s1.D1');
      t('a_b', 's1.m0_1');
      t('a_b c', 's1.m0_1 s1.sig2 s1.D2');
      t('a_b_c_d e_f g', 's1.m0_3 s1.m4_5 s1.sig6 s1.D6');
      t('A', 's2.sig0 s2.D0');
      t('A B', 's2.m0 s2.sig1 s2.D1');
      t('A_B', 's2.m0_1');
      t('A_B C', 's2.m0_1 s2.sig2 s2.D2');
      t('A_B_C_D E_F G', 's2.m0_3 s2.m4_5 s2.sig6 s2.D6');
      t('0 b', 's.m0 s1.sig1 s1.D1');
      t('0 B', 's.m0 s2.sig1 s2.D1');
      t('a B', 's1.m0 s2.sig1 s2.D1');
    });
  });
  describe('api', ()=>{
    const t = (name, test)=>it(name, ()=>test_run(test));
    describe('soul', ()=>{
      t('manual', `conf(soul:manual) soul1.s0..scroll(!prev_scroll d:1)
        soul1.s1.scroll(M0:s0..M0) soul2.s2.scroll(M0)
        M1=0x9ae687b90fd63ad629061a53e491e4f5fec8a6adebcb9afe374851ae42b62552
        s1.M1=M1 !s2.M1`);
      t('same', `conf(soul:same) s0..scroll(!prev_scroll d:1)
        s1.scroll(M0:s0..M0) s2.scroll(M0)
        M1=0x9ae687b90fd63ad629061a53e491e4f5fec8a6adebcb9afe374851ae42b62552
        s1.M1=M1 s2.M1=M1`);
      t('differnt', `conf(soul:differnt) s0..scroll(!prev_scroll d:1)
        s1.scroll(M0:s0..M0) s2.scroll(M0)
        M1=0x9ae687b90fd63ad629061a53e491e4f5fec8a6adebcb9afe374851ae42b62552
        !s1.M1 !s2.M1`);
      t('default', `s0..scroll(!prev_scroll d:1)
        s1.scroll(M0:s0..M0) s2.scroll(M0)
        M1=0x9ae687b90fd63ad629061a53e491e4f5fec8a6adebcb9afe374851ae42b62552
        !s1.M1 !s2.M1`);
    });
    describe('basic', ()=>{
      let sig0 = '0x9d73f19857885309cb311a8ec7d635ca2898da1b1fb8e31e9b7e01bb'+
        'bc6de68a5b9d756ff02462a3b2f8900e46a496ace5d3acb4f3e73180be515e93600'+
         '9e70c';
      t('no_prev_scroll', `s...scroll(!prev_scroll d:1) sig0=${sig0}
        d0=0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
        m0=0xa0d3dfd96822872daa1351808936ebce919fd82f3af2a14abbac987446d48017
        m0=hleaf(d0+sig0) sig0=sign(d0) M0=hroot(m0)
        m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
      sig0 = '0xb34dd640e4fb8f08593c91840b1175d1014a96a9e211b5f790a363980913'+
        '5a3c26a4f98b3c7798566d7241e4f7a9e97d99b2d7e075ec1e1f4e71a28e3c0dba0c';
      t('with_prev_scroll', `s...scroll(d:1) sig0=${sig0}
        d0=0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
        m0=0x0d7b0519668a3c03ba5b206d8dd92846fdb00b282d35d4b5c0a29bd230489eee
        m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0)
        m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
      t('merkel', `s...scroll(d:1-32)
        m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0)
          M0=h(2+m0+0+1)
        m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1) M1=h(2+m0_1+0+2)
        m2=hleaf(d2+sig2) sig2=sign(d2+M1) M2=hroot(m0_1+m2)
        M2=h(2+m0_1+0+2+m2+2+1)
        m3=hleaf(d3+sig3) sig3=sign(d3+M2) M3=hroot(m0_3)
        m4=hleaf(d4+sig4) sig4=sign(d4+M3) M4=hroot(m0_3+m4)
        m5=hleaf(d5+sig5) sig5=sign(d5+M4) M5=hroot(m0_3+m4_5)
        m6=hleaf(d6+sig6) sig6=sign(d6+M5) M6=hroot(m0_3+m4_5+m6)
        m7=hleaf(d7+sig7) sig7=sign(d7+M6) M7=hroot(m0_7)
        m8=hleaf(d8+sig8) sig8=sign(d8+M7) M8=hroot(m0_7+m8)
        m9=hleaf(d9+sig9) sig9=sign(d9+M8) M9=hroot(m0_7+m8_9)
        m10=hleaf(d10+sig10) sig10=sign(d10+M9) M10=hroot(m0_7+m8_9+m10)
        m11=hleaf(d11+sig11) sig11=sign(d11+M10) M11=hroot(m0_7+m8_11)
        m15=hleaf(d15+sig15) sig15=sign(d15+M14) M15=hroot(m0_15)
        m16=hleaf(d16+sig16) sig16=sign(d16+M15) M16=hroot(m0_15+m16)
        m30=hleaf(d30+sig30) sig30=sign(d30+M29)
        M30=hroot(m0_15+m16_23+m24_27+m28_29+m30)
        m31=hleaf(d31+sig31) sig31=sign(d31+M30) M31=hroot(m0_31)
        m32=hleaf(d32+sig32) sig32=sign(d32+M31) M32=hroot(m0_31+m32)
      `);
    });
    describe('put', ()=>{
      describe('errors_invalid', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M0) ==M0`;
        t('sig0', `${s} s.put(sig0:sig1 err(invalid sig0)) ==M0`);
        t('d0', `${s} s.put(d0:d1 err(invalid d0)) ==M0`);
        t('m0', `${s} s.put(m0:m1 err(invalid m0)) ==M0`);
        t('sig0 d0 m0', `${s} s.put(sig0:sig1 d0:d1 m0:d1
          err(invalid sig0,invalid d0,invalid m0)) ==M0`);
        t('sig1', `${s} s.put(sig1:sig0 err(invalid sig1)) ==M0`);
      });
      describe('errors_missing', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M0) ==M0`;
        t('sig0', `${s} put(sig0 err(missing d0)) ==M0`);
        t('d0', `${s} put(d0 err(missing sig0)) ==M0`);
      });
      describe('top_M0', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M0) ==M0`;
        t('sig0d0', `${s} put(sig0 d0) ==(sig0 d0 M0 m0)`);
        t('sig0d0_m0', `${s} put(sig0 d0 m0) ==(sig0 d0 M0 m0)`);
        t('sig0d0_m0_invalid_m0', `${s} put(sig0 d0 m0:m1 err(invalid M0))
          ==M0`);
        t('sig0d0_m0_invalid_sig0', `${s} put(sig0:sig1 d0 m0
          err(invalid sig0)) ==(M0 m0)`);
        t('sig0D0', `${s} put(sig0 D0) ==(sig0 d0 D0 M0 m0)`);
        t('sig0D0_invalid_sig', `${s} put(sig0:sig1 D0
          err(invalid M0)) ==M0`);
        t('sig0D0d0', `${s} put(sig0 D0 d0) ==(sig0 d0 D0 M0 m0)`);
        t('sig0D0d0_invalid_d0', `${s} put(sig0 D0 d0:d1
          err(invalid D0,invalid M0)) ==M0`);
        t('sig0d0_then_D0', `${s} put(sig0 d0) ==(sig0 d0 M0 m0)
          put(D0) ==(sig0 d0 D0 M0 m0)`);
        t('sig0d0_then_D0_invalid', `${s} put(sig0 d0)
          ==(sig0 d0 M0 m0) put(D0:D1 err(invalid D0)) ==(sig0 d0 M0 m0)`);
        t('m0', `${s} put(m0) ==(M0 m0)`);
        t('m0_invalid_m0', `${s} put(m0:m1 err(invalid M0)) ==M0`);
        t('m0_sig0d0', `${s} put(m0 sig0 d0) ==(M0 m0 sig0 d0)`);
        t('m0_sig0d0_missing_d0', `${s} put(m0 sig0 err(missing d0))
          ==(M0 m0)`);
        t('m0_sig0d0_missing_sig0', `${s} put(m0 d0 err(missing sig0))
          ==(M0 m0)`);
        t('m0_sig0d0_invalid_sig0', `${s} put(m0 sig0:sig1 d0
          err(invalid sig0)) ==(M0 m0)`);
        t('m0_sig0d0_invalid_d0', `${s} put(m0 sig0:sig0 d0:d1
          err(invalid sig0)) ==(M0 m0)`);
        t('m0_sig1d1', `${s} put(m0 sig1 d1) ==(sig1 d1 M0 m0 m1 m0_1)`);
        t('m0_sig1d1_invalid_m0', `${s} put(m0:m1 sig1 d1
          err(invalid M0,missing m0)) ==M0`);
        t('m0_sig1d1_invalid_sig1', `${s} put(m0 sig1:sig0 d1
          err(invalid sig1)) ==(M0 m0)`);
        t('m0m1_sig1d1', `${s} put(m0 m1 sig1 d1)
          ==(sig1 d1 M0 m0 m1 m0_1)`);
        t('m0m1_sig1d1_invalid_m0', `${s} put(m0:m1 m1 sig1 d1
          err(invalid M0,missing m0)) ==M0`);
        t('m0m1_sig1d1_invalid_m1', `${s} put(m0 m1:m0 sig1 d1
          err(invalid sig1)) ==(M0 m0)`);
        t('m0m1_sig1d1_invalid_sig1', `${s} put(m0 m1 sig1:sig0 d1
          err(invalid sig1)) ==(M0 m0)`);
        t('m0m1_sig1d1_missing_m0', `${s} put(m1 sig1 d1
          err(missing m0)) ==M0`);
        t('add_d2', `${s} put(sig2 d2 sig1 d1 m1 m0)
          ==(M0 sig2 d2 sig1 d1 m1 m0 m0_1 m2)`);
        t('add_d2D1', `${s} put(sig2 d2 sig1 D1 m1 m0)
          ==(M0 sig2 d2 sig1 d1 D1 m1 m0 m0_1 m2)`);
        t('add_D2', `${s} put(sig2 D2 sig1 D1 m1 m0)
          ==(M0 sig2 D2 d2 sig1 d1 D1 m1 m0 m0_1 m2)`);
        t('add_d3', `${s} put(sig3 d3 m0 m1 m2)
          ==(M0 m0 sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1)`);
        t('add_d3_missing_sig3', `${s} put(d3 m0 m1 m2
          err(missing sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d3_invalid_sig3', `${s} put(sig3:sig2 d3 m0 m1 m2
          err(invalid sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d3_invalid_m0', `${s} put(sig3 d3 m0:m1 m1 m2
          err(invalid M0, missing m0,missing sig2,missing sig1)) ==M0`);
        t('add_d3_invalid_m1', `${s} put(sig3 d3 m0 m1:m0 m2
          err(invalid sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d3_invalid_m2', `${s} put(sig3 d3 m0 m1 m2:m1
          err(invalid sig3,missing sig2,missing sig1)) ==(M0 m0)`);
        t('add_d7', `${s} put(sig7 d7 m0 m1 m2_3 m4_5 m6 m7 sig6 d6)`);
        t('add_d32', `${s}
          put(m0 m1 m2_3 m4_7 m8_15 d32 sig32 m31 m16_23 m24_27 m28_29 m30)
          ==(M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 m8_15 m0_15 m16_23 m16_31
          m0_31 m24_27 m28_29 m30 m31 m30_31 m28_31 m24_31 d32 sig32 m32)`);
        t('add_D32', `${s}
          put(m0 m1 m2_3 m4_7 m8_15 D32 sig32 m31 m16_23 m24_27 m28_29 m30)
          ==(M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 m8_15 m0_15 m16_23 m16_31
          m0_31 m24_27 m28_29 m30 m31 m30_31 m28_31 m24_31 d32 D32 sig32 m32)
        `);
        t('add_d32_invalid_m30', `${s}
          put(m0 m1 m2_3 m4_7 m8_15 d32 sig32 m31 m16_23 m24_27
          m28_29 m30:m0 err(invalid sig32,missing sig31,missing sig30,
          missing sig1)) ==(M0 m0)`);
        t('seq9_no_conflict', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0 sig3
          d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          put(sig9 d9) =M9 put(sig4 d4 m5 m4_5 m6_7) =M4
          put(sig5 d5) =M5 s2.put(sig6 d6 m7) =M6 put(sig7 d7)
          =M7 put(sig10 d10) =M10`);
        t('seq9_conflict', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0 sig3 d3
          m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          decl(9) M9=hroot(m0_7+s2.m8_9) // conflict
          put(sig9 d9 err(invalid sig9,invalid d9))
          M9=hroot(m0_7+s2.m8_9)
          put(sig4 d4 m5 m4_5 m6_7) =M4 s2.put(sig5 d5) =M5
          put(sig6 d6 m7) =M6 put(sig7 d7) =M7
          put(sig10 d10 err(invalid sig10)) !M10`);
        t('seq9_no_conflict_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10) =M9 =M4 =M5 =M6 =M7 =M10`);
        t('seq9_conflict_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          decl(9) M9=hroot(s2.m0_7+s2.m8_9) // conflict
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10 err(invalid sig10, invalid sig9,invalid d9))
          M9=hroot(s2.m0_7+s2.m8_9) =M4 =M5 =M6 s2.M7=M7 !M10`);
      });
      describe('top_M1', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M1) ==M1`;
        t('m0', `${s} put(m0 err(missing m1,missing m0_1)) ==M1`);
        t('m0m0_1', `${s} put(m0 err(missing m1,missing m0_1)) ==M1`);
        t('m1', `${s} put(m1 err(missing m0,missing m0_1)) ==M1`);
        t('m0m1', `${s} put(m0 m1) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_invalid_m0', `${s} put(m0:m1 m1 err(invalid M1)) ==M1`);
        t('m0m1_invalid_m1', `${s} put(m0 m1:m0 err(invalid M1)) ==M1`);
        t('m0m1_sig0d0', `${s} put(sig0 d0 m0 m1)
          ==(sig0 d0 M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_invalid_d0', `${s} put(sig0 d0:d1 m0 m1
          err(invalid sig0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_invalid_sig0', `${s} put(sig0:sig1 d0 m0 m1
          err(invalid sig0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_missing_d0', `${s} put(sig0 m0 m1
          err(missing d0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_missing_sig0', `${s} put(d0 m0 m1
          err(missing sig0)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1', `${s} put(sig1 d1 m0 m1)
          ==(sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_invalid_sig1', `${s} put(sig1:sig0 d1 m0 m1
          err(invalid sig1)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_missing_sig1', `${s} put(d1 m0 m1
          err(missing sig1)) ==(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_sig0d0', `${s} put(sig0 d0 sig1 d1 m0 m1)
          ==(sig0 d0 sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m0m1m0_1', `${s} put(m0 m1 m0_1) ==(M0 m0 M1 m1 m0_1)`);
        t('m0_sig1d1', `${s} put(m0 sig1 d1) ==(sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m1_sig0d0', `${s} put(sig0 d0 m1) ==(sig0 d0 M0 m0 M1 m1 m0_1)`);
        // XXX: add test for d0sig0_d1_sig1
        // XXX: add sig/d tests
      });
      describe('top_M2', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M2) ==M2`;
        t('m0', `${s} put(m0 err(missing m1,missing m0_1)) ==M2`);
        t('m0m1', `${s} put(m0 m1 err(missing m2)) ==M2`);
        t('m0m1m2', `${s} put(m0 m1 m2) ==(M2 m0 m1 m2 m0_1)`);
        t('m0m1m2_invalid_m0', `${s} put(m0:m1 m1 m2 err(invalid M2)) ==M2`);
        t('m0m1m2_invalid_m1', `${s} put(m0 m1:m0 m2 err(invalid M2)) ==M2`);
        t('m0m1m2_invalid_m2', `${s} put(m0 m1 m2:m0 err(invalid M2)) ==M2`);
        t('m0_1m2', `${s} s2.put(m0_1 m2) ==(M2 m2 m0_1)`);
        t('m0_1m2_invalid_m0_1', `${s} put(m0_1:m1 m2 err(invalid M2)) ==M2`);
        t('m0_1m2_invalid_m2', `${s} put(m0_1 m2:m1 err(invalid M2)) ==M2`);
        t('m0m1m2_sig3_d3', `${s} put(m0 m1 m2 sig3 d3)
          ==(M3 sig3 d3 m0 m1 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0m1m2_sig3_d3', `${s} put(m0 m1 m2 sig3 d3)
          ==(M3 sig3 d3 m0 m1 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0m1m2m3_sig4_d4', `${s} put(m0 m1 m2 m3 sig4 d4)
          ==(M4 sig4 d4 m0 m1 m2 m3 m4 m0_1 m2_3 m0_3)`);
        t('m0m1m2_3_sig4_d4_missing_m2',
          `${s} put(m0 m1 m2_3 sig4 d4 err(missing m2)) ==(M2)`);
        // XXX: add test for sig/d insert + invalid
      });
      describe('top_M3', ()=>{
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M3) ==M3`;
        t('m0', `${s} put(m0 err(missing m1,missing m0_1,missing m0_3)) ==M3`);
        t('m0m1', `${s} put(m0 m1
          err(missing m2,missing m2_3,missing m0_3)) ==M3`);
        t('m0m1m2', `${s} put(m0 m1 m2
          err(missing m3,missing m2_3,missing m0_3)) ==M3`);
        t('m0m1m2m3', `${s} put(m0 m1 m2 m3)
          ==(M3 m0 m1 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0m1m2m3_invalid_m0', `${s} put(m0:m1 m1 m2 m3 err(invalid M3))
          ==M3`);
        t('m0_1m2m3', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0_1m2m3_invalid_m0_1', `${s} put(m0_1:m0 m2 m3 err(invalid M3))
          ==M3`);
        t('m0_1m2m3_seq4_no_conflict', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) put(sig4 d4)
          ==(sig4 d4 M3 m2 m3 m0_1 m2_3 m0_3 m4) put(sig0 d0 m1) =M0`);
        t('m0_1m2m3_seq4_conflict', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // conflict
          put(sig4 d4 err(invalid sig4,invalid d4))
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) d4:s2.d4 M3 m2
          m3 m0_1 m2_3 m0_3) put(sig0 d0 m1) =M0`);
      });
      describe('top_M4', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M4) ==M4`;
        t('m0_3m4', `${s} put(m0_3 m4) ==(M4 m4 m0_3)`);
        t('m0_3m4_invalid_m0_3', `${s} put(m0_3:m0 m4 err(invalid M4)) ==M4`);
        t('m0_3m4_invalid_m4', `${s} put(m0_3 m4:m3 err(invalid M4)) ==M4`);
        // XXX: add test for sig/d insert + invalid
      });
      describe('top_M31', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M31) ==M31`;
        t('m0_15m16_23m24_27m28_29m30m31', `${s}
          put(m0_15 m16_23 m24_27 m28_29 m30 m31) ==(M31 m30 m31 m0_15
          m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_invalid_m0_15', `${s}
          put(m0_15:m0 m16_23 m24_27 m28_29 m30 m31 err(invalid M31)) ==M31`);
        t('m0_15m16_23m24_27m28_29m30m31_d30_sig30', `${s}
          put(d30 sig30 m0_15 m16_23 m24_27 m28_29 m30 m31)
          ==(sig30 d30 M31 m30 m31 m0_15 m16_23 m24_27 m28_29 m28_31
          m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d30_sig30_invalid_sig30', `${s}
          put(d30 sig30:sig31 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(invalid sig30)) ==(M31 m30 m31 m0_15 m16_23 m24_27 m28_29
          m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d31_sig31', `${s}
         put(d31 sig31 m0_15 m16_23 m24_27 m28_29 m30 m31)
         ==(sig31 d31 M31 m30 m31 m0_15
         m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d31_sig31_invalid_sig31', `${s}
          put(d31 sig31:sig30 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(invalid sig31)) ==(M31 m30 m31 m0_15 m16_23 m24_27 m28_29
          m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('seq29_ok', `${s}
          put(d29 sig29 m0_15 m16_23 m24_27 m28 m30 m31)
          ==(sig29 d29 M31 m28 m29 m30 m31 m0_15
          m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('seq29_ok_invalid_sig', `${s}
          put(d29 sig29:sig0 m0_15 m16_23 m24_27 m28 m30 m31
          err(invalid M31)) ==M31`);
        t('seq29_missing_m28', `${s}
          put(d29 sig29 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(missing m28,missing m28_29))
          ==(M31 m30 m31 m0_15 m16_23 m24_27 m28_29 m28_31
          m30_31 m24_31 m16_31 m0_31)`);
      });
      describe('extra_m', ()=>{
        t('M4_a', `s..scroll(!prev_scroll d:1-32) S..clone(s..M1)
          put(m2_3 sig4 d4) =m2_3 =M4 put(m2 m3 sig4 d4) =m2 =m3`);
        t('M4_b', `s..scroll(!prev_scroll d:1-32) S..clone(s..M1)
          put(m2_3 sig4 d4) =m2_3 =M4 put(m2 m3) =m2 =m3`);
        t('M8_a', `s..scroll(!prev_scroll d:1-32) S..clone(s..M3)
          put(m0_3 m4_7 sig8 d8) put(m0_3 m4 m5 m6_7 sig8 d8) =m4 =m5`);
        t('M8_b', `s..scroll(!prev_scroll d:1-32) S..clone(s..M3)
          put(m0_3 m4_7 sig8 d8)
          put(m0_3 m4_5:m6_7 m6_7 sig8 d8) !m4_5 !m6_7
          put(m0_3 m4_5 m6_7 sig8 d8) =m4_5 =m6_7
          put(m0_3 m4 m5 m6_7) =m4 =m5 =m4_5`);
      });
      describe('conflict', ()=>{
        // XXX need tests with prev_scroll
        // XXX need tests with decl on conflict
        let s = `s.scroll(!prev_scroll d:1-32) s2..scroll(s..M3) ==M3`;
        t('simple_conflict_a', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // conflict
          put(sig4 d4 m4 m0_1 m2 m3) c(M4=s2.M4 3c0.M4)
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) s2.d4 M3 m2 m3 m0_1
          m2_3 m0_3 sig4c1:sig4 d4c1:d4 m3c1:m3 m2_3c1:s.m2_3 m0_3c1:s.m0_3
          m0_1c1:s.m0_1 m2c1:s.m2 m4c1:s.m4) put(sig3 d3) sig3=sig3 d3=d3
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) s2.d4 M3 m2 m3 m0_1
          m2_3 m0_3 sig4c1:sig4 d4c1:d4 m3c1:m3 m2_3c1:s.m2_3 m0_3c1:s.m0_3
          sig3 d3 sig3c1:s.sig3 d3c1:s.d3 m0_1c1:s.m0_1 m2c1:s.m2 m4c1:s.m4)`);
        t('simple_conflict_b', `s.scroll(!prev_scroll d:1-10)
          s2..scroll(s..M3) put(M0 m0 m1 m2 m3) decl(4-7)
          s3..scroll(s2..M0)
          s3.put(sig7:s2..sig7 d7 m0 m1 m2_3 m4_5 m6 sig6 d6) =sig7
          s3.put(sig7:s..sig7 d7 m0 m1 m2 m3 m4_5 m6 sig6 d6)
          c(M7=s2.M7 3c0.M7)
          m0c1=s.m0 m3c1=s.m3 m4_5c1=s.m4_5 sig7c0=s2.sig7 sig7c1=s.sig7`);
        let p = '';
        t('1c0', `s.scroll(!prev_scroll d:1-5) s1.clone(s.M1)
          s1.decl(2-5) S..clone(s) put(m0:s1..m0 m1 sig2 d2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)`);
         t('1c0_missing_m', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5) S..clone(s)
          put(sig0:s1..sig0 d0 sig1 d1 sig2 d2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)`);
         t('1c0_missing_d', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5) S..clone(s)
          put(sig0:s1..sig0 D0 sig1 D1 sig2 D2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)`);
        t('1c0_1c0_1c0', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5)
          s2.clone(s.M1) s2.decl(3-5)
          s3.clone(s.M1) s3.decl(4-5)
          S..clone(s)
          put(m0:s1..m0 m1 sig2 d2)
          ${p=`sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2`}
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s2..m0 m1 sig2 d2)
          ${p+=` sig2c2=s2.sig2`} c(M5=s.M5 1c0.M2=s1.M2 1c0.M2=s2.M2)
          put(m0:s3..m0 m1 sig2 d2) ${p+=` sig2c3=s3.sig2`}
          c(M5=s.M5 1c0.M2=s1.M2 1c0.M2=s2.M2 1c0.M2=s3.M2)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3c1=s1.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 1c0.M2=s2.M2 1c0.M2=s3.M2)
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+= ` sig3c2=s2.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 1c0.M3=s2.M3 1c0.M2=s3.M2)
          put(m0:s3..m0 m1 m2 sig3 d3) ${p+= ` sig3c3=s3.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 1c0.M3=s2.M3 1c0.M3=s3.M3)
        `);
        t('1c0_2c0', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5)
          s2.clone(s.M2) s2.decl(3-5)
          S..clone(s) ${p=`sig1c0=s.sig1 sig2c0=s.sig2`}
          put(m0:s1..m0 m1 sig2 d2) sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s2..m0 m1 m2 sig2 d2)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s1..m0 m1 m2 sig3 d3)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2 sig3c1=s1.sig3
          c(M5=s.M5 1c0.M3=s1.M3)
          put(m0:s2..m0 m1 m2 sig3 d3)
          sig1c0=s.sig1 sig2c0=s.sig2 sig2c1=s1.sig2 sig3c1=s1.sig3
          sig3c2=s2.sig3 c(M5=s.M5 1c0.M3=s1.M3 2c0.M3=s2.M3)
        `);
        t('1c0_2c1', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5)
          s2.clone(s1.M2) s2.decl(3-5)
          S..clone(s) ${p=`sig1c0=s.sig1 sig2c0=s.sig2`}
          put(m0:s1..m0 m1 sig2 d2) ${p+=` sig2c1=s1.sig2`}
          c(M5=s.M5 1c0.M2=s1.M2)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3c1=s1.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3)
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+=` sig3c2=s2.sig3`}
          c(M5=s.M5 1c0.M3=s1.M3 2c1.M3=s2.M3)
          put(m0:s1..m0 m1 m2 m3 sig4 d4) ${p+=` sig4c1=s1.sig4`}
          c(M5=s.M5 1c0.M4=s1.M4 2c1.M3=s2.M3)
          put(m0:s2..m0 m1 m2 m3 sig4 d4) ${p+=` sig4c2=s2.sig4`}
          c(M5=s.M5 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        t('1c0_2c1_rev', `s.scroll(!prev_scroll d:1-5)
          s1.clone(s.M1) s1.decl(2-5) s2.clone(s1.M2) s2.decl(3-5)
          S..clone(s) ${p=`sig1c0=s.sig1 sig2c0=s.sig2`}
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+=` sig3c1=s2.sig3`}
          c(M5=s.M5 1c0.M3=s2.M3)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3c2=s1.sig3`}
          c(M5=s.M5 1c0.M3=s2.M3 2c1.M3=s1.M3)`);
        t('combined_m', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 m2_3 m2 m3 sig3 d3) c(M5=s0.M5 1c0.M4=s1.M4)`);
        t('combined_m_missing', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 m2_3 m3 sig3 d3
            err(missing m2,missing m2_3, missing m0_3))
          c(M5=s0.M5 1c0.M4=s1.M4)`);
        t('combined_m_invalid', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 s0.m2 m3 sig3 d3 err(invalid sig3))
          c(M5=s0.M5 1c0.M4=s1.M4)`);
         t('split_m', `s0..scroll(!prev_scroll d:1-5)
          s1..clone(s0.M1) decl(2-5) S..clone(s0)
          put(s1..m0_1 m2_3 sig4 d4) c(M5=s0.M5 1c0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M5=s0.M5 1c0.M4=s1.M4)
          S.sig3c1=s1.sig3`);
        t('3c0_8c0', `s.scroll(!prev_scroll d:1-32)
          s1.clone(s.M3) s1.decl(4-32) s2.clone(s.M8) s2.decl(9-32)
          s3.clone(s.M15) s3.decl(16-32) S..clone(s)
          put(s1..m0 m1 m2 m3 sig4 d4) c(M32=s.M32 3c0.M4=s1.M4)
          put(s2..m0 m1 m2_3 m4_7 m8 sig9 d9)
          c(M32=s.M32 3c0.M4=s1.M4 8c0.M9=s2.M9)
          put(s3..m0 m1 m2_3 m4_7 m8_15 sig16 d16)
          c(M32=s.M32 3c0.M4=s1.M4 8c0.M9=s2.M9 15c0.M16=s3.M16)`);
        t('3c0_8c1_a', `s.scroll(!prev_scroll d:1-10)
          s1.clone(s.M3) s1.decl(4-10) s2.clone(s1.M8) s2.decl(9-10)
          s3.clone(s1.M15) s3.decl(16-10) S..clone(s)
          put(s1..m0_3 sig4 d4) c(M10=s.M10 3c0.M4=s1.M4)
          put(s1..sig9 d9 m0_3 m4 m5 m6_7 m8) c(M10=s.M10 3c0.M9=s1.M9)
          put(s2..m0 m1 m2_3 m4_7 m8 sig9 d9)
          c(M10=s.M10 3c0.M9=s1.M9 8c1.M9=s2.M9)`);
        /*
        s0 0 1 2 3 4 5 6 7 8 9
        s1 0 1 2 3 a b c d e f
        s2 0 1 2 3 a b c d e F
        c0 0 1 2 3 4 5 6 7 8 9
        c1 0_1_2_3 a
        c2 0_1_2_3 a_b_c_d e F
        c3 0 1 2_3 a b c d e f
        */
        t('3c0_8c1_b', `s.scroll(!prev_scroll d:1-10)
          s1.clone(s.M3) s1.decl(4-10) s2.clone(s1.M8) s2.decl(9-10)
          s3.clone(s1.M15) s3.decl(16-10) S..clone(s)
          put(s1..m0_3 sig4 d4) c(M10=s.M10 3c0.M4=s1.M4)
          put(s2..m0_3 m4_7 m8 sig9 d9)
          c(M10=s.M10 3c0.M4=s1.M4 3c0.M9=s2.M9)
          put(s1..sig9 d9 m0 m1 m2_3 m4 m5 m6_7 m8)
          c(M10=s.M10 3c0.M9=s2.M9 8c1.M9=s1.M9)`);
        t('3c0_8c1_15c1_zzz3', `s.scroll(!prev_scroll d:1-10)
          s1.clone(s.M3) s1.decl(4-10) S..clone(s)
          put(s1..m0_3 sig4 d4) c(M10=s.M10 3c0.M4=s1.M4)
          put(s1..m0_3 m4_7 m8 sig9 d9) c(M10=s.M10 3c0.M4=s1.M4 3c0.M9=s1.M9)
          put(s1..sig9 d9 m0 m1 m2_3 m4 m5 m6_7 m8)
          c(M10=s.M10 3c0.M9=s1.M9)`);
        // c0 a b c d e
        // c1 a b c D E
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M2) decl(3-10)
          S..clone(s0.M1)`;
        t('2c0_a', `${s} put(s0..m0_1 m2 m3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2 m3 sig4 d4) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 a b c_d e
        // c1 a b c D E
        t('2c0_b', `${s} put(s0..m0_1 m2_3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2 m3 sig4 d4) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s0..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 a b c d e
        // c1 a b c_D E
        t('2c0_c', `${s} put(s0..m0_1 m2 m3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2_3 sig4 d4) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 a b c_d e
        // c1 a b c_D E
        t('2c0_d', `${s} put(s0..m0_1 m2_3 sig4 d4) c(M4=s0.M4)
          put(s1..m0_1 m2_3 sig4 d4) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s0..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 1c0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M4=s0.M4 2c0.M4=s1.M4)`);
        // c0 0 1 2 3 4
        // c1 0 1 a b c
        // c2 0 1 a B C
        t('2c1_a', `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..clone(s0)
          put(s1..m0_1 m2 m3 sig4 d4) c(M10=s0.M10 1c0.M4=s1.M4)
          put(s2..m0_1 m2 m3 sig4 d4)
          c(M10=s0.M10 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        // c1 0 1 a_b c
        // c2 0 1 a B C
        t('2c1_b', `s..scroll(!prev_scroll d:1-10) s1..clone(s.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..clone(s)
          put(s1..m0_1 m2_3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4)
          put(s2..m0_1 m2 m3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4 1c0.M4=s2.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M10=s.M10 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        t('2c1_c', `s..scroll(!prev_scroll) decl(1-10) s1..clone(s.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..scroll(s..M0)
          tput(0 1 2 3 4) c(M4)
          tput(0_1 c d e) c(M4 1c0.M4=s1.M4)
          tput(0_1 c_D E) c(M4 1c0.M4=s1.M4 1c0.M4=s2.M4)
          tput(0_1 c D E) c(M4 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        // c1 0 1 a_b c
        // c2 0 1 a_B C
        t('2c1_d', `s..scroll(!prev_scroll d:1-10) s1..clone(s.M1)
          decl(2-10) s2..clone(s1.M2) decl(3-10) S..clone(s)
          put(s1..m0_1 m2_3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4)
          put(s2..m0_1 m2_3 sig4 d4) c(M10=s.M10 1c0.M4=s1.M4 1c0.M4=s2.M4)
          put(s1..m0_1 m2 m3 sig3 d3) c(M10=s.M10 1c0.M4=s1.M4 1c0.M4=s2.M4)
          put(s2..m0_1 m2 m3 sig3 d3) c(M10=s.M10 1c0.M4=s1.M4 2c1.M4=s2.M4)`);
        //    0 1 2 3 4 5 6 7 8
        // c0 a b c d e_f_g_h i
        // c1 a b c d e_F_G_H I
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M4) decl(5-10)
          S..clone(s0.M3)`;
        t('M9_a', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s0..m0_3 m4 m5 m6_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s1..m0_3 m4 m5 m6_7 m8 sig9 d9) c(M8=s0.M8 4c0.M9=s1.M9)`);
        //    0 1 2 3 4 5 6 7 8
        // c0 a b c d e_f_g_h i
        // c1 a b c d e_f_G_H I
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M5) decl(6-10)
          S..clone(s0.M3)`;
        t('M9_b', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s0..m0_3 m4_5 m6 m7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s1..m0_3 m4_5 m6 m7 m8 sig9 d9) c(M8=s0.M8 5c0.M9=s1.M9)`);
        //    0 1 2 3 4 5 6 7 8
        // c0 a b c d e_f_g_h i
        // c1 a b c d e_f_g_H I
        s = `s0..scroll(!prev_scroll d:1-10) s1..clone(s0.M6) decl(7-10)
          S..clone(s0.M3)`;
        t('M9_c', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s0..m0_3 m4_5 m6 m7 sig8 d8) c(M8=s0.M8 3c0.M8=s1.M8)
          put(s1..m0_3 m4_5 m6 m7 m8 sig9 d9) c(M8=s0.M8 6c0.M9=s1.M9)`);
        s = `s..scroll(!prev_scroll d:1-10) S..clone(s..M3)`;
        // XXX: review and decide if we must require m0_3 or it should work
        t('partial_info', `${s}
          put(sig4 d4) c(M4)
          put(sig7 d7 m4_5 m6 err(missing m5, missing m4_5, missing M6,
            missing sig6)) c(M4)
          put(sig7 d7 m4_5 m0_3 m6) c(M4 3t0.M7)
        `);
        // c0 a b c d e
        // c1 a b c d e_f g h
        t('t2_a', `${s}
          put(sig4 d4) c(M4)
          put(sig7 d7 m0_3 m4_5 m6) c(M4 3t0.M7)
          put(m0_3 m4 sig5 d5) c(M7)
          put(m0_3 m4_5 sig6 d6) c(M7)
          put(m0_3 m4_5 m6 sig7 d7) c(M7)`);
        s = `s..scroll(!prev_scroll d:1-10) S..clone(s..M4)`;
        // c0 0 1 2 3 4
        // c1 0 1 2 3 4_5 6_7 8 9
        // c2 0 1 2 3 4 5 6
        // c3 0 1 2 3 4_5 6 7
        t('t3_a', `${s}
          put(sig9 d9 m8 m6_7 m4_5 m0_3) c(M4 3t0.M9)
          put(sig6 d6 m4 m5 m0_3) c(M9 5t0.M6)
          put(sig7 d7 m6 m4_5 m0_3) c(M9)`);
        // c0 0 1 2 3 4
        // c1 0 1 2 3 4_5 6_7 8 9
        // c2 0 1 2 3 4_5 6
        // c3 0 1 2 3 4 5 6 7
        t('t3_b', `${s}
          put(sig9 d9 m8 m6_7 m4_5 m0_3) c(M4 3t0.M9)
          put(sig6 d6 m4_5 m0_3) c(M4 3t0.M9 5t1.M6)
          put(sig7 d7 m6 m4 m5 m0_3) c(M9)`);
        s = 's..scroll(!prev_scroll d:1-10)';
        t('t4_a', `${s} S..scroll(s..M0)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9)
          tput(0_1_2_3 4 5 6      ) c(M9 5t0.M6)
          tput(0_1_2_3 4_5 6 7    ) c(M9)`);
        t('t4_b', `${s} S..scroll(s..M0)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9)
          tput(0_1_2_3 4_5 6      ) c(M4 3t0.M9 5t1.M6)
          tput(0_1_2_3 4 5 6 7    ) c(M9)`);
        t('t4_c', `${s} S..scroll(s..M0)
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5_6_7 8) c(M2 1t0.M4 3t1.M6 3t2.M8)
          tput(0_1 2 3 4 5 6 7) c(M8)`);
       t('t4_a_full', `${s} S..scroll(s..M0) #(mem)
          tput(0 1 2 3 4          ) c(M4) #(mem0={m0 M0} mem1={m1 m0_1 M1}
            mem2={m2 M2} mem3={m3 m2_3 m0_3 M3} mem4={m4 M4 sig4 D4})
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9) #(mem5={S.m4_5c1 S.M5c1}
            mem7={S.m6_7c1 S.m4_7c1 S.m0_7c1 S.M7c1} mem8={S.m8c1 S.M8c1}
            mem9={S.m9c1 S.m8_9c1 S.M9c1 S.D9c1 S.sig9c1})
          tput(0_1_2_3 4 5 6      ) c(M9 5t0.M6) #(mem5={m5 M5 m4_5}
            mem6={S.m6c2 S.M6c2 S.D6c2 S.sig6c2}
            mem7={S.m6_7 S.m4_7 S.m0_7 S.M7} mem8={S.m8 S.M8}
            mem9={S.m9 S.m8_9 S.M9 S.D9 S.sig9})
          tput(0_1_2_3 4_5 6 7    ) c(M9) #(mem6={S.m6 S.M6 S.D6 S.sig6}
            mem7={S.m7 S.m6_7 S.m4_7 S.m0_7 S.M7 S.D7 S.sig7})`);
       t('v_d', `${s} S..scroll(s..M0)
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5 6_7 8) c(M2 1t0.M4 3t1.M6 5t2.M8)
          tput(0_1 2 3 4 5 6 7) c(M8)`);
        s = `s..scroll(!prev_scroll d:1-10)
          s1..clone(s.M4) decl(5-10) S..scroll(s..M0)`;
        t('c_not_final', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5 6_7 8) c(M2 1t0.M4 3t1.M6 5t2.M8)
          tput(0_1 2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 5t2.M8 3c3.M6=s1.M6)
          // XXX: support 3_4c0 for non-final brnaching point
          tput(0_1 2 3 4 5 6 7  ) c(M8 3c0.M6=s1.M6)
          tput(0_1 2_3 4 f      ) c(M8 4c0.M6=s1.M6)`);
        t('c_conflict_vconflict', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_5 6_7 8) c(M2 1t0.M4 3t1.M6 5t2.M8)
          tput(0_1 2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 5t2.M8 3c3.M6=s1.M6)
          tput(0_1 2_3 4_f g_h i)
            c(M2 1t0.M4 3t1.M6 5t2.M8 3c3.M6=s1.M6 5t4.M8=s1.M8)
          tput(0_1 2 3 4 5 6 7  ) c(M8 3c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1 2_3 4 f      ) c(M8 4c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1 2_3 4 f g h  ) c(M8 4c0.M8=s1.M8)
        `);
        t('c_conflict_vconflict_b', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 3c2.M6=s1.M6)
          tput(0_1_2_3 4_f g_h i) c(M2 1t0.M4 3t1.M6 3c2.M6=s1.M6 5t3.M8=s1.M8)
          // XXX: support 3_4c0 for non-final brnaching point
          tput(0_1 2 3 4 5 6    ) c(M6 3c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1_2_3 4 f      ) c(M6 4c0.M6=s1.M6 5t1.M8=s1.M8)
          tput(0_1_2_3 4 f g h  ) c(M6 4c0.M8=s1.M8)
        `);
        t('c_select_longest_a', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4        ) c(M2 1t0.M4)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M4 3t1.M6)
          tput(0_1_2_3 4_f g    ) c(M2 1t0.M4 3t1.M6 3c2.M6=s1.M6)
        `);
        t('c_select_longest_b', `${s}
          tput(0 1 2            ) c(M2)
          tput(0_1 2_3 4_5_6_7 8) c(M2 1t0.M8)
          tput(0_1_2_3 4_5 6    ) c(M2 1t0.M8 3t1.M6)
          tput(0_1_2_3 4_f g    ) c(M2 1t0.M8 3t1.M6 3t1.M6=s1.M6)`);
        t('v_consequtive_a', `${s}
          tput(0 1              ) c(M1)
          tput(0 1 2            ) c(M2)
          tput(0 1 2 3          ) c(M3)
          tput(0 1 2_3 4        ) c(M4)
          tput(0_1_2_3 4 5      ) c(M5)
          tput(0_1_2_3 4_5 6    ) c(M6)
          tput(0_1_2_3 4_5 6 7  ) c(M7)
          tput(0_1_2_3 4_5_6_7 8) c(M8)`);
        t('v_consequtive_b', `${s}
          tput(0 1              ) c(M1)
          tput(0 1 2_3 4        ) c(M4)
          tput(0_1_2_3 4 5 6_7 8) c(M8)`);
        t('v_temp', `${s}
          tput(0 1              ) c(M1)
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5_6_7 8) c(M4 3t0.M8)
          tput(0 1 2_3 4 5 6_7 8) c(M8)`);
        t('data_full_merge_d1', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.d1c0 !S.sig1c0
          put(m0 m1 d1 sig1) S.d1c0=s.d1 S.sig1c0=s.sig1
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.d1=s.d1 S.sig1=s.sig1`);
        t('data_full_merge_d7', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.d7c1 !S.sig7c1
          put(m0_3 m4_5 m6 d7 sig7) S.d7c1=s.d7 S.sig7c1=s.sig7
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.d7=s.d7 S.sig7=s.sig7`);
        t('data_full_merge_D1', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.D1c0 !S.sig1c0
          put(m0 m1 D1 sig1) S.D1c0=s.D1 S.sig1c0=s.sig1
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.D1=s.D1 S.sig1=s.sig1`);
         t('data_full_merge_D7', `${s}
          tput(0 1 2_3 4        ) c(M4)
          tput(0 1 2_3 4_5 6 7 8) c(M4 3t0.M8) !S.D7c1 !S.sig7c1
          put(m0_3 m4_5 m6 D7 sig7) S.D7c1=s.D7 S.sig7c1=s.sig7
          tput(0 1 2_3 4 5 6 7 8) c(M8) S.D7=s.D7 S.sig7=s.sig7`);
        t('data_merge_stages', `${s}
          tput(0 1 2 3 4          ) c(M4)
          put(m0_3 D4 sig4) S.D4c0=s.D4
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9) S.D4c0=s.D4
          tput(0_1_2_3 4 5 6      ) c(M9 5t0.M6) S.D4c0=s.D4
          tput(0_1_2_3 4_5 6 7    ) c(M9) S.D4c0=s.D4`);
      });
    });
    describe('storage', ()=>{
      describe('mem', ()=>{
        t('seq0', `s.scroll S..# clone(s..)
          #(mem_c=0:M0 mem0={M0 sig0 D0 m0} !mem1)
          mem.unload #(mem0={M0} !mem1)`);
        t('seq1', `s.scroll(d:1) S..# clone(s..)
          #(mem0={M0 sig0 D0 m0} mem1={M1 sig1 D1 m1 m0_1} mem_c=0:M1)
          mem.unload #(mem0={M0} !mem1 mem_c=0:M0)`);
      });
      describe('db_put', ()=>{ // XXX: rename
        t('one_soul', `s.#(db_c db) s..scroll(db) c(M0=s..M0)
          flush #(db_c={0:0:M0} db0={M0 sig0 D0 m0})`);
        t('two_soul', `conf(soul:manual) soul.s.scroll(db) S.#(db_c db)
          Soul.S.clone(s.. db) S.flush S.#(db_c={0:0:M0} db0={M0 sig0 D0 m0})
          Soul2.db_copy(Soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M0} mem0={M0 sig0 D0 m0})`);
        t('b0_seq1', `s.scroll(d:1) S.#(db_c db) S..clone(s.. db)
          flush #(db_c={0:0:M1} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1} load_c(2) #`);
        t('b0_seq4_normal', `s.scroll(d:1-4) S.#(db_c db) S..clone(s.. db)
          flush #(db_c={0:0:M4} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1}
            db2={M2 sig2 D2 m2} db3={M3 sig3 D3 m3 m2_3 m0_3}
            db4={M4 sig4 D4 m4})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M4} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(2) #mem2={M2 sig2 D2 m2}
          load_c(3) #mem3={M3 sig3 D3 m3 m2_3 m0_3}
          load_c(4) #mem4={M4 sig4 D4 m4}
          load_c(5) #`);
        t('b0_seq4_rev', `s.scroll(d:1-4) S..#(db_c db) clone(s.. db)
          flush #(db_c={0:0:M4} db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1}
            db2={M2 sig2 D2 m2} db3={M3 sig3 D3 m3 m2_3 m0_3}
            db4={M4 sig4 D4 m4})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M4} mem0={M0 sig0 D0 m0})
          load_c(5) #
          load_c(4) #mem4={M4 sig4 D4 m4}
          load_c(3) #mem3={M3 sig3 D3 m3 m2_3 m0_3}
          load_c(2) #mem2={M2 sig2 D2 m2}
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1}`);
        t('c1', `s0.scroll(d:1-6) s1..scroll(s0..M0) tput(0 1 2 3 4    )
          tput(0_1_2_3 4_5 6) S..#(db_c db)
          clone(s1.. db) flush #(db_c={0:0:M4 1:1:3t0.M6=s0.M6}
            db0={M0 m0} db1={M1 m1 m0_1} db2={M2 m2} db3={M3 m3 m2_3 m0_3}
            db4={M4 sig4 D4 m4} db5={M5c1 m4_5c1} db6={M6c1 sig6c1 D6c1 m6c1})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          // XXX: why mem1/mem3 are loaded (due to update_mergeable)
          Soul2.S2..scroll(M0 db) #(mem1={M1 m1 m0_1} mem3={M3 m3 m2_3 m0_3}
          mem_c={0:M4 1:3t0.M6=s0.M6} mem0={M0 m0} mem4={M4 sig4 D4 m4}
          mem5={M5c1 m4_5c1})
          load_c(1) #
          load_c(2) #mem2={M2 m2} load_c(2c1) #
          load_c(3) #
          load_c(4) # load_c(4c1) #
          load_c(5) # load_c(5c1) #
          load_c(6) # load_c(6c1) #mem6={M6c1 sig6c1 D6c1 m6c1}
          load_c(7) # load_c(7c1) #`);
// XXX NOW how to handle conflict merge (c in db is wrong now) + add tests
// XXX NOW need dirty flag to know what needs to be saved to db; also for blob
      });
      describe('db_data', ()=>{
        t('no_split', `s.scroll s.decl(data:32KB) S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1 m1 m0_1})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_load_first', `s.scroll s.decl(data:33KB) S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
            db_data=D1F2)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1) # load_c(1 data) #`);
        t('split_load_late', `s.scroll s.decl(data:33KB) S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
            db_data=D1F2)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_max_decl_1', `s.scroll s.decl(data(33KB 28KB))
          S..#(db db_data)
          clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1F3] m1 m0_1}
            db_data=D1F2)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1F3] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_max_decl_2', `s.scroll s.decl(data(32KB 29KB))
          S..#(db db_data) clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1F2 D1f3] m1 m0_1}
            db_data=D1F3)
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1F2 D1f3] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_max_decl_3', `s.scroll s.decl(data(33KB 33KB))
          S..#(db db_data) clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1f3] m1 m0_1}
            db_data={D1F2 D1F3})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M1} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2 D1f3] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(1 data) #`);
        t('split_multi', `s.scroll s.decl(data:33KB) s.decl(data:33KB)
          S..#(db db_data) clone(s.. db(max_decl:60KB max_frame:32KB)) flush
          #(db0={M0 sig0 D0 m0} db1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
            db2={M2 sig2 D2:[D2F0 D2F1 D2f2] m2} db_data={D1F2 D2F2})
          Soul2.db_copy(S.soul) S2.#(mem mem_c)
          Soul2.S2..scroll(M0 db) #(mem_c={0:M2} mem0={M0 sig0 D0 m0})
          load_c(1) #mem1={M1 sig1 D1:[D1F0 D1F1 D1f2] m1 m0_1}
          load_c(1 data) #mem1={M1 sig1 D1 m1 m0_1}
          load_c(2) #mem2={M2 sig2 D2:[D2F0 D2F1 D2f2] m2}
          load_c(2 data) #mem2={M2 sig2 D2 m2}
        `);
      });
      describe('write', ()=>{
        // XXX: rm c and support 0:0:s..M1
        t('simple', `s..scroll(db) #(db_c db) c(M0=s..M0)
          flush #db0={m0 M0 sig0 D0}
          decl(1) c(M1=s..M1) flush #(db_c={0:0:M1} db1={M1 sig1 D1 m1 m0_1})
          decl(2) c(M2=s..M2) flush #(db_c={0:0:M2} db2={M2 sig2 D2 m2})`);
        t('conflict', `s..scroll(d:1-10) S..scroll(s..M0 db) #(db_c db)
          tput(0 1 2 3 4          ) c(M4) flush #(db_c={0:0:M4} db0={m0 M0}
            db1={m1 m0_1 M1} db2={m2 M2} db3={m3 m2_3 m0_3 M3}
            db4={m4 M4 sig4 D4})
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9)
            flush #(db_c={0:0:M4 1:1:3t0.M9} db5={S.m4_5c1 S.M5c1}
            db7={S.m6_7c1 S.m4_7c1 S.m0_7c1 S.M7c1} db8={S.m8c1 S.M8c1}
            db9={S.m9c1 S.m8_9c1 S.M9c1 S.D9c1 S.sig9c1})
          tput(0_1_2_3 4 5 6      ) c(M9 5t0.M6)
            flush #(db_c={0:0:M9 2:2:5t0.M6} db5={m5 M5 m4_5}
            db6={S.m6c2 S.M6c2 S.D6c2 S.sig6c2}
            db7={S.m6_7 S.m4_7 S.m0_7 S.M7} db8={S.m8 S.M8}
            db9={S.m9 S.m8_9 S.M9 S.D9 S.sig9})
          tput(0_1_2_3 4_5 6 7    ) c(M9) flush #(db_c={0:0:M9}
            db6={S.m6 S.M6 S.D6 S.sig6}
            db7={S.m7 S.m6_7 S.m4_7 S.m0_7 S.M7 S.D7 S.sig7})`);
      });
      describe('read', ()=>{
        t('simple', `conf(soul:manual)
          soul.s..scroll(db) #(db_c) s.decl(1-2) c(M2=s..M2) flush
          #db_c={0:0:M2} Soul.db_copy(soul) S.#(db_c mem) Soul.S..scroll(M0 db)
          #(mem0={m0 M0 sig0 D0} db_c={0:0:M2})
          S.load_c(0) #
          load_c(1) #mem1={m1 m0_1 sig1 M1 D1}
          load_c(2) #mem2={m2 sig2 M2 D2}
          decl(3) flush #(mem3={m3:S..m3 m2_3 m0_3 sig3 M3 D3} db_c={0:0:M3})
        `);
        t('xxx0', `conf(soul:manual)
          soul.s..scroll(db) decl(1-2) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(3) flush #(
            mem1={m1:S..m1 m0_1 sig1 M1 D1}
            mem2={m2 sig2 M2 D2}
            mem3={m3 m2_3 m0_3 sig3 M3 D3} db3={m3 m2_3 m0_3 sig3 M3 D3}
            mem_c={0:M3} db_c={0:0:M3})
        `);
        t('xxx1', `conf(soul:manual)
          soul.s..scroll(db) decl(1-3) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(4) flush #(
            mem3={m3:S..m3 m2_3 m0_3 sig3 M3 D3}
            mem4={m4 sig4 M4 D4} db4={m4 sig4 M4 D4}
            mem_c={0:M4} db_c={0:0:M4})`);
        t('xxx2', `conf(soul:manual)
          soul.s..scroll(db) decl(1-7) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(8) flush #(
            mem7={M7:S..M7 m7 m6_7 m4_7 m0_7 sig7 D7}
            mem8={M8 m8 sig8 D8}
            db8={M8 m8 sig8 D8}
            mem_c={0:M8} db_c={0:0:M8})
          // XXX m0_7=(m0_3 m4_7) m4_7=(m4_5 m6_7)
          decl(9) flush #(mem9={M9 m9 m8_9 sig9 D9} db9={M9 m9 m8_9 sig9 D9}
            mem_c={0:M9} db_c={0:0:M9})
        `);
        t('xxx3', `conf(soul:manual)
          soul.s..scroll(db) decl(1-15) flush
          Soul.db_copy(soul) Soul.S..scroll(s..M0 db) # mem0={m0 M0 sig0 D0}
          decl(16) flush #(
            mem15={M15:S..M15 m15 m14_15 m12_15 m8_15 m0_15 sig15 D15}
            mem16={M16 m16 sig16 D16}
            db16={M16 m16 sig16 D16}
            mem_c={0:M16} db_c={0:0:M16})
        `);
        // XXX: create example with 8 and 16 (verify hash-needed works
        // correctly)
        t('conflict', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db) #(db_c)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9)
          flush #(db_c={0:0:M4 1:1:3t0.M9})
          Soul2.db_copy(Soul) Soul2.S2..scroll(M0 db) c(M4 3t0.M9) #(db_c mem)
          // XXX: why mem1/mem3 are loaded (due to update_mergeable)
          mem0={M0 m0} mem1={M1 m1 m0_1}
          mem3={M3 m3 m2_3 m0_3}
          // XXX: add mem4 mem5 mem7
          !mem2 !mem6 !mem8 !mem9
          load_c(4) #mem4={m4 M4 sig4 D4}
          // XXX: why mem7 is loaded?
          load_c(5c1) #(mem5={S.m4_5c1 S.M5c1}
            mem7={S.m6_7c1 S.m4_7c1 S.m0_7c1 S.M7c1})
          // XXX: load more
        `);
        t('conflict-xxx', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db) #(db_c)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9) c(M4 3t0.M9)
          flush #(db_c={0:0:M4 1:1:3t0.M9})
          Soul2.db_copy(Soul) Soul2.S2..scroll(M0 db) c(M4 3t0.M9) #(db_c mem)
          mem0={M0 m0} mem1={M1 m1 m0_1}
          mem3={M3 m3 m2_3 m0_3}
// mem4 mem5 mem7
          !mem2 !mem6  !mem8 !mem9
          tput(0_1_2_3 4 5 6      )
          c(M9 5t0.M6)
        `);
        t('on_demand-simple1', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          ) c(M4)
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4})
          tput(0_1 2_3 4 5 6)
          #(mem_c={0:M6} mem1={M1 m1 m0_1} mem3={M3 m3 m2_3 m0_3}
            mem4={M4 m4 sig4 D4} mem5={M5 m5 m4_5} mem6={M6 m6 sig6 D6})`);
        t('on_demand-simple2', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          ) c(M4)
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4})
          tput(0_1_2_3 4 5 6)
          #(mem_c={0:M6} mem3={M3 m3 m2_3 m0_3} mem4={M4 m4 sig4 D4}
            mem5={M5 m5 m4_5} mem6={M6 m6 sig6 D6})`);
        t('on_demand-conflict1', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          ) c(M4)
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4})
          tput(0_1_2_3 4_5 6_7 8 9)
          #(mem_c={0:M4 1:3t0.M9} mem3={M3:S2..M3 m3 m2_3 m0_3}
            mem4={M4 m4 sig4 D4} mem5={M5c1 m4_5c1}
            mem7={M7c1 m6_7c1 m4_7c1 m0_7c1} mem8={M8c1 m8c1}
            mem9={M9c1 sig9c1 D9c1 m9c1 m8_9c1})
          def(s..) tput(0_1_2_3 4 5 6      ) #(mem_c={0:M9 2:5t0.M6}
            mem5={M5 m5 m4_5} mem7={M7 m6_7 m4_7 m0_7} mem8={M8 m8}
            mem9={M9 sig9 D9 m9 m8_9} mem6={M6c2:S2..M6c2 sig6c2 D6c2 m6c2})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem8={M8 m8} mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand-conflict2', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          ) c(M4)
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4})
          tput(0_1_2_3 4_5 6_7 8 9)
          tput(0_1_2_3 4 5 6      )
          #(mem_c={0:M9 2:5t0.M6} mem3={M3:S2..M3 m3 m2_3 m0_3}
            mem4={M4 m4 sig4 D4} mem5={M5 m5 m4_5} mem6={M6c2 sig6c2 D6c2 m6c2}
            mem7={M7 m6_7 m4_7 m0_7} mem8={M8 m8} mem9={M9 sig9 D9 m9 m8_9})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem8={M8 m8} mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand-conflict3', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9)
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem0={M0 m0} mem_c={0:M4 1:3t0.M9} mem1={M1 m1 m0_1}
            mem3={M3 m3 m2_3 m0_3} mem4={M4 sig4 D4 m4}
            mem5={M5c1:S2..M5c1 m4_5c1}
            mem7={M7c1 m6_7c1 m4_7c1 m0_7c1})
          def(s..) tput(0_1_2_3 4 5 6      )
          #(mem_c={0:M9 2:5t0.M6} mem4={M4 sig4 D4 m4} mem5={M5 m5 m4_5}
            mem6={M6c2:S2.M6c2 sig6c2:S2.sig6c2 D6c2:S2.D6c2 m6c2:S2.m6c2}
            mem7={M7 m6_7 m4_7 m0_7} mem9={M9 sig9 D9 m9 m8_9})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem9={M9 sig9 D9 m9 m8_9})`);
        t('on_demand-conflict4', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9)
          tput(0_1_2_3 4 5 6      )
          flush Soul2.db_copy(Soul) S2..#(mem_c mem) Soul2.S2.scroll(M0 db)
          #(mem_c={0:M9 2:5t0.M6} mem0={M0 m0} mem1={M1 m1 m0_1}
            mem6={M6c2:S.M6c2 sig6c2:S.sig6c2 D6c2:S.D6c2 m6c2:S.m6c2}
            mem3={M3 m3 m2_3 m0_3} mem7={M7 m6_7 m4_7 m0_7})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7} mem6={M6 sig6 D6 m6}
            mem9={M9 sig9 D9 m9 m8_9})`);
         t('manual_load-conflict', `conf(soul:manual)
          soul.s..scroll(d:1-10) Soul.S..scroll(s..M0 db)
          tput(0 1 2 3 4          ) c(M4)
          tput(0_1_2_3 4_5 6_7 8 9)
          flush Soul2.db_copy(Soul) S2..#(mem_c) Soul2.S2.scroll(M0 db)
          #(mem_c={0:M4 1:3t0.M9}) load_c(0) load_c(1) load_c(2) load_c(3)
          load_c(4c1) load_c(5c1) load_c(6c1) load_c(7c1) load_c(8c1)
          load_c(9c1) tput(0_1_2_3 4 5 6      )
          #(mem_c={0:M9 2:5t0.M6})
          def(s..) tput(0_1_2_3 4_5 6 7    ) #(mem_c={0:M9} mem5={M5 m5 m4_5}
            mem6={M6 sig6 D6 m6} mem7={M7 sig7 D7 m7 m6_7 m4_7 m0_7}
            mem9={M9 sig9 D9 m9 m8_9})`);
        // XXX: add more complex tests (multiple scrolls with multiple scfids
        // and decl/put to scorll after loading from db
      });
    });
  });
});
