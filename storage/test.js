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

const calc_m = (scroll, range)=>etask(function*calc_m(){
  let [s, e] = range;
  assert(Number.isInteger(Math.log2(e-s+1)), 'invalid merkel range '+
  range_str(range));
  let q = [];
  assert(e<scroll.b[0].size, 'scroll too small '+e+'<'+scroll.b[0].size);
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
  switch (type){
  case 'sig': return scroll.seq_sig(seq, {b});
  case 'M': return scroll.M_hash(seq, {b});
  case 'd': return scroll.seq_d(seq, {b});
  case 'D': return scroll.seq_D(seq, {b});
  // XXX: do we need calc_m?
  case 'm': return r0==seq ? scroll.m_hash(seq, {b}) :
    b ? scroll.m_hash(seq, {b}) : calc_m(scroll, o.range);
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

const cmd_put = t=>etask(function*cmd_put(){
  let name = t.ctx||get_def('left'), scroll = get_scroll(name);
  let diff = {}, err='';
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg_pair(curr.exp);
    if (t2.l=='err'){
      assert(!err, 'err already defined');
      err = t2.r||true;
      continue;
    }
    if (/^b\d+$/.test(t2.l)){
      xerr.notice('XXX TODO verify new branch '+t2.l); // XXX
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
  for (let b=0; b<scroll.b.length; b++){
    for (let seq=0; seq<scroll.b[b].size; seq++){
      seq = +seq;
      let decl = yield scroll.get_decl(seq, {b}); // XXX {create: false}
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
        if (tested[b][seq] && tested[b][seq][type])
          return;
        switch (type){
        case 'sig':
          assert(!decl.sig, 'sig'+seq+'b'+b+' exists '+t.meta.s);
          break;
        case 'd':
          assert(!decl.fbuf.h, 'd'+seq+'b'+b+' exists '+t.meta.s);
          break;
        case 'M':
          assert(!decl.M.h, 'M'+seq+'b'+b+' exists '+t.meta.s);
          break;
        default: assert.fail('invalid type '+type+'b'+b);
        }
      });
    }
  }
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

const test_run_single = o=>etask(function*_test_run_single(){
  let o2;
  switch (o.cmd){
  case 'scroll': yield cmd_scroll(o); break;
  case 'decl': yield cmd_decl(o); break;
  case 'put': yield cmd_put(o); break;
  case 'test':
  case '==':
    yield cmd_test(o);
    break;
  case '//': break;
  case '=': yield cmd_eq(o); break;
  case '.':
  case '..':
  case '...':
    assert(o.l, 'invalid "." operator');
    o2 = tparser.parse_exp(o.r);
    o2.ctx = o.l;
    if (o.cmd=='...'){
      set_def('left', o.l);
      set_def('right', o.l);
    } else if (o.cmd=='..')
      set_def('left', o.l);
    yield test_run_single(o2);
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
    yield test_run_single(o);
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
      const t = (size, exp)=>{
        let roots = Scroll.calc_roots(size);
        let a = [];
        roots.forEach(r=>a.push(Scroll.range_str(r)));
        assert.equal(a.join(' '), exp);
      };
      t(1, '0');
      t(2, '0_1');
      t(3, '0_1 2');
      t(4, '0_3');
      t(5, '0_3 4');
      t(6, '0_3 4_5');
      t(7, '0_3 4_5 6');
      t(8, '0_7');
      t(9, '0_7 8');
      t(10, '0_7 8_9');
      t(11, '0_7 8_9 10');
      t(12, '0_7 8_11');
      t(13, '0_7 8_11 12');
      t(14, '0_7 8_11 12_13');
      t(15, '0_7 8_11 12_13 14');
      t(16, '0_15');
      t(31, '0_15 16_23 24_27 28_29 30');
      t(32, '0_31');
      t(33, '0_31 32');
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
        t('sig0', `${s} s.put(sig0:sig1 err(invalid sig0))`);
        t('d0', `${s} s.put(d0:d1 err(invalid d0))`);
        t('m0', `${s} s.put(m0:m1 err(invalid m0))`);
        t('sig0 d0 m0', `${s} s.put(sig0:sig1 d0:d1 m0:d1
          err(invalid sig0,invalid d0,invalid m0))`);
        if (Scroll.xxx_branch)
          t('sig1', `${s} s.put(sig1:sig0 err(invalid sig1,missing d1))`);
        else
          t('sig1', `${s} s.put(sig1:sig0 err(invalid sig1))`);
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
          ==(M0 sig2 d2 sig1 d1 m1 m0 m0_1)`);
        t('add_d2D1', `${s} put(sig2 d2 sig1 D1 m1 m0)
          ==(M0 sig2 d2 sig1 d1 D1 m1 m0 m0_1)`);
        t('add_D2', `${s} put(sig2 D2 sig1 D1 m1 m0)
          ==(M0 sig2 D2 d2 sig1 d1 D1 m1 m0 m0_1)`);
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
          put(sig9 d9 err(invalid sig9,invalid d9)) M9=hroot(m0_7+s2.m8_9)
          put(sig4 d4 m5 m4_5 m6_7) =M4 s2.put(sig5 d5) =M5
          put(sig6 d6 m7) =M6 put(sig7 d7) =M7
          put(sig10 d10 err(invalid sig10)) !M10`);
        // XXX we always have root of seq 0
        /* XXX: branch
        M0
        M1
        M2
        ---> branch (2 M3: a b)
        branch(b1 3)
        branch(b2 11b1)
        branch(b3 2)
        branch(b4 21b2)
        M3 M3(3-0)
        M4 M4(3-0)
        M3b1 M3(3-1)
        M4b1 M4(3-1)
        M17b2 M17(3-1,11-3)
        branch 0 - no splits
        branch 1 - split 3
        branch 2 - split 2
        branch 3 - split 11 on branch 1
        */
        t('seq9_no_branch_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10) =M9 =M4 =M5 =M6 =M7 =M10`);
        t('seq9_branch_multi', `${s} put(sig3 d3 m0 m1 m2) ==(M0 m0
          sig3 d3 m0 m1 m2 m3 m2_3 m0_3 m0_1) put(sig8 d8 m4_7) =M8
          decl(9) M9=hroot(s2.m0_7+s2.m8_9) // branch
          put(sig9 d9 sig4 d4 m5 m4_5 m6_7 sig5 d5 sig6 d6 m7 sig7 d7 sig10
          d10 err(invalid sig9,invalid d9,invalid sig10))
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
          ==(sig4 d4 M3 m2 m3 m0_1 m2_3 m0_3) put(sig0 d0 m1) =M0`);
        t('m0_1m2m3_seq4_branch', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // branch
          put(sig4 d4 err(invalid sig4,invalid d4))
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) d4:s2.d4 M3 m2
          m3 m0_1 m2_3 m0_3) put(sig0 d0 m1) =M0`);
        if (Scroll.xxx_branch)
        t('xxx', `${s} put(m0_1 m2 m3)
          ==(M3 m2 m3 m0_1 m2_3 m0_3) decl(4) // branch
          put(sig4 d4 b1 err(invalid sig4,invalid d4))
          ==(sig4:sign(s2.d4+M3) m4:hleaf(s2.d4+s2.sig4) d4:s2.d4 M3 m2
          m3 m0_1 m2_3 m0_3
          sig4b1:s.sig4 d4b1:s.d4 m3b1:s2.m3b1 m2_3b1:s2.m2_3b1
          m0_3b1:s2.m0_3b1)`);
        // XXX: add test for sig/d insert + invalid
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
          err(missing m28,missing m28_29,missing m28_31,missing m24_31,
          missing m16_31,missing m0_31))
          ==(M31 m30 m31 m0_15 m16_23 m24_27 m28_29 m28_31
          m30_31 m24_31 m16_31 m0_31)`);
      });
    });
  });
});
