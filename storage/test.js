'use strict'; /*jslint node:true*/ /*global describe,it,beforeEach,afterEach*/
// XXX: need jslint mocha: true
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';
import enc from 'compact-encoding';
import tparser from './test_parser.js';
import xtest from '../util/test_lib.js'; // eslint-disable-line no-unused-vars
import etask from '../util/etask.js';
import crypto from '../util/crypto.js';
import string from '../util/string.js';
import xsinon from '../util/sinon.js';
import Scroll from './scroll.js';
import buf_util from '../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;
const {range_str, range_from_str} = Scroll;
function enc_u64(v){ return enc.encode(enc.uint64, v); }

let t_scroll, t_genesis_scroll, t_prev_scroll, t_keypair, t_def;

// XXX: make it automatic for all node/browser in proc.js
// XXX: check if to enable xerr.set_exception_catch_all(true);
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

// XXX: need test
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
      s = space(s)+(i==a.length-1 ? d+'.sig'+n+' '+d+'.d'+n : d+'.m'+n);
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

function parse_var(v){
  let m = v.match(/^([a-zA-Z]\d*)(\.|\.\.)([^.]*)$/);
  let ctx = m ? m[1] : '', def = m ? m[2]=='..' : false;
  v = m ? m[3] : v;
  m = v.match(/^(sig|m|M|d|D)((\d+)|((\d+)_(\d+)))$/);
  m = v.match(/^(sig|m|M|d|D)((\d+)|((\d+)_(\d+)))(b(\d+))?$/);
  assert.equal(m?.length, 9, 'invalid var '+v);
  let type = m[1], range = Scroll.range_from_str(m[2]), seq = range[1];
  let b = m[8] ? +m[8] : 0;
  assert(type=='m' || range[0]==range[1], 'invalid range '+v);
  return {seq, type, range, b, ctx, def};
}

function get_scroll(name){
  let scroll = t_scroll[name];
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

function assert_buffer(a, b, desc){
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b))
    assert.equal(b2s(a), b2s(b), 'buffer not equal '+desc);
  else if (a || b)
    assert.deepEqual(a, b, 'not equal '+desc);
  else
    assert.equal(a, b, 'not equal '+desc);
}

function assert_no_corruption(scroll){
  for (const [i] of scroll.branch){
    let curr = scroll.branch.get(i);
    if (!i)
      continue;
    assert.equal(scroll.branch.get(curr.parent.b).branches.get(curr.b), curr,
      'branch corruption b'+i);
    for (const [j] of curr.branches)
      assert.equal(scroll.branch.get(j).parent.b, i, 'branch corruption b'+i);
  }
}

const calc_m = (scroll, range)=>etask(function*calc_m(){
  let [s, e] = range;
  assert(Number.isInteger(Math.log2(e-s+1)), 'invalid merkel range '+
  range_str(range));
  let q = [];
  assert(e<scroll.branch.get(0).top.seq+1, 'scroll too small '+
    e+'<'+scroll.branch.get(0).top.seq+1);
  for (let i=s; i<=e; i++)
    q.push({s: i, e: i, m: yield scroll.m_hash(i)});
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
  let scroll_m = yield scroll.m_hash([s, e]);
  let test_m = q[0].m;
  if (scroll_m && test_m)
    assert.equal(b2s(scroll_m), b2s(test_m));
  return scroll_m||test_m;
});

function b_pos2id(scroll, pos){ return Array.from(scroll.branch.keys())[pos]; }
function b_id2pos(scroll, bid){
  return Array.from(scroll.branch.keys()).indexOf(bid); }

const get_val = (exp, def_type='right')=>etask(function*_get_val(){
  let m;
  assert(typeof exp=='string', 'invalid get_val '+exp);
  if (exp=='null')
    return null;
  if ('prev_scroll1'==exp)
    return t_prev_scroll.M_hash(1);
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
      let r = Scroll.range_from_str(
        v.replace(/^([a-zA-Z]+[\d]+\.)?m(.*)$/, '$2'));
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
  let o = parse_var(exp), {type, seq, b} = o, r0 = o.range[0];
  if (o.def)
    set_def(def_type, o.ctx);
  let name = o.ctx||get_def(def_type||'right'), scroll = get_scroll(name);
  if (b)
    b = b_pos2id(scroll, b);
  switch (type){
  case 'sig': return scroll.seq_sig(seq, {b});
  case 'M': return scroll.M_hash(seq, {b});
  case 'd': return scroll.seq_d(seq, {b});
  case 'D': return scroll.seq_D(seq, {b});
  // XXX: do we need calc_m?
  case 'm': return r0==seq ? scroll.m_hash(seq, {b}) :
    b ? scroll.m_hash(o.range, {b}) : calc_m(scroll, o.range);
    // b ? scroll.m_hash(seq, {b}) : calc_m(scroll, o.range);
  }
  assert.fail('invalid val exp '+exp);
});

const test_decl = (scroll, data)=>etask(function*test_decl(){
  yield scroll.decl(data);
  yield xsinon.tick(1);
});

const test_start = ()=>etask(function*test_start(){
  t_scroll = {};
  t_def = {};
  t_keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef75'+
    'ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
      'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  xsinon.clock_set({now: 0});
  t_genesis_scroll = yield Scroll.create({key: t_keypair.key,
    pub: t_keypair.pub}, {topic: 'genesis'});
  yield t_genesis_scroll.decl('1');
  t_prev_scroll = yield Scroll.create({key: t_keypair.key,
    pub: t_keypair.pub, prev_scroll: yield t_genesis_scroll.M_hash(1)},
    {topic: 'prev_scroll'});
  yield t_prev_scroll.decl('1');
});

function test_end(){
}

describe('test_util', ()=>{
  it('parse_var', ()=>{
    const t = (v, exp)=>{
      let a = exp.split(' '), range = Scroll.range_from_str(a[1]);
      let b = a[2] ? +a[2] : 0, ctx = a[3]||'', def = a[4]=='def'||false;
      let exp2 = {type: a[0], seq: range[1], range, b, ctx, def};
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
    t('d0b10', 'd 0 10');
    t('D0b10', 'D 0 10');
    t('m0b10', 'm 0 10');
    t('M0b10', 'M 0 10');
    t('sig0b10', 'sig 0 10');
    t('m0_1b10', 'm 0_1 10');
    t('s2.d0', 'd 0 0 s2');
    t('s2.m0_1b10', 'm 0_1 10 s2');
    t('s2..d0', 'd 0 0 s2 def');
    t('s2..m0_1b10', 'm 0_1 10 s2 def');
  });
  it('parse_branch', ()=>{
    const t = (val, exp)=>assert.deepEqual(parse_branch(val), exp);
    t('M9=s.M9', {top: {seq: 9, M: 's.M9'}});
    t('3.M9=s.M9', {top: {seq: 9, M: 's.M9'}, b: {seq: 3, b: 0, type: 'v'}});
    t('3b1.M9=s.M9', {top: {seq: 9, M: 's.M9'}, b: {seq: 3, b: 1, type: 'b'}});
    t('3v1.M9=s.M9', {top: {seq: 9, M: 's.M9'}, b: {seq: 3, b: 1, type: 'v'}});
    t('M9', {top: {seq: 9, M: 'M9'}});
    t('3.M9', {top: {seq: 9, M: 'M9'}, b: {seq: 3, b: 0, type: 'v'}});
    t('3b1.M9', {top: {seq: 9, M: 'M9'}, b: {seq: 3, b: 1, type: 'b'}});
    t('3v1.M9', {top: {seq: 9, M: 'M9'}, b: {seq: 3, b: 1, type: 'v'}});
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

const cmd_scroll = t=>etask(function*cmd_scroll(){
  let prev_scroll = yield t_prev_scroll.M_hash(1);
  let name = t.ctx||get_def('left'), M, a, scroll;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!t_scroll[name], 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp), t2;
    switch (tt.cmd){
    case '!':
      if ('prev_scroll'==tt.r)
        prev_scroll = null;
      else
        assert.fail('invalid arg '+t.meta.s);
      break;
    default:
      t2 = tparser.parse_exp_arg_pair(curr.exp);
      if (a = t2.l.match(/^M(\d+)$/)){
        M = {seq: +a[1], h: yield get_val(t2.r)};
        break;
      }
      assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  if (M)
   scroll = yield Scroll.open({key: t_keypair.key, pub: t_keypair.pub, M});
  else {
    scroll = yield Scroll.create({key: t_keypair.key, pub: t_keypair.pub,
        prev_scroll}, {topic: 'test'});
  }
  t_scroll[name] = scroll;
  scroll.t = {name};
});

const cmd_clone = (curr, t)=>etask(function cmd_clone(){
  let dst = t.ctx;
  assert(!t_scroll[dst], 'scroll already exist '+dst);
  assert(!t.l, 'invalid arg '+t.meta.s);
  let m = t.r.match(/^([a-z0-9_]+)((\.)|(\.\.))0_(\d+)$/);
  assert(m, 'invalid clone '+t.meta.s);
  let src = m[1], seq = +m[5];
  if (m[2]=='..')
    set_def('right', src);
  let s = dst+'.scroll(M0:'+src+'.M0)';
  for (let i=0; i<=seq; i++)
    s += ' '+dst+'.put(sig'+i+':'+src+'.sig'+i+' D'+i+':'+src+'.D'+i+')';
  tparser.parse_push(curr, s);
});

const cmd_decl = t=>etask(function*cmd_decl(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let m=curr.exp.match(/^(\d+)-(\d+)$/);
    if (m){
      for (let j=+m[1]; j<=+m[2]; j++)
        yield test_decl(scroll, ''+j);
    } else
      yield test_decl(scroll, curr.exp);
  }
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
  let ret = scroll.put(diff);
  assert.deepEqual(Object.keys(ret.errors), err ?
    string.split_trim(err, /,\s*/) : []);
  assert_no_corruption(scroll);
});

const cmd_test = t=>etask(function*cmd_test(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let tested = {};
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg_pair(curr.exp);
    let l=name+'.'+t2.l, r=t2.r, o=parse_var(t2.l), b=o.b;
    tested[b] = tested[b]||{};
    tested[b][o.seq] = tested[b][o.seq]||{M: false, sig: false, d: false,
      m: {}};
    if (o.type=='m')
      tested[b][o.seq].m[o.range[0]] = true;
    else
      tested[b][o.seq][o.type] = true;
    let val = yield get_val(l);
    let exp = yield get_val(r);
    assert_buffer(val, exp, curr.exp);
  }
  for (const [b] of scroll.branch){
    for (let seq=0; seq<=scroll.branch.get(b).top.seq; seq++){
      seq = +seq;
      let decl = yield scroll.get_decl(seq); // XXX {create: false}
      ['sig', 'd', 'M', 'm'].forEach(type=>{
        if (type=='m'){
          let a = Scroll.merkel_ranges(seq);
          for (let i=0; i<a.length; i++){
            let s = a[i][0];
            if (tested[b] && tested[b][seq]?.m[s])
              continue;
            assert(!decl.m_get([s, seq]).h, 'm'+range_str([s, seq])+'b'+b+
              ' exists '+t.meta.s);
          }
          return;
        }
        if (tested[b] && tested[b][seq] && tested[b][seq][type])
          return;
        switch (type){
        case 'sig':
          assert(!decl.sig_get(0), 'sig'+seq+'b'+b+' exists '+t.meta.s);
          break;
        case 'd':
          assert(!decl.fbuf_get(b).h, 'd'+seq+'b'+b+' exists '+t.meta.s);
          break;
        case 'M':
          if (0) // XXX: enable
          assert(!decl.M.h, 'M'+seq+'b'+b+' exists '+t.meta.s);
          break;
        default: assert.fail('invalid type '+type+'b'+b);
        }
      });
    }
  }
});

function parse_branch(s){
  let m = s.match(/^([^=]+)=([^=]+)$/);
  let l= m ? m[1] : s, r = m&&m[2];
  m = l.match(/^((\d+)(([b|v])(\d+))?\.)?M(\d+)$/);
  assert(m, 'invalid branch '+s);
  r = r||'M'+m[6];
  let top = {seq: +m[6], M: r};
  let b = m[2] ? {seq: +m[2], b: +m[5]||0, type: m[4]||'v'} : undefined;
  return b ? {top, b} : {top};
}

// XXX: rm
const cmd_b = t=>etask(function*cmd_b(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let tested = {}, i=0;
  for (let curr=t.r; curr = tparser.parse_get_next(curr); i++)
    tested[i] = parse_branch(curr.exp);
  assert.equal(scroll.branch.size, i, 'branch count mismatch '+t.r);
  for (const [i, o] of scroll.branch){
    let ii = b_id2pos(scroll, i);
    assert.deepEqual(o.parent.b!==undefined ?
      {seq: o.parent.seq, b: b_id2pos(scroll, o.parent.b),
      type: o.parent.type} :
      undefined, tested[ii].b, 'branch '+i+' mismatch '+t.r);
    assert.equal(o.top.seq, tested[ii].top.seq, 'top seq mismatch b'+i+
      ' '+t.r);
    assert_buffer(o.top.M, yield get_val(tested[ii].top.M),
      'top M mismatch b'+i+' '+t.r);
  }
  assert_no_corruption(scroll);
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
  assert_buffer(l, r, o.meta.s);
});

const test_run_single = (curr, o)=>etask(function*_test_run_single(){
  let o2;
  switch (o.cmd){
  case 'scroll': yield cmd_scroll(o); break;
  case 'clone': yield cmd_clone(curr, o); break;
  case 'decl': yield cmd_decl(o); break;
  case 'put': yield cmd_put(curr, o); break;
  case 'tput': yield cmd_tput(curr, o); break;
  case '=': yield cmd_eq(o); break;
  case '==': yield cmd_test(o); break;
  case 'b': yield cmd_b(o); break;
  case '//': break;
  case 'dbg': debugger; break; // eslint-disable-line no-debugger
  case '.':
  case '..':
  case '...': // XXX: rm from here
    assert(o.l, 'invalid "." operator');
    o2 = tparser.parse_exp(o.r);
    o2.ctx = o.l;
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
    it('range_from_str', ()=>{
      const t = (val, exp)=>assert.deepEqual(Scroll.range_from_str(val), exp);
      t('1', [1, 1]);
      t('10', [10, 10]);
      t('10_100', [10, 100]);
    });
    it('calc_roots', ()=>{
      const t = (seq, exp)=>{
        let roots = Scroll.calc_roots(seq+1);
        let a = [];
        roots.forEach(r=>a.push(Scroll.range_str(r)));
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
        ret.all.forEach(r=>a.push(Scroll.range_str(r)));
        assert.equal(a.join(' '), exp_all, 'all mismatch seq '+seq);
        a = [];
        ret.any.forEach(r=>a.push(Scroll.range_str(r)));
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
    it('range_to_parent', ()=>{
      const t = (val, exp)=>{
        let _val = range_from_str(val), e = range_from_str(exp);
        let res = Scroll.range_to_parent(_val);
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
  describe('macro', ()=>{
    it('to_m', ()=>{
      const t = (val, exp)=>assert.equal(macro_to_m(val, 's'), exp);
      t('0', 's.sig0 s.d0');
      t('0 1', 's.m0 s.sig1 s.d1');
      t('0_1', 's.m0_1');
      t('0_1 2', 's.m0_1 s.sig2 s.d2');
      t('0_1_2_3 4_5 6', 's.m0_3 s.m4_5 s.sig6 s.d6');
      t('0_1 2        ', 's.m0_1 s.sig2 s.d2');
      t('a', 's1.sig0 s1.d0');
      t('a b', 's1.m0 s1.sig1 s1.d1');
      t('a_b', 's1.m0_1');
      t('a_b c', 's1.m0_1 s1.sig2 s1.d2');
      t('a_b_c_d e_f g', 's1.m0_3 s1.m4_5 s1.sig6 s1.d6');
      t('A', 's2.sig0 s2.d0');
      t('A B', 's2.m0 s2.sig1 s2.d1');
      t('A_B', 's2.m0_1');
      t('A_B C', 's2.m0_1 s2.sig2 s2.d2');
      t('A_B_C_D E_F G', 's2.m0_3 s2.m4_5 s2.sig6 s2.d6');
      t('0 b', 's.m0 s1.sig1 s1.d1');
      t('0 B', 's.m0 s2.sig1 s2.d1');
      t('a B', 's1.m0 s2.sig1 s2.d1');
    });
  });
  describe('decl', ()=>{
    const t = (name, test)=>it(name, ()=>test_run(test));
    let sig0='0x9d73f19857885309cb311a8ec7d635ca2898da1b1fb8e31e9b7e01bbbc6de'+
      '68a5b9d756ff02462a3b2f8900e46a496ace5d3acb4f3e73180be515e936009e70c';
    t('no_prev_scroll', `s...scroll(!prev_scroll) decl(1) sig0=${sig0}
      d0=0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
      m0=0xa0d3dfd96822872daa1351808936ebce919fd82f3af2a14abbac987446d48017
      m0=hleaf(d0+sig0) sig0=sign(d0) M0=hroot(m0)
      m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
    sig0 = '0xb34dd640e4fb8f08593c91840b1175d1014a96a9e211b5f790a3639809135a3'+
      'c26a4f98b3c7798566d7241e4f7a9e97d99b2d7e075ec1e1f4e71a28e3c0dba0c';
    t('with_prev_scroll', `s...scroll decl(1) sig0=${sig0}
      d0=0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
      m0=0x0d7b0519668a3c03ba5b206d8dd92846fdb00b282d35d4b5c0a29bd230489eee
      m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0)
      m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
    t('merkel', `s...scroll decl(1-32)
      m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0) M0=h(2+m0+0+1)
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
    describe('put', ()=>{
      describe('errors_invalid', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M0) ==M0`;
        t('sig0', `${s} s.put(sig0:sig1 err(invalid sig0)) ==M0`);
        t('d0', `${s} s.put(d0:d1 err(invalid d0)) ==M0`);
        t('m0', `${s} s.put(m0:m1 err(invalid m0)) ==M0`);
        t('sig0 d0 m0', `${s} s.put(sig0:sig1 d0:d1 m0:d1
          err(invalid sig0,invalid d0,invalid m0)) ==M0`);
        t('sig1', `${s} s.put(sig1:sig0 err(invalid sig1)) ==M0`);
      });
      describe('errors_missing', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M0) ==M0`;
        t('sig0', `${s} put(sig0 err(missing d0)) ==M0`);
        t('d0', `${s} put(d0 err(missing sig0)) ==M0`);
      });
      describe('top_M0', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M0) ==M0`;
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
        // XXX add errors/missing to below tests
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
        t('seq9_no_branch', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0 sig3
          d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          put(sig9 d9) =M9 put(sig4 d4 m5 m4_5 m6_7) =M4
          put(sig5 d5) =M5 s2.put(sig6 d6 m7) =M6 put(sig7 d7)
          =M7 put(sig10 d10) =M10`);
        t('seq9_branch', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0 sig3 d3
          m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          decl(9) M9=hroot(m0_7+s2.m8_9) // branch
          put(sig9 d9 err(invalid sig9,invalid d9))
          M9=hroot(m0_7+s2.m8_9)
          put(sig4 d4 m5 m4_5 m6_7) =M4 s2.put(sig5 d5) =M5
          put(sig6 d6 m7) =M6 put(sig7 d7) =M7
          put(sig10 d10 err(invalid sig10)) !M10`);
        t('seq9_no_branch_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10) =M9 =M4 =M5 =M6 =M7 =M10`);
        t('seq9_branch_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          decl(9) M9=hroot(s2.m0_7+s2.m8_9) // branch
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10 err(invalid sig10, invalid sig9,invalid d9))
          M9=hroot(s2.m0_7+s2.m8_9) =M4 =M5 =M6 s2.M7=M7 !M10`);
      });
      describe('top_M1', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M1) ==M1`;
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
        // XXX: ^m0_1 is redundant
        t('m0m1m0_1', `${s} put(m0 m1 m0_1) ==(M0 m0 M1 m1 m0_1)`);
        t('m0_sig1d1', `${s} put(m0 sig1 d1) ==(sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m1_sig0d0', `${s} put(sig0 d0 m1) ==(sig0 d0 M0 m0 M1 m1 m0_1)`);
        // XXX add test for d0sig0_d1_sig1
        // XXX: add sig/d tests
      });
      describe('top_M2', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M2) ==M2`;
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
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M3) ==M3`;
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
        t('m0_1m2m3_seq4_no_branch', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) put(sig4 d4)
          ==(sig4 d4 M3 m2 m3 m0_1 m2_3 m0_3 m4) put(sig0 d0 m1) =M0`);
        t('m0_1m2m3_seq4_branch', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // branch
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
        t('M4_a', `s..scroll(!prev_scroll) decl(1-32) t..clone(s..0_1)
          put(m2_3 sig4 d4) =m2_3 =M4 put(m2 m3 sig4 d4) =m2 =m3`);
        t('M4_b', `s..scroll(!prev_scroll) decl(1-32) t..clone(s..0_1)
          put(m2_3 sig4 d4) =m2_3 =M4 put(m2 m3) =m2 =m3`);
        t('M8_a', `s..scroll(!prev_scroll) decl(1-32) t..clone(s..0_3)
          put(m0_3 m4_7 sig8 d8) put(m0_3 m4 m5 m6_7 sig8 d8) =m4 =m5`);
        t('M8_b', `s..scroll(!prev_scroll) decl(1-32) t..clone(s..0_3)
          put(m0_3 m4_7 sig8 d8)
          put(m0_3 m4_5:m6_7 m6_7 sig8 d8) !m4_5 !m6_7
          put(m0_3 m4_5 m6_7 sig8 d8) =m4_5 =m6_7
          put(m0_3 m4 m5 m6_7) =m4 =m5 =m4_5`);
      });
      describe('branch', ()=>{
        // XXX: need tests with prev_scroll
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2..scroll(s..M3) ==M3`;
        t('xxx_rename1', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // branch
          put(sig4 d4 m4 m0_1 m2 m3) b(M4=s2.M4 3b0.M4)
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) s2.d4 M3 m2 m3 m0_1
          m2_3 m0_3 sig4b1:sig4 d4b1:d4 m3b1:m3 m2_3b1:s.m2_3 m0_3b1:s.m0_3
          m0_1b1:s.m0_1
          m2b1:s.m2 m4b1:s.m4)
          put(sig3 d3)
          sig3=sig3
          d3=d3
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) s2.d4 M3 m2 m3 m0_1
          m2_3 m0_3 sig4b1:sig4 d4b1:d4 m3b1:m3 m2_3b1:s.m2_3 m0_3b1:s.m0_3
          sig3 d3
          sig3b1:s.sig3
          d3b1:s.d3
          m0_1b1:s.m0_1
          m2b1:s.m2 m4b1:s.m4)
        `);
        t('xxx_rename2', `s.scroll(!prev_scroll) s.decl(1-32)
          s2..scroll(s..M3) put(M0 m0 m1 m2 m3) decl(4-7)
          s3..scroll(s2..M0)
          // XXX: test s3.put(sig7:s2..sig7 d7 m0 m1 m2_m3 m4_5 m6 sig6 d6)
          s3.put(sig7:s2..sig7 d7 m0 m1 m2 m3 m4_5 m6 sig6 d6)
          =sig7
          // XXX why
          s3.put(sig7:s..sig7 d7 m0 m1 m2 m3 m4_5 m6 sig6 d6)
          b(M7=s2.M7 3b0.M7)
          m0b1=s.m0
          m3b1=s.m3
          m4_5b1=s.m4_5
          sig7b0=s2.sig7
          sig7b1=s.sig7
        `);
        let p = '';
        t('1b0', `s.scroll(!prev_scroll) s.decl(1-32) s1.clone(s.0_1)
          s1.decl(2-32) t..clone(s.0_32) put(m0:s1..m0 m1 sig2 d2)
          sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2
          b(M32=s.M32 1b0.M2=s1.M2)`);
         t('1b0_missing_m', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_1) s1.decl(2-32) t..clone(s.0_32)
          put(sig0:s1..sig0 d0 sig1 d1 sig2 d2)
          sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2
          b(M32=s.M32 1b0.M2=s1.M2)`);
         t('1b0_missing_d', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_1) s1.decl(2-32) t..clone(s.0_32)
          put(sig0:s1..sig0 D0 sig1 D1 sig2 D2)
          sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2
          b(M32=s.M32 1b0.M2=s1.M2)`);
        t('1b0_1b0_1b0', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_1) s1.decl(2-32)
          s2.clone(s.0_1) s2.decl(3-32)
          s3.clone(s.0_1) s3.decl(4-32)
          t..clone(s.0_32)
          put(m0:s1..m0 m1 sig2 d2)
          ${p=`sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2`}
          b(M32=s.M32 1b0.M2=s1.M2)
          put(m0:s2..m0 m1 sig2 d2)
          ${p+=` sig2b2=s2.sig2`} b(M32=s.M32 1b0.M2=s1.M2 1b0.M2=s2.M2)
          put(m0:s3..m0 m1 sig2 d2) ${p+=` sig2b3=s3.sig2`}
          b(M32=s.M32 1b0.M2=s1.M2 1b0.M2=s2.M2 1b0.M2=s3.M2)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3b1=s1.sig3`}
          b(M32=s.M32 1b0.M3=s1.M3 1b0.M2=s2.M2 1b0.M2=s3.M2)
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+= ` sig3b2=s2.sig3`}
          b(M32=s.M32 1b0.M3=s1.M3 1b0.M3=s2.M3 1b0.M2=s3.M2)
          put(m0:s3..m0 m1 m2 sig3 d3) ${p+= ` sig3b3=s3.sig3`}
          b(M32=s.M32 1b0.M3=s1.M3 1b0.M3=s2.M3 1b0.M3=s3.M3)
        `);
        t('1b0_2b0', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_1) s1.decl(2-32)
          s2.clone(s.0_2) s2.decl(3-32)
          t..clone(s.0_32) ${p=`sig1b0=s.sig1 sig2b0=s.sig2`}
          put(m0:s1..m0 m1 sig2 d2) sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2
          b(M32=s.M32 1b0.M2=s1.M2)
          put(m0:s2..m0 m1 m2 sig2 d2)
          sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2
          b(M32=s.M32 1b0.M2=s1.M2)
          put(m0:s1..m0 m1 m2 sig3 d3)
          sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2 sig3b1=s1.sig3
          b(M32=s.M32 1b0.M3=s1.M3)
          put(m0:s2..m0 m1 m2 sig3 d3)
          sig1b0=s.sig1 sig2b0=s.sig2 sig2b1=s1.sig2 sig3b1=s1.sig3
          sig3b2=s2.sig3 b(M32=s.M32 1b0.M3=s1.M3 2b0.M3=s2.M3)
        `);
        t('1b0_2b1', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_1) s1.decl(2-32)
          s2.clone(s1.0_2) s2.decl(3-32)
          t..clone(s.0_32) ${p=`sig1b0=s.sig1 sig2b0=s.sig2`}
          put(m0:s1..m0 m1 sig2 d2) ${p+=` sig2b1=s1.sig2`}
          b(M32=s.M32 1b0.M2=s1.M2)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3b1=s1.sig3`}
          b(M32=s.M32 1b0.M3=s1.M3)
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+=` sig3b2=s2.sig3`}
          b(M32=s.M32 1b0.M3=s1.M3 2b1.M3=s2.M3)
          put(m0:s1..m0 m1 m2 m3 sig4 d4) ${p+=` sig4b1=s1.sig4`}
          b(M32=s.M32 1b0.M4=s1.M4 2b1.M3=s2.M3)
          put(m0:s2..m0 m1 m2 m3 sig4 d4) ${p+=` sig4b2=s2.sig4`}
          b(M32=s.M32 1b0.M4=s1.M4 2b1.M4=s2.M4)`);
        t('1b0_2b1_rev', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_1) s1.decl(2-32) s2.clone(s1.0_2) s2.decl(3-32)
          t..clone(s.0_32) ${p=`sig1b0=s.sig1 sig2b0=s.sig2`}
          put(m0:s2..m0 m1 m2 sig3 d3) ${p+=` sig3b1=s2.sig3`}
          b(M32=s.M32 1b0.M3=s2.M3)
          put(m0:s1..m0 m1 m2 sig3 d3) ${p+=` sig3b2=s1.sig3`}
          b(M32=s.M32 1b0.M3=s2.M3 2b1.M3=s1.M3)`);
        t('combined_m', `s0..scroll(!prev_scroll) decl(1-32)
          s1..clone(s0.0_1) decl(2-32) t..clone(s0.0_32)
          put(s1..m0_1 m2_3 sig4 d4) b(M32=s0.M32 1b0.M4=s1.M4)
          put(s1..m0_1 m2_3 m2 m3 sig3 d3) b(M32=s0.M32 1b0.M4=s1.M4)`);
        t('combined_m_missing', `s0..scroll(!prev_scroll) decl(1-32)
          s1..clone(s0.0_1) decl(2-32) t..clone(s0.0_32)
          put(s1..m0_1 m2_3 sig4 d4) b(M32=s0.M32 1b0.M4=s1.M4)
          put(s1..m0_1 m2_3 m3 sig3 d3
            err(missing m2,missing m2_3, missing m0_3))
          b(M32=s0.M32 1b0.M4=s1.M4)`);
        t('combined_m_invalid', `s0..scroll(!prev_scroll) decl(1-32)
          s1..clone(s0.0_1) decl(2-32) t..clone(s0.0_32)
          put(s1..m0_1 m2_3 sig4 d4) b(M32=s0.M32 1b0.M4=s1.M4)
          put(s1..m0_1 s0.m2 m3 sig3 d3 err(invalid sig3))
          b(M32=s0.M32 1b0.M4=s1.M4)`);
         t('split_m', `s0..scroll(!prev_scroll) decl(1-32)
          s1..clone(s0.0_1) decl(2-32) t..clone(s0.0_32)
          put(s1..m0_1 m2_3 sig4 d4) b(M32=s0.M32 1b0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) b(M32=s0.M32 1b0.M4=s1.M4)
          t.sig3b1=s1.sig3`);
        // XXX add pc support pc1.s1.clone(s.0_3)
        t('3b0_8b0_15b0', `s.scroll(!prev_scroll) pc1.s.decl(1-32)
          pc2.s1.clone(s.0_3) s1.decl(4-32) pc3.s2.clone(s.0_8) s2.decl(9-32)
          pc4.s3.clone(s.0_15) s3.decl(16-32) pc5.t..clone(s.0_32)
          put(s1..m0 m1 m2 m3 sig4 d4) b(M32=s.M32 3b0.M4=s1.M4)
          put(s2..m0 m1 m2_3 m4_7 m8 sig9 d9)
          b(M32=s.M32 3b0.M4=s1.M4 8b0.M9=s2.M9)
          put(s3..m0 m1 m2_3 m4_7 m8_15 sig16 d16)
          b(M32=s.M32 3b0.M4=s1.M4 8b0.M9=s2.M9 15b0.M16=s3.M16)`);
        // XXX: todo 15b1
        t('3b0_8b1_15b1_zzz1', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_3) s1.decl(4-32) s2.clone(s1.0_8) s2.decl(9-32)
          s3.clone(s1.0_15) s3.decl(16-32) t..clone(s.0_32)
          put(s1..m0_3 sig4 d4) b(M32=s.M32 3b0.M4=s1.M4)
          put(s1..sig9 d9 m0_3 m4 m5 m6_7 m8) b(M32=s.M32 3b0.M9=s1.M9)
          put(s2..m0 m1 m2_3 m4_7 m8 sig9 d9)
          b(M32=s.M32 3b0.M9=s1.M9 8b1.M9=s2.M9)`);
        /*
        s0 0 1 2 3 4 5 6 7 8 9
        s1 0 1 2 3 a b c d e f
        s2 0 1 2 3 a b c d e F
        b0 0 1 2 3 4 5 6 7 8 9
        b1 0_1_2_3 a
        b2 0_1_2_3 a_b_c_d e F
        b3 0 1 2_3 a b c d e f
        */
        t('3b0_8b1_15b1_zzz2', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_3) s1.decl(4-32) s2.clone(s1.0_8) s2.decl(9-32)
          s3.clone(s1.0_15) s3.decl(16-32) t..clone(s.0_32)
          put(s1..m0_3 sig4 d4) b(M32=s.M32 3b0.M4=s1.M4)
          put(s2..m0_3 m4_7 m8 sig9 d9)
          b(M32=s.M32 3b0.M4=s1.M4 3b0.M9=s2.M9)
          put(s1..sig9 d9 m0 m1 m2_3 m4 m5 m6_7 m8)
          b(M32=s.M32 3b0.M9=s2.M9 8b1.M9=s1.M9)
        `);
        // XXX: derry two branches that should be the same
        t('3b0_8b1_15b1_zzz3', `s.scroll(!prev_scroll) s.decl(1-32)
          s1.clone(s.0_3) s1.decl(4-32) t..clone(s.0_32)
          put(s1..m0_3 sig4 d4) b(M32=s.M32 3b0.M4=s1.M4)
          put(s1..m0_3 m4_7 m8 sig9 d9) b(M32=s.M32 3b0.M4=s1.M4 3b0.M9=s1.M9)
          put(s1..sig9 d9 m0 m1 m2_3 m4 m5 m6_7 m8)
          b(M32=s.M32 3b0.M9=s1.M9)`);
        // b0 a b c d e
        // b1 a b c D E
        s = `s0..scroll(!prev_scroll) decl(1-32) s1..clone(s0.0_2) decl(3-32)
          t..clone(s0.0_1)`;
        // XXX: fix branch syntax 2b0(b1)=s1.M4
        // XXX: fix branch syntax t.2b0(b1).M4=s1.M4
        t('fix_2b0_a', `${s} put(s0..m0_1 m2 m3 sig4 d4) b(M4=s0.M4)
          put(s1..m0_1 m2 m3 sig4 d4) b(M4=s0.M4 2b0.M4=s1.M4)`);
        // b0 a b c_d e
        // b1 a b c D E
        t('fix_2b0_b', `${s} put(s0..m0_1 m2_3 sig4 d4) b(M4=s0.M4)
          put(s1..m0_1 m2 m3 sig4 d4) b(M4=s0.M4 1b0.M4=s1.M4)
          put(s0..m0_1 m2 m3 sig3 d3) b(M4=s0.M4 2b0.M4=s1.M4)`);
        // b0 a b c d e
        // b1 a b c_D E
        t('fix_2b0_c', `${s} put(s0..m0_1 m2 m3 sig4 d4) b(M4=s0.M4)
          put(s1..m0_1 m2_3 sig4 d4) b(M4=s0.M4 1b0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) b(M4=s0.M4 2b0.M4=s1.M4)`);
        // b0 a b c_d e
        // b1 a b c_D E
        t('fix_2b0_d', `${s} put(s0..m0_1 m2_3 sig4 d4) b(M4=s0.M4)
          put(s1..m0_1 m2_3 sig4 d4) b(M4=s0.M4 1b0.M4=s1.M4)
          put(s0..m0_1 m2 m3 sig3 d3) b(M4=s0.M4 1b0.M4=s1.M4)
          put(s1..m0_1 m2 m3 sig3 d3) b(M4=s0.M4 2b0.M4=s1.M4)`);
        // b0 0 1 2 3 4
        // b1 0 1 a b c
        // b2 0 1 a B C
        t('fix_2b1_a', `s0..scroll(!prev_scroll) decl(1-32) s1..clone(s0.0_1)
          decl(2-32) s2..clone(s1.0_2) decl(3-32) t..clone(s0.0_32)
          put(s1..m0_1 m2 m3 sig4 d4) b(M32=s0.M32 1b0.M4=s1.M4)
          put(s2..m0_1 m2 m3 sig4 d4)
          b(M32=s0.M32 1b0.M4=s1.M4 2b1.M4=s2.M4)`);
        // b1 0 1 a_b c
        // b2 0 1 a B C
        t('fix_2b1_b', `s..scroll(!prev_scroll) decl(1-32) s1..clone(s.0_1)
          decl(2-32) s2..clone(s1.0_2) decl(3-32) t..clone(s.0_32)
          put(s1..m0_1 m2_3 sig4 d4) b(M32=s.M32 1b0.M4=s1.M4)
          put(s2..m0_1 m2 m3 sig4 d4) b(M32=s.M32 1b0.M4=s1.M4 1b0.M4=s2.M4)
          put(s1..m0_1 m2 m3 sig3 d3) b(M32=s.M32 1b0.M4=s1.M4 2b1.M4=s2.M4)`);
        t('fix_2b1_c', `s..scroll(!prev_scroll) decl(1-32) s1..clone(s.0_1)
          decl(2-32) s2..clone(s1.0_2) decl(3-32) t..scroll(s..M0)
          tput(0 1 2 3 4) b(M4)
          tput(0_1 c d e) b(M4 1b0.M4=s1.M4) // XXX: 1b0=s1.M4
          tput(0_1 c_D E) b(M4 1b0.M4=s1.M4 1b0.M4=s2.M4)
          tput(0_1 c D E) b(M4 1b0.M4=s1.M4 2b1.M4=s2.M4)`);
        // b1 0 1 a_b c
        // b2 0 1 a_B C
        t('fix_2b1_d', `s..scroll(!prev_scroll) decl(1-32) s1..clone(s.0_1)
          decl(2-32) s2..clone(s1.0_2) decl(3-32) t..clone(s.0_32)
          put(s1..m0_1 m2_3 sig4 d4) b(M32=s.M32 1b0.M4=s1.M4)
          put(s2..m0_1 m2_3 sig4 d4) b(M32=s.M32 1b0.M4=s1.M4 1b0.M4=s2.M4)
          put(s1..m0_1 m2 m3 sig3 d3) b(M32=s.M32 1b0.M4=s1.M4 1b0.M4=s2.M4)
          put(s2..m0_1 m2 m3 sig3 d3) b(M32=s.M32 1b0.M4=s1.M4 2b1.M4=s2.M4)`);
        //    0 1 2 3 4 5 6 7 8
        // b0 a b c d e_f_g_h i
        // b1 a b c d e_F_G_H I
        s = `s0..scroll(!prev_scroll) decl(1-32) s1..clone(s0.0_4) decl(5-32)
          t..clone(s0.0_3)`;
        t('M9_a', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) b(M8=s0.M8 3b0.M8=s1.M8)
          put(s0..m0_3 m4 m5 m6_7 sig8 d8) b(M8=s0.M8 3b0.M8=s1.M8)
          put(s1..m0_3 m4 m5 m6_7 m8 sig9 d9) b(M8=s0.M8 4b0.M9=s1.M9)`);
        //    0 1 2 3 4 5 6 7 8
        // b0 a b c d e_f_g_h i
        // b1 a b c d e_f_G_H I
        s = `s0..scroll(!prev_scroll) decl(1-32) s1..clone(s0.0_5) decl(6-32)
          t..clone(s0.0_3)`;
        t('M9_b', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) b(M8=s0.M8 3b0.M8=s1.M8)
          put(s0..m0_3 m4_5 m6 m7 sig8 d8) b(M8=s0.M8 3b0.M8=s1.M8)
          put(s1..m0_3 m4_5 m6 m7 m8 sig9 d9) b(M8=s0.M8 5b0.M9=s1.M9)`);
        //    0 1 2 3 4 5 6 7 8
        // b0 a b c d e_f_g_h i
        // b1 a b c d e_f_g_H I
        s = `s0..scroll(!prev_scroll) decl(1-32) s1..clone(s0.0_6) decl(7-32)
          t..clone(s0.0_3)`;
        t('M9_c', `${s} put(s0..m0_3 m4_7 sig8 d8)
          put(s1..m0_3 m4_7 sig8 d8) b(M8=s0.M8 3b0.M8=s1.M8)
          put(s0..m0_3 m4_5 m6 m7 sig8 d8) b(M8=s0.M8 3b0.M8=s1.M8)
          put(s1..m0_3 m4_5 m6 m7 m8 sig9 d9) b(M8=s0.M8 6b0.M9=s1.M9)`);
        // XXX merge tests
        s = `s..scroll(!prev_scroll) decl(1-32) t..clone(s..0_3)`;
        // XXX: review and decide if we must require m0_3 or it should work
        if (0) t('xxx_check', `${s}
          put(sig4 d4 branch(b0:0:M4))
          put(sig7 d7 m4_5 m6 branch(b0:0:M4)) // XXX m0_3
        `);
        // b0 a b c d e
        // b1 a b c d e_f g h
        t('xxx2_a', `${s}
          put(sig4 d4) b(M4)
          put(sig7 d7 m0_3 m4_5 m6) b(M4 3v0.M7)
          put(m0_3 m4 sig5 d5) b(M7)
          put(m0_3 m4_5 sig6 d6) b(M7)
          put(m0_3 m4_5 m6 sig7 d7) b(M7)`);
        s = `s..scroll(!prev_scroll) decl(1-32) t..clone(s..0_4)`;
        // b0 0 1 2 3 4
        // b1 0 1 2 3 4_5 6_7 8 9
        // b2 0 1 2 3 4 5 6
        // b3 0 1 2 3 4_5 6 7
        t('xxx3_a', `${s}
          put(sig9 d9 m8 m6_7 m4_5 m0_3) b(M4 3v0.M9)
          put(sig6 d6 m4 m5 m0_3) b(M9 5v0.M6)
          put(sig7 d7 m6 m4_5 m0_3) b(M9)`);
        // b0 0 1 2 3 4
        // b1 0 1 2 3 4_5 6_7 8 9
        // b2 0 1 2 3 4_5 6
        // b3 0 1 2 3 4 5 6 7
        t('xxx3_b', `${s}
          put(sig9 d9 m8 m6_7 m4_5 m0_3) b(M4 3v0.M9)
          put(sig6 d6 m4_5 m0_3) b(M4 3v0.M9 5v1.M6)
          put(sig7 d7 m6 m4 m5 m0_3) b(M9)`);
        s = 's..scroll(!prev_scroll) decl(1-32)';
        t('xxx4_a', `${s} t..scroll(s..M0)
          tput(0 1 2 3 4          ) b(M4)
          tput(0_1_2_3 4_5 6_7 8 9) b(M4 3v0.M9)
          tput(0_1_2_3 4 5 6      ) b(M9 5v0.M6)
          tput(0_1_2_3 4_5 6 7    ) b(M9)
        `);
        t('xxx4_b', `${s} t..scroll(s..M0)
          tput(0 1 2 3 4          ) b(M4)
          tput(0_1_2_3 4_5 6_7 8 9) b(M4 3v0.M9)
          tput(0_1_2_3 4_5 6      ) b(M4 3v0.M9 5v1.M6)
          tput(0_1_2_3 4 5 6 7    ) b(M9)
        `);
        t('xxx4_c', `${s} t..scroll(s..M0)
          tput(0 1 2            ) b(M2)
          tput(0_1 2_3 4        ) b(M2 1v0.M4)
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M4 3v1.M6)
          tput(0_1_2_3 4_5_6_7 8) b(M2 1v0.M4 3v1.M6 3v2.M8)
          tput(0_1 2 3 4 5 6 7) b(M8)
        `);
        t('xxx4_d', `${s} t..scroll(s..M0)
          tput(0 1 2            ) b(M2)
          tput(0_1 2_3 4        ) b(M2 1v0.M4)
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M4 3v1.M6)
          tput(0_1_2_3 4_5 6_7 8) b(M2 1v0.M4 3v1.M6 5v2.M8)
          tput(0_1 2 3 4 5 6 7) b(M8)
        `);
        s = `s..scroll(!prev_scroll) decl(1-32)
          s1..clone(s.0_4) decl(5-32) t..scroll(s..M0)`;
        t('xxx5_not_final', `${s}
          tput(0 1 2            ) b(M2)
          tput(0_1 2_3 4        ) b(M2 1v0.M4)
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M4 3v1.M6)
          tput(0_1_2_3 4_5 6_7 8) b(M2 1v0.M4 3v1.M6 5v2.M8)
          tput(0_1 2_3 4_f g    ) b(M2 1v0.M4 3v1.M6 5v2.M8 3b3.M6=s1.M6)
          // XXX: how to mark not final branch point
          tput(0_1 2 3 4 5 6 7  ) b(M8 3b0.M6=s1.M6)
          tput(0_1 2_3 4 f      ) b(M8 4b0.M6=s1.M6)
        `);
        t('xxx5_branch_vbranch', `${s}
          tput(0 1 2            ) b(M2)
          tput(0_1 2_3 4        ) b(M2 1v0.M4)
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M4 3v1.M6)
          tput(0_1_2_3 4_5 6_7 8) b(M2 1v0.M4 3v1.M6 5v2.M8)
          tput(0_1 2_3 4_f g    ) b(M2 1v0.M4 3v1.M6 5v2.M8 3b3.M6=s1.M6)
          tput(0_1 2_3 4_f g_h i)
            b(M2 1v0.M4 3v1.M6 5v2.M8 3b3.M6=s1.M6 5v4.M8=s1.M8)
          tput(0_1 2 3 4 5 6 7  ) b(M8 3b0.M6=s1.M6 5v1.M8=s1.M8)
          tput(0_1 2_3 4 f      ) b(M8 4b0.M6=s1.M6 5v1.M8=s1.M8)
          tput(0_1 2_3 4 f g h  ) b(M8 4b0.M8=s1.M8)
        `);
        t('xxx6_branch_vbranch', `${s}
          tput(0 1 2            ) b(M2)
          tput(0_1 2_3 4        ) b(M2 1v0.M4)
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M4 3v1.M6)
          tput(0_1_2_3 4_f g    ) b(M2 1v0.M4 3v1.M6 3b2.M6=s1.M6)
          tput(0_1_2_3 4_f g_h i) b(M2 1v0.M4 3v1.M6 3b2.M6=s1.M6 5v3.M8=s1.M8)
          // XXX 3b1 !final. need to use 3_4b1
          tput(0_1 2 3 4 5 6    ) b(M6 3b0.M6=s1.M6 5v1.M8=s1.M8)
          tput(0_1_2_3 4 f      ) b(M6 4b0.M6=s1.M6 5v1.M8=s1.M8)
          tput(0_1_2_3 4 f g h  ) b(M6 4b0.M8=s1.M8)
        `);
        t('xxx7_select_longest_a', `${s}
          tput(0 1 2            ) b(M2)
          tput(0_1 2_3 4        ) b(M2 1v0.M4)
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M4 3v1.M6)
          tput(0_1_2_3 4_f g    ) b(M2 1v0.M4 3v1.M6 3b2.M6=s1.M6)
        `);
        t('xxx7_select_longest_b', `${s}
          tput(0 1 2            ) b(M2)
          tput(0_1 2_3 4_5_6_7 8) b(M2 1v0.M8)
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M8 3v1.M6)
          tput(0_1_2_3 4_f g    ) b(M2 1v0.M8 3v1.M6 3v1.M6=s1.M6)
        `);
        t('xxx8_a', `${s}
          tput(0 1              ) b(M1)
          tput(0 1 2            ) b(M2)
          tput(0 1 2 3          ) b(M3)
          tput(0 1 2_3 4        ) b(M4)
          tput(0_1_2_3 4 5      ) b(M5)
          tput(0_1_2_3 4_5 6    ) b(M6)
          tput(0_1_2_3 4_5 6 7  ) b(M7)
          tput(0_1_2_3 4_5_6_7 8) b(M8)
        `);
        t('xxx8_b', `${s}
          tput(0 1              ) b(M1)
          tput(0 1 2_3 4        ) b(M4)
          tput(0 1 2_3 4_5_6_7 8) b(M4 3v0.M8)
          tput(0 1 2_3 4 5 6_7 8) b(M8)
        `);
        // XXX: support 3_4b0 for non-final brnaching point
      });
    });
  });
});

/* XXX:
short:
pc0.s0 0 1 2 3 4 5 6 7 8 9
pc1.s1         a b c d e f (3b0)
pc2.s2                   A (3b0 but real split 8b1)
full:
pc0.s0 0 1 2 3 4 5 6 7 8 9
pc1.s1 0 1 2 3 a b c d e f (3b0)
pc2.s2 0 1 2 3 a b c d e A (3b0 but real split 8b1)

pct.t.
    b1 0 1 2 3 a|b c        b1.a_?.dup_cmp = new Map().insert(b2, b3);
    b2 0 1 2 3 a_B C f      b2.a_B.dup = new Map().insert(b1);
    b3 0 1 2 3 a_C C f      b3.a_C.dup = new Map().insert(b1);
    b3 0 1 2 3 a_b_c_d e_f_h_i f
    b3 0 1 2 3     c_d e_f     g
    m = b1.m4_7.siblings = new Map();
    m.insert(b1);
    m.insert(b2);
    b2.m4_7.siblings = m;
    --> at stage we have two branches 3b1 3b2
    b2 0 1 2 3 a b c d e f
    --> now we need to unite to one branch 3b1

pct.t2
    b0 0 1 2 3 4 5 6 7 8 9
    b1 0 1 2 3 a
    b2 0 1 2 3           A [s2.m4_7 s2.m8]
    --> at stage we have two branches b1:3b0 b2:3b0
    b1 0 1 2 3 a b c d e
    b2 0 1 2 3 a b c d e A
    --> now we update branch information b1:3b0 b2:8b1

            0
          1    2
        a  b  c d
        cd - 2 - 1 0
*/

/* XXX: derry
        t('xxx6_branch_vbranch', `${s}
          tput(0 1 2            ) b(M2)
          //       0123 01 23? 4
0123x
have 0 1 2. add 4: 0 1 x2_3 4
1 2_3 4
          tput(0_1 2_3 4        ) b(M2 1v0.M4)
0 1 2_3x 4
01234567 0123x 45x6x7x
          tput(0_1_2_3 4_5 6    ) b(M2 1v0.M4 3v1.M6)
0 1 2_3x 4_5x 6
01234567 0123x 45x67x
6: {m[0]: m6}
          tput(0_1_2_3 4_f g    ) b(M2 1v0.M4 3v1.M6 3v1.M6=s1.M6)
0 1 2_3x 4_5x 6
0 1 2_3x 4x_fx g
01234567 {0123x {01 {0 1} 23x {2 3x}} 45xg7x {45x g7x {{m=[6,g]} {7x}}}
6: {m[0]: m6, m[1]: mg}

m2_3
3: {m: [m3, m2_3, m0_3}}

          tput(0_1_2_3 4_f g_h i) b(M2 1v0.M4 3v1.M6 3v1.M6=s1.M6 5v3.M8=s1.M8)
          // XXX syntax: how to specify final branch point (3b0/4b0)?
          tput(0_1_2 3 4 5 6    ) b(M6 3_4b0.M6=s1.M6 5v1.M8=s1.M8) // !final
          tput(0_1_2_3 4 f      ) b(M6 4b0.M6=s1.M6 5v1.M8=s1.M8) // 4b0 final
          tput(0_1_2_3 4 f g h  ) b(M6 4b0.M8=s1.M8)
        `);
        // XXX: support 3_4b0 for non-final brnaching point
      });
    });


*/
