'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import Storage_handler from './storage.js';
import xsinon from '../util/sinon.js';
import enc from 'compact-encoding';
import string from '../util/string.js';
import xerr from '../util/xerr.js';
import xutil from '../util/util.js';
import crypto from '../util/crypto.js';
import Scroll from './scroll.js';
import Soul from './soul.js';
import buf_util from '../net/buf_util.js';
import tparser from './test_parser.js';
import {r_str, r_from_str} from './range.js';
import Branch_table from './branch.js';
const {bseq_valid} = Branch_table;
const {rm_parentesis, parse_get_next, parse_exp_arg_pair, parse_exp,
  parse_exp_arg, parse_push} = tparser;
const {b2s, s2b, b2s_obj} = buf_util;
const test_cmd_hooks = [];

function enc_u64(v){ return enc.encode(enc.uint64, v); }
let t_soul, t_soul_id, t_soul_mode, t_state;
let t_scroll, t_genesis_scroll, t_prev_scroll, t_def, t_keypair;
function space(s){ return s ? s+' ' : ''; }

function tjoin(v, cmd, arg){
  let s = v ? v+'.'+cmd : cmd;
  return arg ? s+'('+arg+')' : s;
}

let t_hooks = {};
export function test_register(name, cb){
  assert(!t_hooks[name], 'hook already registred '+name);
  t_hooks[name] = cb;
}

export function macro_to_m(val, dst){
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
      s = space(s)+(i==a.length-1 || n==0 ?
        d+'.sig'+n+' '+d+'.D'+n : d+'.m'+n);
      continue;
    }
    let m = a[i].split('_');
    assert(m.length>1, 'invalid m '+val);
    let {n, d} = to_nd(m[m.length-1]);
    let n0 = to_nd(m[0]).n;
    s = space(s)+d+'.m'+n0+'_'+n;
  }
  return s;
}

const array_from_str = exp=>etask(function*array_from_str(){
  let ret=[], a=[];
  for (let curr=exp, i=0; curr = parse_get_next(curr); i++)
    a.push(curr.exp);
  for (let i=0; i<a.length; i++)
    ret.push(yield get_val(a[i]));
  return ret;
});

const struct_from_str = exp=>etask(function*struct_from_str(){
  let a=[], seq, ret;
  for (let curr=exp, i=0; curr = parse_get_next(curr); i++)
    a.push(curr.exp);
  for (let i=0; i<a.length; i++){
    let t = parse_exp_arg_pair(a[i]);
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
  let db = scroll.soul.db, tx = db.transaction('decl', 'readonly');
  let store = tx.store('decl');
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

function test_parse_index(str){
  let ret = [];
  str = rm_parentesis(str, '[');
  for (let curr=str; curr = parse_get_next(curr);)
    ret.push(curr.exp);
  return ret;
}

function js_struct_from_str(str){
  let ret = {};
  str = rm_parentesis(str, '{');
  for (let curr=str; curr = parse_get_next(curr);){
    let tt = parse_exp_arg(curr.exp);
    ret[tt.cmd] = tt.r;
  }
  return ret;
}

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

export function parse_var(v){
  let m;
  v = string.split_ws(v).join(' ');
  if (m = v.match(/^\{(.*)\}$/))
    return {type: 'struct', val: m[1]};
  if (m = v.match(/^\[(.*)\]$/))
    return {type: 'array', val: m[1]};
  m = v.match(/^([a-zA-Z]\d*)(\.|\.\.)([^.]*)$/);
  let ctx = m ? m[1] : '', def = m ? m[2]=='..' : false;
  v = m ? m[3] : v;
  if (['db_c', 'db_data', 'mem_c', 'bname'].includes(v))
    return {type: v, ctx, def};
  if (m = v.match(/^btc(\d+)\[(\d+)\]$/))
    return {type: 'btc', cfid: +m[1], index: +m[2], ctx, def};
  if (m = v.match(/^db_btc(\d+)\[(\d+)\]$/))
    return {type: 'db_btc', cfid: +m[1], index: +m[2], ctx, def};
  if (m = v.match(
    /^(seq|bseq|sig|m|M|d|D|mem|db)((\d+)|((\d+)_(\d+)))(c(\d+))?$/))
  {
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
  assert(bseq_valid(v), 'invalid bseq '+v);
  return v;
}

export function get_scroll(name, may_not_exist){
  let scroll = t_scroll[name];
  if (!may_not_exist)
    assert(scroll, 'scroll not found '+name);
  return scroll;
}

export function set_def(type, val){
  assert(['left', 'right'].includes(type), 'invalid default type '+type);
  assert(val, 'invalid default '+type+' val '+val);
  return t_def[type] = val;
}

export function get_def(type){
  assert(['left', 'right'].includes(type), 'invalid default type '+type);
  assert(t_def[type], 'no default type '+type);
  return t_def[type];
}

function fix_buf(o){
  if (!o)
    return;
  let ret;
  if (Array.isArray(o)){
    ret = [];
    for (let i=0; i<o.length; i++)
      ret.push(fix_buf(o[i]));
    return ret;
  }
  ret = {};
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

function c_id2pos(scroll, cfid){
  return Array.from(scroll.conflict.keys()).indexOf(cfid); }

export const get_val = (exp, def_type='right', encode=false)=>etask(
  function*_get_val()
{
  let m, crypt = Scroll.supported_crypt[0];
  assert(typeof exp=='string', 'invalid get_val '+exp);
  if (exp=='null')
    return null;
  if ('prev_scroll1'==exp)
    return t_prev_scroll.M_hash(0, 1);
  if (/^\d+$/.test(exp))
    return encode ? enc.encode(enc.uint64, +exp) : +exp;
  if (bseq_valid(exp))
    return exp;
  if (m = exp.match(/^0x([0-9a-f]+)$/))
    return s2b(m[1]);
  if (m = exp.match(/^h\((.*)\)$/)){ // h(d10+sig11)
    let a=[], vars = m[1].split('+');
    for (let i=0; i<vars.length; i++)
      a.push(yield get_val(vars[i], def_type, true));
    return Scroll.hconcat_safe(crypt, a);
  }
  if (m = exp.match(/^hleaf\((.*)\)$/)){
    let a=[Scroll.LEAF_TYPE], vars = m[1].split('+');
    for (let i=0; i<vars.length; i++)
      a.push(yield get_val(vars[i], def_type, true));
    return Scroll.hconcat(crypt, a);
  }
  if (m = exp.match(/^hroot\((.*)\)$/)){
    let a=[Scroll.ROOT_TYPE], vars = m[1].split('+');
    for (let i=0; i<vars.length; i++){
      let v = vars[i];
      let r = r_from_str(v.replace(/^([a-zA-Z]+[\d]+\.)?m(.*)$/, '$2'));
      a.push(yield get_val(v, def_type, true));
      a.push(enc_u64(r[0]));
      a.push(enc_u64(r[1]-r[0]+1));
    }
    return Scroll.hconcat(crypt, a);
  }
  if (m = exp.match(/^sign\((.*)\+(.*)\)$/)){ // sign(d10+M9)
    return crypto.sign(crypt, Scroll.hconcat(crypt, [yield get_val(m[1]),
      yield get_val(m[2])], def_type, true), t_keypair.key);
  }
  if (m = exp.match(/^sign\((.*)\)$/)){ // sign(d10)
    return crypto.sign(crypt, crypto.hash(crypt,
      yield get_val(m[1], def_type, true)), t_keypair.key);
  }
  let o = parse_var(exp), {type, seq, cfid} = o;
  if (o.def)
    set_def(def_type, o.ctx);
  if (type=='struct')
    return yield struct_from_str(o.val);
  let name = o.ctx||get_def(def_type||'right'), scroll = get_scroll(name);
  switch (type){
  case 'sig': return scroll.seq_sig(cfid, seq);
  case 'bseq': return scroll.bseq_get(cfid, seq);
  case 'M': return scroll.M_hash(cfid, seq);
  case 'd': return scroll.seq_d(cfid, seq);
  case 'D': return scroll.seq_D(cfid, seq);
  case 'Df': return scroll.seq_D(cfid, seq)[o.i]?.h ?
    {h: scroll.seq_D(cfid, seq)[o.i]?.h} : null;
  case 'DF': return scroll.seq_D(cfid, seq)[o.i]?.sig ||
    scroll.seq_D(cfid, seq)[o.i]?.buf ? scroll.seq_D(cfid, seq)[o.i] : null;
  case 'm': return scroll.m_hash(cfid, o.range);
  case 'db': return yield struct_from_db(scroll, seq);
  case 'mem':
    return yield struct_from_decl(scroll.get_decl(seq, {create: false}));
  case 'array': return yield array_from_str(o.val);
  }
  assert.fail('invalid val exp '+exp);
});

const test_decl = (scroll, data, opt={})=>etask(function*test_decl(){
  yield scroll.decl(opt, data);
  yield xsinon.tick(1, {force: true});
});

const test_start = ()=>etask(function*test_start(){
  t_soul_mode = 'differnt';
  t_soul = {};
  t_soul_id = 0;
  t_scroll = {};
  t_def = {};
  t_state = {};
  t_keypair = {
    pub: s2b('020ece1895f758dded9b436f8ce4a2ae36f394f0ee27349046e84222b8b6e0'+
      '12c8'),
    key: s2b('716b25e25964d9b1072035acc96f1b29d1d9196668ef52c49423e7fecb158b'+
      'e2')
  };
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
  if (t_hooks['start'])
    yield t_hooks['start']();
});

const test_end = ()=>etask(function*test_end(){
  xerr.notice('test_end');
  if (t_hooks['end'])
    yield t_hooks['end']();
  yield xsinon.wait();
  for (let name in t_scroll)
    yield test_run_single('', parse_exp(name+'.#'), 'test_end');
  for (let name in t_scroll){
    let scroll = t_scroll[name];
    if (scroll.storage)
      yield scroll.storage.uninit();
    if (scroll.soul?.db.inited)
      yield scroll.soul.db.uninit({delete: true});
  }
  Scroll.soul.clear();
});

const test_run_cmd_hooks = (curr, o, step)=>etask(
  function*_test_run_single()
{
  for (let i=0; i<test_cmd_hooks.length; i++){
    let cb = test_cmd_hooks[i];
    if (yield cb(curr, o, step))
      return true;
  }
  return false;
});

export function test_register_cmd(cb){ test_cmd_hooks.push(cb); }

const test_run_single = (curr, o, step)=>etask(function*_test_run_single(){
  if (step || step!='')
    xerr.notice('cmd %s %s', step, o.meta.s);
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
  case '#': yield cmd_state_diff(o); break;
  case '##': yield cmd_state_check(o); break;
  case 'def': yield cmd_def(o); break;
  case '=': yield cmd_eq(o); break;
  case '==': yield cmd_test(o); break;
  case 'c': yield cmd_c(o); break;
  case '//': break;
  case 'dbg': debugger; break; // eslint-disable-line no-debugger
  case '.':
  case '..':
  case '...': // XXX: rm from here and move to parser
    assert(o.l, 'invalid "." operator');
    o2 = parse_exp(o.r);
    o2.ctx = o.l;
    o2.prev = o;
    if (o.cmd=='...'){
      set_def('left', o.l);
      set_def('right', o.l);
    } else if (o.cmd=='..')
      set_def('left', o.l);
    yield test_run_single(curr, o2, '');
    break;
  default:
    if (o.cmd[0]=='!'){
      yield cmd_eq({cmd: '=', l: o.meta.s.substr(1), r: 'null',
        meta: {s: o.meta.s}});
    }
    else if (yield test_run_cmd_hooks(curr, o, step));
    else
      assert.fail('invalid cmd "'+o.cmd+'" in '+o.meta.s);
  }
});

function cmd_conf(t){
  let soul;
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
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
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
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

export const new_scroll = (name, M, prev_scroll, sname, db_opt,
  scroll_decl, create_func, open_func)=>etask(function*new_scroll()
{
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
    assert(!scroll_decl, 'cannot modify scroll_decl in clone');
    scroll = yield (open_func||Scroll.open)({soul, key: t_keypair.key,
      pub: t_keypair.pub, M, storage});
  }
  else {
    scroll = yield (create_func||Scroll.create)({soul, key: t_keypair.key,
      pub: t_keypair.pub, prev_scroll, storage},
      {topic: 'test', ...scroll_decl});
  }
  t_scroll[name] = scroll;
  scroll.t = {name};
  return scroll;
});

const cmd_flush = t=>etask(function*cmd_flush(){
  for (let name in t_scroll){
    let scroll = t_scroll[name];
    if (scroll.storage)
      yield scroll.flush();
  }
});

const cmd_scroll = t=>etask(function*cmd_scroll(){
  let prev_scroll = yield t_prev_scroll.M_hash(0, 1), scroll_decl, db_opt;
  let name = t.ctx||get_def('left'), M, a, scroll, d, allow_missing_seq0;
  let index;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!t_scroll[name], 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp), t2;
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
    case 'allow_missing_seq0': allow_missing_seq0 = true; break;
    case 'index': index = test_parse_index(tt.r); break;
    default:
      t2 = parse_exp_arg_pair(curr.exp);
      if (a = t2.l.match(/^M(\d+)$/)){
        let h = yield get_val(t2.r);
        assert(h, 'missing '+t2.r);
        M = +a[1] ? {seq: +a[1], h} : h;
        break;
      }
      assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  if (index)
    scroll_decl = {...scroll_decl, index};
  scroll = yield new_scroll(name, M, prev_scroll, t.prev?.ctx, db_opt,
    scroll_decl, null, null);
  if (allow_missing_seq0)
    scroll.allow_missing_seq0 = allow_missing_seq0;
  if (d!==undefined){
    for (let j=d[0]; j<=d[1]; j++)
      yield test_decl(scroll, ''+j);
  }
});

const cmd_clone = (curr, t)=>etask(function*cmd_clone(){
  let dst = t.ctx||get_def('left'), m, db_opt, allow_missing_seq0;
  assert(!t_scroll[dst], 'scroll already exist '+dst);
  assert(!t.l, 'invalid arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case 'db': db_opt = parse_db_init(tt); break;
    case 'allow_missing_seq0': allow_missing_seq0 = true; break;
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
    db_opt, null, null, null);
  if (allow_missing_seq0)
    s_dst.allow_missing_seq0 = allow_missing_seq0;
  let seq = m[6] ? +m[7] : s_src.top.seq;
  yield s_dst.lock();
  if (Array.from(s_src.conflict.keys()).length>1){
    let db = s_dst.conflict.get(0).db;
    for (let [, co] of s_src.conflict)
      assert(co.top.seq<=seq, 'cannot clone < conflict top '+co.top.seq);
    s_dst.top = null;
    let o = s_src.conflict_to_static();
    yield s_dst.conflict_from_static(o, (_o, _co)=>{
      // s_dst was saved to db during new_scroll, so we need to keep same scfid
      if (_co.cfid==0)
        _co.db = db;
    });
  }
  for (let [seq2, decl] of s_src.dmap){
    if (seq2<=seq)
      yield s_dst.get_decl(seq2).from_static(decl.to_static());
  }
  yield s_dst.unlock();
});

const cmd_decl = t=>etask(function*cmd_decl(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let branch, prev, s, e, data;
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    if (/^{.*}$/.test(curr.exp)){
      assert(!data, 'data already provided');
      data = js_struct_from_str(curr.exp);
      continue;
    }
    let tt = parse_exp_arg(curr.exp), a;
    switch (tt.cmd){
    case 'data':
      assert(!data, 'data already provided');
      a = tt.r.split(' ');
      data = [];
      for (let j=0; j<a.length; j++){
        let sz = assert_kb(a[j]);
        data.push(Buffer.alloc(sz, scroll.conflict.get(0).top.seq+j));
      }
      break;
    case 'branch': branch = tt.r; break;
    case 'prev':
      prev = +tt.r;
      // XXX: need is_positive
      assert(tt.r && Number.isInteger(prev) && prev>=0, 'invalid prev '+tt.r);
      break;
    case '-':
      assert(/^\d+$/.test(tt.l) && /^\d+$/.test(tt.r), 'invalid -: '+t.meta.s);
      [s, e] = [+tt.l, +tt.r];
      break;
    default:
      assert(!data, 'data already provided');
      if (/^\d+$/.test(tt.cmd))
        data = tt.cmd;
      else
        assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  if (s!==undefined){
    assert(!prev && !branch, 'cannot use prev/branch in mutli decl');
    for (let j=s; j<=e; j++)
      yield test_decl(scroll, ''+j);
    return;
  }
  yield test_decl(scroll, data, {prev, branch});
});

function state_split_var(v, def){
  let o = parse_var(v), {type, seq, cfid, index} = o;
  if (o.def)
    set_def('left', o.ctx);
  let name = o.ctx||def||get_def('left');
  if (['db_c', 'db_data', 'mem_c', 'bname'].includes(type))
    return {name, type};
  if (['btc'].includes(type))
    return {name, type, cfid, index};
  if (['db_btc'].includes(type))
    return {name, type, cfid, index};
  if (type=='seq')
    return {name, type, seq, cfid};
  if (type=='bseq')
    return {name, type, seq, cfid};
  assert(['mem', 'db'].includes(type), 'invalid type '+type);
  assert.equal(cfid, '0', 'invalid conflict usage');
  return {name, type, seq};
}

const state_split = (exp, def)=>etask(function*state_split(){
  let o = parse_exp(exp), ret;
  ret = yield t_hooks.state_split?.(o, def);
  if (ret!==undefined)
    return ret;
  switch (o.cmd){
  case '!': return {...state_split_var(o.r, def), val: null};
  case '=':
    if (['db_data'].includes(o.l))
      return {...state_split_var(o.l, def), val: yield get_db_data(o.r)};
    if (/^seq/.test(o.l))
      return {...state_split_var(o.l, def), val: yield t_hooks.get_seq(o.r)};
    if (/^bseq/.test(o.l))
      return {...state_split_var(o.l, def), val: yield get_val(o.r, 'right')};
    if (['db_c', 'mem_c'].includes(o.l))
      return {...state_split_var(o.l, def), val: yield get_static_c(o.r)};
    if (['bname'].includes(o.l))
      return {...state_split_var(o.l, def), val: yield get_static_bname(o.r)};
    if (/^btc/.test(o.l))
      return {...state_split_var(o.l, def), val: yield get_btable(o.r)};
    if (/^db_btc/.test(o.l))
      return {...state_split_var(o.l, def), val: yield get_btable(o.r)};
    return {...state_split_var(o.l, def),
      val: fix_buf(yield get_val(o.r, 'right'))};
  default: assert.fail('invalid state_split '+exp);
  }
});

function state_apply(state, o){
  let {type, seq, cfid, index, val} = o;
  if (t_hooks.state_valid_filter?.(type))
    return t_hooks.state_apply(state, o);
  if (['db_c', 'db_data', 'mem_c', 'bname'].includes(type)){
    if (val)
      state[type] = val;
    else
      delete state[type];
    return;
  }
  if (['btc', 'db_btc'].includes(type)){
    let so;
    if (type=='btc')
      so = state.btable = state.btable||{};
    else if (type=='db_btc')
      so = state.db_btable = state.db_btable||{};
    else
      assert.fail('invalid type '+type);
    if (val){
      let a = so[cfid] = so[cfid]||[];
      while (a.length<=index)
        a.push({});
      if (xutil.equal_deep(a[index], val))
        assert.fail('uneeded '+type+cfid+'['+index+']');
      a[index] = val;
    } else {
      let a = so[cfid] = so[cfid]||[];
      a.splice(index, 1);
      if (!a.length)
        delete so[cfid];
    }
    return;
  }
  if (['seq', 'bseq'].includes(type)){
    if (val!==null && val!==undefined){
      state[type][cfid] = state[type][cfid]||{};
      assert(state[type][cfid][seq] != val,
        'uneeded state_apply '+type+seq+(cfid ? 'c0' : '')+'='+val);
      state[type][cfid][seq] = val;
    } else if (state[type][cfid])
      delete state[type][cfid][seq];
    if (state[type][cfid] && !Object.keys(state[type][cfid]).length)
      delete state[type][cfid];
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
    case 'seq': break;
    case 'bname': break;
    case 'btable': break;
    case 'bseq': break;
    case 'db_btable': break;
    default:
      if (t_hooks.state_valid_filter?.(a[i]))
        break;
      return;
    }
  }
  return a;
}

const state_next = (name, curr_state, filter, steps)=>etask(
  function*state_next()
{
  let scroll = get_scroll(name, true);
  let soul = scroll?.soul;
  let state = {mem: {}, db: {}};
  state.mem = {};
  state.bseq = {};
  state.seq = {};
  // XXX: optimize, get state only if is in filter
  if (scroll){
    // XXX: use decl.next (and clean all over code)
    for (const [seq, decl] of scroll.dmap){
      let o = struct_from_decl(decl);
      if (o)
        state.mem[seq] = o;
    }
    state.mem_c = yield mem_get_c(scroll);
    state.btable = yield mem_get_btable(scroll);
    state.bname = yield mem_get_bname(scroll);
    // XXX: create api with next (like decl) and clean all over
    for (const [cfid] of scroll.conflict){
      for (let decl = scroll.get_decl(0, {create: false}); decl;
        decl = decl.next())
      {
        if (decl.to_c(cfid)!=cfid)
          continue;
        let seq = decl.seq, bseq = decl.bseq_get(cfid, seq);
        if (scroll.test_get_seq){
          state.seq[cfid] = state.seq[cfid]||{};
          state.seq[cfid][seq] = scroll.test_get_seq(cfid, seq);
        }
        if (bseq){
          state.bseq[cfid] = state.bseq[cfid]||{};
          state.bseq[cfid][seq] = bseq;
        } else if (state.bseq[cfid])
          delete state.bseq[cfid][seq];
      }
    }
  }
  let db = soul?.db;
  if (db?.inited){
    state.db = yield db_get_scroll_decl(scroll.soul.db, scroll);
    state.db_c = yield db_get_c(scroll.soul.db, scroll.name);
    state.db_data = yield db_get_db_data(scroll.soul.db);
    state.db_btable = yield db_get_btable(scroll);
  } else {
    state.db = {};
    state.db_c = {};
    state.db_data = {};
  }
  state = fix_buf(state);
  if (!curr_state[name]){
    assert(!steps, 'first # must be empty or list of types');
    curr_state[name] = state;
    return;
  }
  t_hooks.state_curr?.(filter, state, scroll);
  for (let curr=steps; curr = parse_get_next(curr);)
    state_apply(curr_state[name], yield state_split(curr.exp, name));
  if (filter.includes('mem_c')){
    assert_b2s_obj(state.mem_c, curr_state[name].mem_c,
      'mem conflict state mismach '+steps);
  }
  if (filter.includes('mem')){
    assert_b2s_obj(state.mem, curr_state[name].mem,
      'mem state mismach '+steps);
  }
  if (filter.includes('seq')){
    assert_b2s_obj(state.seq, curr_state[name].seq,
      'seq state mismach '+steps);
  }
  if (filter.includes('db_c')){
    assert_b2s_obj(state.db_c, curr_state[name].db_c,
      'db conflict state mismach '+steps);
  }
  if (filter.includes('db'))
    assert_b2s_obj(state.db, curr_state[name].db, 'db state mismach '+steps);
  if (filter.includes('db_data')){
    assert_b2s_obj(state.db_data, curr_state[name].db_data,
      'db_data state mismach '+steps);
  }
  if (filter.includes('btable')){
    assert_b2s_obj(state.btable, curr_state[name].btable,
      'btable state mismach '+steps);
  }
  if (filter.includes('bseq')){
    assert_b2s_obj(state.bseq, curr_state[name].bseq,
      'bseq state mismach '+steps);
  }
  if (filter.includes('bname')){
    assert_b2s_obj(state.bname, curr_state[name].bname,
      'bname state mismach '+steps);
  }
  if (filter.includes('db_btable')){
    assert_b2s_obj(state.db_btable, curr_state[name].db_btable,
      'db_btable state mismach '+steps);
  }
  if (t_hooks.state_assert)
    t_hooks.state_assert(filter, state, curr_state[name]);
  curr_state[name] = state;
});

const cmd_state_diff = t=>etask(function*cmd_state_diff(){
  let name = t.ctx||get_def('left'), steps = '', filter;
  if (get_filter(t.r))
    filter = get_filter(t.r);
  else if (!t_state[name]){
    assert(!t.r, 'first # must be empty or list of types');
    filter = ['db', 'db_data', 'db_c', 'mem', 'mem_c'];
  } else {
    steps = t.r;
    filter = t_state[name].filter;
    assert(filter, 'missing filter');
  }
  yield state_next(name, t_state, filter, steps);
  t_state[name].filter = filter;
});

const cmd_state_check = t=>etask(function*cmd_state_check(){
  let name = t.ctx||get_def('left'), steps = '';
  let o = parse_exp(t.r), filter = [o.l];
  steps = t_hooks.state_get_steps?.(filter, name, o.r)||o.r;
  let curr_state = {};
  curr_state[name] = {};
  yield state_next(name, curr_state, filter, steps);
});

function cmd_tput(curr, t){
  let dst = t.ctx||get_def('left'), src = get_def('right');
  parse_push(curr, tjoin(dst, 'put', macro_to_m(t.r, src)));
}

const cmd_put = (curr, t)=>etask(function*cmd_put(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let diff = {}, err='';
  for (let curr=t.r; curr = parse_get_next(curr);){
    let t2 = parse_exp_arg_pair(curr.exp);
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

const cmd_unload = (curr, t)=>etask(function cmd_unload(){
  assert(t.ctx=='mem', 'missing mem prefix');
  let name = t.prev?.ctx||get_def('left'), scroll = get_scroll(name);
  for (let curr=t.r; curr = parse_get_next(curr);)
    assert(!curr.exp, 'invalid arg '+curr.exp);
  scroll.unload();
});

const cmd_load_c = t=>etask(function*cmd_load_c(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name), o, data;
  for (let curr=t.r; curr = parse_get_next(curr);){
    switch (curr.exp)
    {
    case 'data': data = true; break;
    default: o = parse_cfid_seq(curr.exp);
    }
  }
  let decl = scroll.get_decl(o.seq);
  yield decl.load(o.cfid, data && {data: true});
});

const cmd_test = t=>etask(function*cmd_test(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let tested = {};
  for (let curr=t.r; curr = parse_get_next(curr);){
    let t2 = parse_exp_arg_pair(curr.exp);
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
      let decl = scroll.get_decl(seq, {create: false});
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
          assert(!decl || !decl.fbuf_get(cfid).h, 'd'+seq+'c'+cfid+
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

export function parse_cfid_seq(s){
  let m = s.match(/^(\d+)(([c])(\d+))?$/);
  assert(m, 'invalid cfid_seq');
  let seq = +m[1];
  let cfid = +m[4]||0;
  return {seq, cfid};
}

export function parse_conflict(s){
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
  for (let curr=t.r; curr = parse_get_next(curr); i++)
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

const get_db_data = exp=>etask(function*get_db_data(){
  let m;
  if (m = exp.match(/^\{(.*)\}$/))
    exp = m[1];
  let o = {};
  for (let curr=exp; curr = parse_get_next(curr);){
    let val = yield get_val(curr.exp);
    assert(val?.buf && val?.h, 'invalid static db data');
    o[b2s(val.h)] = b2s(val.buf);
  }
  return o;
});

const db_get_db_data = db=>etask(function*db_get_db_data(){
  let ret = {}, tx = db.transaction('data', 'readonly');
  for (let cur=yield db.cursor(tx.store('data')); cur; cur = yield cur.next()){
    assert.equal(cur.key, b2s(cur.value.h));
    ret[cur.key] = b2s(Buffer.from(cur.value.buf));
  }
  return ret;
});

const get_static_c = s=>etask(function*get_static_c(){
  s = rm_parentesis(s, '{');
  let ret = {};
  for (let curr=s; curr = parse_get_next(curr);){
    let m = curr.exp.match(/^(\d+):(.*)$/);
    assert(m?.length==3, 'invalid db_c '+curr.exp);
    ret[m[1]] = parse_conflict(m[2]);
    ret[m[1]].top.M = b2s(yield get_val(ret[m[1]].top.M));
  }
  return ret;
});

const get_static_bname = s=>etask(function*get_static_bname(){
  s = rm_parentesis(s, '{');
  let ret = {};
  for (let curr=s; curr = parse_get_next(curr);){
    let m = curr.exp.match(/^(\d+):([^:]+):(\d+)$/);
    assert(m?.length==4, 'invalid bname '+s);
    let cfid = +m[1], name = m[2], seq = +m[3];
    ret[cfid] = ret[cfid]||{};
    ret[cfid][name] = seq;
  }
  return ret;
});

const get_btable = s=>etask(function*get_btable(){
  let bo = {};
  s = rm_parentesis(s, '{');
  for (let curr=s; curr = parse_get_next(curr);){
    let o = parse_exp(curr.exp);
    // XXX yield get_val(o.r);
    bo[o.l] = o.r=='null' ? null : o.l=='seq' ? +o.r : o.r;
  }
  return bo;
});

const db_get_scroll_decl = (db, scroll)=>etask(function*db_get_scroll_decl(){
  let db_c = yield db_get_c(db, scroll.name), ret={};
  let tx = db.transaction('decl', 'readonly');
  for (let scfid in db_c){
    scfid = +scfid;
    let cfid = db_c[scfid].cfid;
    let index = tx.store('decl').index('scfid');
    for (let cursor=yield db.cursor(index, db.only(scfid)); cursor;
      cursor = yield cursor.next())
    {
      let o = db.fix_struct(cursor.value);
      assert.equal(o.scfid, scfid, 'missing scfid seq'+o.seq);
      delete o.scfid;
      ret[o.seq] = ret[o.seq]||{};
      ret[o.seq][cfid] = o;
    }
  }
  let scfids = {}, store = tx.store('decl');
  for (let cursor=yield db.cursor(store); cursor; cursor = yield cursor.next())
    scfids[cursor.value.scfid] = true;
  for (let scfid in scfids)
    assert(yield db.db_get('scroll', +scfid), 'scfid '+scfid+' not found');
  return ret;
});

const db_get_c = (db, M)=>etask(function*db_get_c(){
  assert(M, 'missing M');
  let tx = db.transaction('scroll', 'readonly'), ret;
  let index = tx.index('scroll', 'scroll');
  for (let cursor=yield db.cursor(index, db.only(b2s(M))); cursor;
    cursor = yield cursor.next())
  {
    let o = db.fix_struct(cursor.value);
    ret = ret||{};
    ret[o.scfid] = {cfid: o.cfid, top: {seq: o.top.seq, M: s2b(o.top.M)}};
    // XXX: need assert to check rest of split array is correct
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

const mem_get_btable = scroll=>etask(function mem_get_btable(){
  let ret;
  for (const [cfid] of scroll.conflict){
    ret = ret||{};
    let btable = scroll.get_branch_table(cfid);
    ret[cfid] = btable.to_static();
    if (!ret[cfid].length)
      delete ret[cfid];
  }
  return ret;
});

const mem_get_bname = scroll=>etask(function mem_get_bname(){
  let ret;
  for (const [cfid] of scroll.conflict){
    let btable = scroll.get_branch_table(cfid);
    for (const [name, bo] of btable.branch_name){
      ret = ret||{};
      ret[cfid] = ret[cfid]||{};
      ret[cfid][name] = bo.seq;
    }
  }
  return ret;
});

const db_get_btable = scroll=>etask(function*db_get_btable(){
  if (!scroll.storage)
    return;
  let db = scroll.soul.db, tx = db.transaction('branch', 'readonly'), ret;
  let index = tx.index('branch', 'scfid'); // XXX: order by seq
  for (const [, co] of scroll.conflict){
    for (let cursor=yield db.cursor(index, db.only(co.db.data.scfid)); cursor;
      cursor = yield cursor.next())
    {
      let {scfid, cfid} = cursor.value;
      assert.equal(scfid, co.db.data.scfid, 'scfid mismatch');
      ret = ret||{};
      ret[cfid] = ret[cfid]||[];
      let o = {...cursor.value};
      delete o.cfid;
      delete o.scfid;
      ret[cfid].push(o);
    }
  }
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
    let t2 = parse_exp_arg_pair(o.r);
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

export const test_run = test=>etask(function*test_run(){
  yield test_start();
  for (let curr=test, i=0; curr = parse_get_next(curr); i++){
    let o = parse_exp(curr.exp);
    yield test_run_single(curr, o, i);
  }
  yield test_end();
});

