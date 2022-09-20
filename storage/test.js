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

let t_scroll, t_genesis_scroll, t_prev_scroll, t_keypair;

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

function assert_buffer(a, b, meta){
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b))
    assert.equal(b2s(a), b2s(b), 'buffer not equal '+meta.s);
  else
    assert.equal(a, b, 'not equal '+meta.s);

}

const calc_m = (scroll, s, e)=>etask(function*calc_m(){
  assert(Number.isInteger(Math.log2(e-s+1)), 'invalid merkel range '+
  range_str([s, e]));
  let q = [];
  assert(e<scroll.size, 'scroll too small '+e+'<'+scroll.size);
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

const get_val = exp=>etask(function*_get_val(){
  assert(typeof exp=='string', 'invalid get_val '+exp);
  let m = exp.match(/^([a-zA-Z]\d*)\.(.*)$/);
  let name = m ? m[1] : 's', scroll = t_scroll[name];
  exp = m ? m[2] : exp;
  if (m = exp.match(/^sig(\d+)$/)) // sig10
    return scroll.seq_sig(+m[1]);
  if (m = exp.match(/^m(\d+)$/)) // m10
    return scroll.m_hash(+m[1]); // XXX: calc and assert it match data hash
  if (m = exp.match(/^m(\d+)_(\d+)$/)) // m0_1
    return calc_m(scroll, +m[1], +m[2]);
  if (m = exp.match(/^M(\d+)$/)) // M10
    return scroll.M_hash(+m[1]);
  if (m = exp.match(/^M$/)) // M
    return scroll.M_hash();
  if (m = exp.match(/^d(\d+)$/)) // d10
    return scroll.seq_d(+m[1]);
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
      let r = Scroll.range_from_str(v.replace('m', ''));
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
  if (m = exp.match(/^0x([0-9a-f]+)$/))
    return s2b(m[1]);
  if (/^\d+$/.test(exp))
    return enc.encode(enc.uint64, +exp);
  if ('prev_scroll1'==exp)
    return t_prev_scroll.M_hash(1);
  assert.fail('invalid val exp '+exp);
});

const test_decl = (scroll, data)=>etask(function*test_decl(){
  yield scroll.decl(data);
  yield xsinon.tick(1);
});

const test_start = ()=>etask(function*test_start(){
  t_scroll = {};
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
    t('a(1)==b(2)', ['a(1)==b(2)']);
    t('a==b(c==d)', ['a==b(c==d)']);
    t('a b(c) d==e', ['a', 'b(c)', 'd==e']);
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
    t('a.b', {cmd: '.', l: 'a', r: 'b'});
    t('a:b', {cmd: ':', l: 'a', r: 'b'});
    t('a=b', {cmd: '=', l: 'a', r: 'b'});
    t('a+b', {cmd: '+', l: 'a', r: 'b'});
    t('a=b(2)', {cmd: '=', l: 'a', r: 'b(2)'});
    t('a(1)==b(2)', {cmd: '==', l: 'a(1)', r: 'b(2)'});
    t('a1==b(c+d)', {cmd: '==', l: 'a1', r: 'b(c+d)'});
    t('a.b(c)', {cmd: '.', l: 'a', r: 'b(c)'});
    t('//', {cmd: '//', l: '', r: ''});
    t('// XXX', {cmd: '//', l: '', r: 'XXX'});
  });
  // XXX: test invalid parsing
});

const cmd_scroll = t=>etask(function*cmd_scroll(){
  let prev_scroll = yield t_prev_scroll.M_hash(1);
  let name = t.ctx||'s', M, a, scroll;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!t_scroll[name], 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case '!prev_scroll': prev_scroll = null; break;
    default:
      if (a = tt.cmd.match(/^M(\d+)$/)){
        M = {seq: +a[1], h: yield get_val(tt.r||tt.cmd)};
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
  let name = t.ctx||'s', scroll = t_scroll[name];
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  assert(scroll, 'scroll not found');
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
  let xxx = t.cmd=='put2'; // XXX: WIP
  let name = t.ctx||'s', scroll = t_scroll[name];
  let diff = {}, err='';
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg(curr.exp);
    assert(!t2.l, 'invalid put exp '+curr.exp);
    if (t2.cmd=='err'){
      assert(!err, 'err already defined');
      err = t2.r||true;
      continue;
    }
    let val = yield get_val(t2.r||t2.cmd), v = t2.cmd;
    let o = split_var(v), type = o.type, seq = +o.range[1];
    let seq_o = diff[seq] = diff[seq]||{};
    assert(['sig', 'd', 'm', 'M'].includes(type), 'invalid type '+type);
    if (type=='m'){
      seq_o.m = seq_o.m||{};
      seq_o.m[o.range[0]] = val;
    } else
      seq_o[type] = val;
  }
  if (xxx){
    let ret = scroll.put2(diff);
    assert.deepEqual(Object.keys(ret.errors), err ?
      string.split_trim(err, /,\s*/) : []);
    return;
  }
  try {
    yield scroll.put(diff);
    assert(!err, 'missing error '+err);
  }
  catch(e){ assert.equal(''+e, 'Error: '+err, 'error mismatch'); }
});

function split_var(v){
  let m = v.match(/^(sig|m|M|d)((\d+)|((\d+)_(\d+)))$/);
  assert.equal(m?.length, 7, 'invalid var '+v);
  let type = m[1], range = Scroll.range_from_str(m[2]), seq = range[1];
  assert(type=='m' || range[0]==range[1], 'invalid range '+v);
  return {seq, type, range};
}

const cmd_test = t=>etask(function*cmd_test(){
  let name = t.ctx||'s', scroll = t_scroll[name];
  let tested = {};
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg(curr.exp);
    assert(!t2.l, 'invalid test exp '+curr.exp);
    let v = t2.cmd;
    let o = split_var(v);
    tested[o.seq] = tested[o.seq]||{M: false, sig: false, d: false, m: {}};
    if (o.type=='m')
      tested[o.seq].m[o.range[0]] = true;
    else
      tested[o.seq][o.type] = true;
    let exp = yield get_val(t2.r||v);
    let val = yield get_val(name+'.'+v);
    assert_buffer(val, exp, t2.meta);
  }
  for (let seq=0; seq<scroll.size; seq++){
    seq = +seq;
    let decl = yield scroll.get_decl(seq, {create: true});
    ['sig', 'd', 'M', 'm'].forEach(type=>{
      if (type=='m'){
        let a = Scroll.merkel_ranges(seq);
        for (let i=0; i<a.length; i++){
          let s = a[i][0];
          if (tested && tested[seq]?.m[s])
            continue;
          assert(!decl.m_get([s, seq]).h, 'm'+range_str([s, seq])+
            ' exists '+t.meta.s);
        }
        return;
      }
      if (tested[seq] && tested[seq][type])
        return;
      switch (type){
      case 'sig': assert(!decl.sig, 'sig'+seq+' exists '+t.meta.s); break;
      case 'd': assert(!decl.fbuf.h, 'd'+seq+' exists '+t.meta.s); break;
      case 'M': assert(!decl.M.h, 'M'+seq+' exists '+t.meta.s); break;
      default: assert.fail('invalid type '+type);
      }
    });
  }
});

const cmd_eq = o=>etask(function*cmd_eq(){
  assert(o.l, 'missing left '+o.meta.s);
  assert(o.r, 'missing right '+o.meta.s);
  let l = yield get_val(o.l);
  let r = yield get_val(o.r);
  assert_buffer(l, r, o.meta);
});

const test_run_single = o=>etask(function*_test_run_single(){
  let o2;
  switch (o.cmd){
  case 'scroll': yield cmd_scroll(o); break;
  case 'decl': yield cmd_decl(o); break;
  case 'put': yield cmd_put(o); break;
  case 'put2': yield cmd_put(o); break;
  case 'test': yield cmd_test(o); break;
  case '//': break;
  case '=': yield cmd_eq(o); break;
  case '.':
    assert(o.l, 'invalid "." operator');
    o2 = tparser.parse_exp(o.r);
    o2.ctx = o.l;
    yield test_run_single(o2);
    break;
  default: assert.fail('invalid cmd "'+o.cmd+'" in '+o.meta.s);
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
    t('no_prev_scroll', `scroll(!prev_scroll) decl(1) sig0=${sig0}
      d0=0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
      m0=0xa0d3dfd96822872daa1351808936ebce919fd82f3af2a14abbac987446d48017
      m0=hleaf(d0+sig0) sig0=sign(d0) M0=hroot(m0)
      m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
    sig0 = '0xb34dd640e4fb8f08593c91840b1175d1014a96a9e211b5f790a3639809135a3'+
      'c26a4f98b3c7798566d7241e4f7a9e97d99b2d7e075ec1e1f4e71a28e3c0dba0c';
    t('with_prev_scroll', `scroll decl(1) sig0=${sig0}
      d0=0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
      m0=0x0d7b0519668a3c03ba5b206d8dd92846fdb00b282d35d4b5c0a29bd230489eee
      m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0)
      m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1)`);
    // XXX branch support
    // XXX api delete data
    // for testing: t('s0 s1(m1 m0_1) s3

/* XXX derry:
  // m7=hleaf(d7+sig7) sig7=sign(d7+M6) M7=hroot(m0_7)
  // m8=hleaf(d8+sig8) sig8=sign(d8+M7) M8=hroot(m0_7+m8)
  t('m0_8', `${s} s2.put(sig8 d8 M7 m0 m1 m2_3 m4_7)`);

*/
    t('merkel', `scroll decl(1-32)
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
/* XXX derry
// m5=hleaf(d5+sig5) sig5=sign(d5+M4) M5=hroot(m0_3+m4_5)
// top is highest known M (top={seq, M})
// diff = {3: {d, sig, m: {3: 0xm3, 2: 0xm2_3 0: 0xm0_3}}, 4: ...}
function put(diff){
  for (seq in diff){ // ascending order
    let sketch = {}, m = get_m(diff, seq);
    if (seq > top.seq){
      // check if can be added as new top
      // we need sig, d M_prev
      let {M_prev, match} = calc_M({seq: seq-1, m, sketch, diff, errors});
      // XXX chec existing values
      if (!M_prev)
        push_error('missing info');
      if (!match)
        push_error('spam');
      let sig = get_sig(diff, seq), d = get_d(diff, seq);
      if (m==hleaf(d+sig) && verify(sig, d+M_prev))
        copy_to_verified(sketch);
      else
        push_error('invalid sig');
      break;
    }
    M = calc_top_M({seq, m, sketch, diff, errors});
    if (!M){
      push_error('missing info');
      continue;
    }
    if (M.equals(top.M))
      copy_to_verified(sketch);
    else
      push_error('spam'); // XXX TODO: branch detection
  }
}
// XXX: how to know which decl I need in memory?
// XXX TODO: need caching of calculated values that were not verified

*/
    describe('put2', ()=>{
      describe('errors_invalid', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M0)
          s2.test(M0)`;
        // XXX: need to verify that s didn't change after the errors
        t('sig0', `${s} s.put2(sig0:sig1 err(invalid sig0))`);
        t('d0', `${s} s.put2(d0:d1 err(invalid d0))`);
        t('m0', `${s} s.put2(m0:m1 err(invalid m0))`);
        t('sig0 d0 m0', `${s} s.put2(sig0:sig1 d0:d1 m0:d1
          err(invalid sig0,invalid d0,invalid m0))`);
        t('sig1', `${s} s.put2(sig1:sig0 err(invalid sig1))`);
      });
      describe('errors_missing', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M0)
          s2.test(M0)`;
        t('sig0', `${s} s2.put2(sig0 err(missing d0)) s2.test(M0)`);
        t('d0', `${s} s2.put2(d0 err(missing sig0)) s2.test(M0)`);
      });
      describe('top_M0', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M0)
          s2.test(M0)`;
        t('xxx1', `${s} s2.put2(m0:m1 err(invalid M0)) s2.test(M0)`);
        t('xxx2', `${s} s2.put2(m0) s2.test(M0 m0)`);
        t('xxx3', `${s} s2.put2(m0 sig0 d0) s2.test(M0 m0 sig0 d0)`);
        t('xxx4', `${s} s2.put2(m0 sig0 err(missing d0)) s2.test(M0 m0)`);
        t('xxx5', `${s} s2.put2(m0 d0 err(missing sig0)) s2.test(M0 m0)`);
        t('xxx6', `${s} s2.put2(m0 sig0:sig1 d0 err(invalid sig0))
          s2.test(M0 m0)`);
      });
      describe('top_M1', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M1)
          s2.test(M1)`;
        t('m0', `${s} s2.put2(m0 err(missing m1,missing m0_1)) s2.test(M1)`);
        t('m0m0_1', `${s} s2.put2(m0 err(missing m1,missing m0_1))
          s2.test(M1)`);
        t('m1', `${s} s2.put2(m1 err(missing m0,missing m0_1)) s2.test(M1)`);
        t('m0m1', `${s} s2.put2(m0 m1) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0m1_invalid_m0', `${s} s2.put2(m0:m1 m1 err(invalid M1))
          s2.test(M1)`);
        t('m0m1_invalid_m1', `${s} s2.put2(m0 m1:m0 err(invalid M1))
          s2.test(M1)`);
        t('m0m1_sig0d0', `${s} s2.put2(sig0 d0 m0 m1)
          s2.test(sig0 d0 M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_invalid_d0', `${s} s2.put2(sig0 d0:d1 m0 m1
          err(invalid sig0)) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_invalid_sig0', `${s} s2.put2(sig0:sig1 d0 m0 m1
          err(invalid sig0)) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_missing_d0', `${s} s2.put2(sig0 m0 m1
          err(missing d0)) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig0d0_missing_sig0', `${s} s2.put2(d0 m0 m1
          err(missing sig0)) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1', `${s} s2.put2(sig1 d1 m0 m1)
          s2.test(sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_invalid_sig1', `${s} s2.put2(sig1:sig0 d1 m0 m1
          err(invalid sig1)) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_missing_sig1', `${s} s2.put2(d1 m0 m1
          err(missing sig1)) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0m1_sig1d1_sig0d0', `${s} s2.put2(sig0 d0 sig1 d1 m0 m1)
          s2.test(sig0 d0 sig1 d1 M0 m0 M1 m1 m0_1)`);
        // XXX: ^m0_1 is redundant
        t('m0m1m0_1', `${s} s2.put2(m0 m1 m0_1) s2.test(M0 m0 M1 m1 m0_1)`);
        t('m0_sig1d1', `${s} s2.put2(m0 sig1 d1)
          s2.test(sig1 d1 M0 m0 M1 m1 m0_1)`);
        t('m1_sig0d0', `${s} s2.put2(sig0 d0 m1)
          s2.test(sig0 d0 M0 m0 M1 m1 m0_1)`);
        // XXX add test for d0sig0_d1_sig1
        // XXX: add sig/d tests
      });
      describe('top_M2', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M2)
          s2.test(M2)`;
        t('m0', `${s} s2.put2(m0 err(missing m1,missing m0_1)) s2.test(M2)`);
        t('m0m1', `${s} s2.put2(m0 m1 err(missing m2)) s2.test(M2)`);
        t('m0m1m2', `${s} s2.put2(m0 m1 m2) s2.test(M2 m0 m1 m2 m0_1)`);
        t('m0m1m2_invalid_m0', `${s} s2.put2(m0:m1 m1 m2 err(invalid M2))
          s2.test(M2)`);
        t('m0m1m2_invalid_m1', `${s} s2.put2(m0 m1:m0 m2 err(invalid M2))
          s2.test(M2)`);
        t('m0m1m2_invalid_m2', `${s} s2.put2(m0 m1 m2:m0 err(invalid M2))
          s2.test(M2)`);
        t('m0_1m2', `${s} s2.put2(m0_1 m2) s2.test(M2 m2 m0_1)`);
        t('m0_1m2_invalid_m0_1', `${s} s2.put2(m0_1:m1 m2 err(invalid M2))
          s2.test(M2)`);
        t('m0_1m2_invalid_m2', `${s} s2.put2(m0_1 m2:m1 err(invalid M2))
          s2.test(M2)`);
        // XXX: add test for sig/d insert + invalid
      });
      describe('top_M3', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M3)
          s2.test(M3)`;
        t('m0', `${s} s2.put2(m0 err(missing m1,missing m0_1,missing m0_3))
          s2.test(M3)`);
        t('m0m1', `${s} s2.put2(m0 m1
          err(missing m2,missing m2_3,missing m0_3)) s2.test(M3)`);
        t('m0m1m2', `${s} s2.put2(m0 m1 m2
          err(missing m3,missing m2_3,missing m0_3)) s2.test(M3)`);
        t('m0m1m2m3', `${s} s2.put2(m0 m1 m2 m3)
          s2.test(M3 m0 m1 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0m1m2m3_invalid_m0', `${s} s2.put2(m0:m1 m1 m2 m3 err(invalid M3))
          s2.test(M3)`);
        t('m0_1m2m3', `${s} s2.put2(m0_1 m2 m3)
          s2.test(M3 m2 m3 m0_1 m2_3 m0_3)`);
        t('m0_1m2m3_invalid_m0_1', `${s} s2.put2(m0_1:m0 m2 m3 err(invalid M3))
          s2.test(M3)`);
        // XXX: add test for sig/d insert + invalid
      });
      describe('top_M4', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M4)
          s2.test(M4)`;
        t('m0_3m4', `${s} s2.put2(m0_3 m4) s2.test(M4 m4 m0_3)`);
        t('m0_3m4_invalid_m0_3', `${s} s2.put2(m0_3:m0 m4 err(invalid M4))
          s2.test(M4)`);
        t('m0_3m4_invalid_m4', `${s} s2.put2(m0_3 m4:m3 err(invalid M4))
          s2.test(M4)`);
        // XXX: add test for sig/d insert + invalid
      });
      describe('top_M31', ()=>{
        let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M31)
          s2.test(M31)`;
        t('m0_15m16_23m24_27m28_29m30m31', `${s}
          s2.put2(m0_15 m16_23 m24_27 m28_29 m30 m31) s2.test(M31 m30 m31 m0_15
          m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_invalid_m0_15', `${s}
          s2.put2(m0_15:m0 m16_23 m24_27 m28_29 m30 m31 err(invalid M31))
          s2.test(M31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d30_sig30', `${s}
          s2.put2(d30 sig30 m0_15 m16_23 m24_27 m28_29 m30 m31)
          s2.test(sig30 d30 M31 m30 m31 m0_15 m16_23 m24_27 m28_29 m28_31
          m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d30_sig30_invalid_sig30', `${s}
          s2.put2(d30 sig30:sig31 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(invalid sig30)) s2.test(M31 m30 m31 m0_15 m16_23 m24_27 m28_29
          m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d31_sig31', `${s}
         s2.put2(d31 sig31 m0_15 m16_23 m24_27 m28_29 m30 m31)
         s2.test(sig31 d31 M31 m30 m31 m0_15
         m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('m0_15m16_23m24_27m28_29m30m31_d31_sig31_invalid_sig31', `${s}
          s2.put2(d31 sig31:sig30 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(invalid sig31)) s2.test(M31 m30 m31 m0_15 m16_23 m24_27 m28_29
          m28_31 m30_31 m24_31 m16_31 m0_31)`);
        t('seq_29_missing', `${s}
          s2.put2(d29 sig29 m0_15 m16_23 m24_27 m28_29 m30 m31
          err(missing m28,missing m28_29,missing m28_31,missing m24_31,
          missing m16_31,missing m0_31))
          s2.test(M31 m30 m31 m0_15 m16_23 m24_27 m28_29 m28_31
          m30_31 m24_31 m16_31 m0_31)`);
        t('seq_29_missing', `${s}
          s2.put2(d29 sig29 m0_15 m16_23 m24_27 m28 m30 m31)
          s2.test(sig29 d29 M31 m28 m29 m30 m31 m0_15
          m16_23 m24_27 m28_29 m28_31 m30_31 m24_31 m16_31 m0_31)`);
      });
    });
    // XXX: rm
    describe('M0.put', ()=>{
      // XXX: test with prev_scroll
      // XXX make last used cmd default and last used arg default
      let prev, s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M0:s.M0)
        s2.test(M0)`;
      t('m0', `${s} s2.put(m0) s2.test(M0 m0)`);
      t('m0_err', `${s} s2.put(m0:m1 err(invalid M)) s2.test(M0)`);
      t('d0', `${s} s2.put(d0 sig0) s2.test(M0 d0 sig0 m0)`);
      t('d0_err', `${s} s2.put(d0 sig0:sig1 err(invalid sig0)) s2.test(M0)`);
      t('d1', `${s} s2.put(d1 sig1) s2.test(M0 d1 sig1 m1)`);
      t('d1_m0', `${s} s2.put(m0 d1 sig1) s2.test(M0 m0 m0_1 d1 sig1 m1 M1)`);
      t('d1_err', `${s} s2.put(d1 sig1:sig0 err(invalid sig1)) s2.test(M0)`);
      t('d2', `${s} s2.put(m0 m1 d2 sig2)
        s2.test(M0 m0 m0_1 M1 m1 M2 d2 sig2 m2)`);
      t('d2_m0_1', `${s} s2.put(m0 m1 m0_1 d2 sig2)
        s2.test(M0 m0 m0_1 M1 m1 M2 d2 sig2 m2)`);
      t('d2_missing_v1', `${s} s2.put(m1 d2 sig2) s2.test(M0)`);
      t('d2_missing_v2', `${s} s2.put(m0 m0_1 d2 sig2) s2.test(M0 m0)`);
      t('d2_err_m0', `${s} s2.put(m0:m1 m1 d2 sig2 err(invalid M))
        s2.test(M0)`);
      t('d2_err', `${s} s2.put(m0 m1 d2 sig2:sig0 err(invalid sig2))
        s2.test(M0 m0)`);
      t('d3', `${s} s2.put(m0 m1 m2 d3 sig3)
        s2.test(M0 m0 m0_1 m0_3 m1 m2 m2_3 d3 sig3 M2 m3 M3)`);
      t('d3_err_m0', `${s} s2.put(m0:m1 m1 m2 d3 sig3 err(invalid M))
        s2.test(M0)`);
      t('d3_err_m1', `${s} s2.put(m0 m1:m0 m2 d3 sig3 err(invalid sig3))
        s2.test(M0 m0)`);
      t('d3_missing_m1', `${s} s2.put(m0 m0_1 m2 d3 sig3) s2.test(M0 m0)`);
      t('d3_d4', `${s} s2.put(m0 m1 m2 d3 sig3 d4 sig4)
        s2.test(M0 m0 m0_1 m0_3 m1 m2 m2_3 d3 sig3 M2 m3 M3 M4 d4 sig4 m4)`);
      t('d3_then_d4', `${s} s2.put(m0 m1 m2 d3 sig3) s2.put(d4 sig4)
        s2.test(M0 m0 m0_1 m0_3 m1 m2 m2_3 d3 sig3 M2 m3 M3 M4 d4 sig4 m4)`);
      // XXX: need d3 missing/errors tests
      // XXX: add ^ for redudnat information
      t('d4', `${s} s2.put(m0 m1 m2_3 d4 sig4)
        s2.test(M0 m0 m1 m0_1 m2_3 m0_3 M3 M4 d4 sig4 m4)`);
      t('d4_err_m0', `${s} s2.put(m0:m1 m1 m2_3 d4 sig4 err(invalid M))
        s2.test(M0)`);
      t('d4_err_m1', `${s} s2.put(m0 m1:m0 m2_3 d4 sig4 err(invalid sig4))
        s2.test(M0 m0)`);
      t('d4_missing_m2_3', `${s} s2.put(m0 m1 d4 sig4) s2.test(M0 m0)`);
      t('d4_then_d3', `${s} s2.put(m0 m1 m2_3 d4 sig4) s2.put(m2 d3 sig3)
        s2.test(M0 m0 m1 m0_1 M2 m2 M3 d3 sig3 m3 m2_3 m0_3 M3 M4 d4 sig4 m4)
      `);
      t('d4_then_d3_err_m2', `${s} s2.put(m0 m1 m2_3 d4 sig4)
        s2.put(m2:m1 d3 sig3 err(invalid sig3))
        s2.test(M0 m0 m1 m0_1 m2_3 m0_3 M3 M4 d4 sig4 m4)`);
      t('d4_then_d1', `${s} s2.put(m0 m1 m2_3 d4 sig4) s2.put(d1 sig1)
        s2.test(M0 m0 M1 m1 m0_1 d1 sig1 m2_3 m0_3 M3 M4 d4 sig4 m4)`);
      t('d4_then_d3_missing_m2', `${s} s2.put(m0 m1 m2_3 d4 sig4)
        s2.put(d3 sig3) s2.test(M0 m0 m1 m0_1 m2_3 m0_3 M3 M4 d4 sig4 m4)`);
      // XXX BUG: m2/m3 were not inserted
      t('d4_then_m2m3', `${s} s2.put(m0 m1 m2_3 d4 sig4) s2.put(m2 m3)
        s2.test(M0 m0 m1 m0_1 m2_3 m0_3 M3 M4 d4 sig4 m4)`);
      t('d8', `${s} s2.put(m0 m1 m2_3 m0_3 m4_7 m0_7 d8 sig8)
        s2.test(M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 M7 M8 d8 sig8 m8)`);
      t('d8_then_d4', `${s} s2.put(m0 m1 m2_3 m0_3 m4_7 m0_7 d8 sig8)
        s2.test(${prev='M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 M7 M8 d8 sig8 m8'})
        s2.put(d4 sig4) s2.test(${prev=prev+' M3 d4 sig4 m4'})`);
      t('d8_then_d5', `${s} s2.put(m0 m1 m2_3 m0_3 m4_7 m0_7 d8 sig8)
        s2.test(${prev='M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 M7 M8 d8 sig8 m8'})
        s2.put(d5 sig5 m4) s2.test(${prev=prev+' M4 m4 d5 sig5 m5'})`);
      t('d8_then_d5_err_m4', `${s} s2.put(m0 m1 m2_3 m0_3 m4_7 m0_7 d8 sig8)
        s2.test(${prev='M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 M7 M8 d8 sig8 m8'})
        s2.put(d5 sig5 m4:m3 err(invalid sig5)) s2.test(${prev})`);
      // XXX: need d4 missing/errors tests
      t('d32', `${s} s2.put(m0 m1 m2_3 m0_3 m4_7 m0_7 m8_15 m16_31 d32 sig32)
        s2.test(M0 m0 m1 m0_1 m2_3 m0_3 m4_7 m0_7 m8_15 m0_15 m16_31 m0_31
        M31 M32 d32 sig32 m32)`);
      t('d32_err_m0', `${s} s2.put(m0:m1 m1 m2_3 m4_7 m0_7 m8_15 m16_31 d32
        sig32 err(invalid M)) s2.test(M0)`);
      t('d32_err_m1', `${s} s2.put(m0 m1:m0 m2_3 m4_7 m0_7 m8_15 m16_31 d32
        sig32 err(invalid sig32)) s2.test(M0 m0)`);
      t('d32_err_m2_3', `${s} s2.put(m0 m1 m2_3:m0 m4_7 m0_7 m8_15 m16_31 d32
        sig32 err(invalid sig32)) s2.test(M0 m0)`);
      t('d32_err_m4_7', `${s} s2.put(m0 m1 m2_3 m4_7:m0 m0_7 m8_15 m16_31 d32
        sig32 err(invalid sig32)) s2.test(M0 m0)`);
      t('d32_err_m8_15', `${s} s2.put(m0 m1 m2_3 m4_7 m0_7 m8_15:m0 m16_31 d32
        sig32 err(invalid sig32)) s2.test(M0 m0)`);
      t('d32_err_m16_31', `${s} s2.put(m0 m1 m2_3 m4_7 m0_7 m8_15 m16_31:m0 d32
        sig32 err(invalid sig32)) s2.test(M0 m0)`);
      t('d32_err_d32', `${s} s2.put(m0 m1 m2_3 m4_7 m0_7 m8_15 m16_31 d32:d0
        sig32 err(invalid sig32)) s2.test(M0 m0)`);
      t('d32_err_sig32', `${s} s2.put(m0 m1 m2_3 m4_7 m0_7 m8_15 m16_31 d32
        sig32:sig0 err(invalid sig32)) s2.test(M0 m0)`);
      t('d32_missing_m0', `${s} s2.put(m1 m2_3 m0_3 m4_7 m0_7 m8_15 m16_31 d32
        sig32) s2.test(M0)`);
      t('d32_missing_m2_3', `${s}
        s2.put(m0 m1 m0_3 m4_7 m0_7 m8_15 m16_31 d32 sig32) s2.test(M0 m0)`);
      // XXX derry: review test
      // XXX parallel etask
      // XXX using etask in class methods x
      // XXX: test also prev_scroll
    });
    describe('M1.put', ()=>{
      // XXX: test with prev_scroll
      let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M1)
        s2.test(M1)`;
      t('m0', `${s} s2.put(m0 m1) s2.test(M1 m0 m1 m0_1)`);
      t('m0_err_m0', `${s} s2.put(m0:m1 m1 err(invalid M)) s2.test(M1)`);
      t('m0_err_m1', `${s} s2.put(m0 m1:m0 err(invalid M)) s2.test(M1)`);
      t('m0_missing_m0', `${s} s2.put(m1) s2.test(M1)`);
      t('m0_missing_m1', `${s} s2.put(m0) s2.test(M1)`);
      if (0) // XXX TODO: and add for m0_1
      t('m0_1', `${s} s2.put(m0_1) s2.test(M1 m0_1)`);
      if (false){ // XXX
      t('d2', `${s} s2.put(d2 sig2) s2.test(M1 d2 sig2)`);
      t('d0', `${s} s2.put(d0 sig0 m1) s2.test(M1 d0 sig0)`);
      t('d1', `${s} s2.put(d1 sig1 m0 m0_1) s2.test(M1 d1 sig1)`);
      }
      t('branch1', `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M1)
        s2.put(m0 d1 sig1)
        s2.test(M0 M1 d1 sig1 m0 m0_1 m1)`);
      if (0) // XXX enable
      t('branch2', `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M1)
        s2.decl(2)
        s2.test(M1 sig2:s2.sig2 d2:s2.d2)
        s2.put(m0 d1 sig1 err(branch))
        s2.test(M0 M1 d1 sig1 m0 m0_1 m1) `);
// m0=hleaf(d0+sig0) sig0=sign(d0+prev_scroll1) M0=hroot(m0) M0=h(2+m0+0+1)
// m1=hleaf(d1+sig1) sig1=sign(d1+M0) M1=hroot(m0_1) M1=h(2+m0_1+0+2)
    });
    describe('M2.put', ()=>{
      let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M2:M2)
        s2.test(M2)`;
      t('m0', `${s} s2.put(m0 m1 m2) s2.test(M2 m0 m1 m0_1 m2)`);
      t('m1', `${s} s2.put(m0 m1 m2) s2.test(M2 m0 m1 m0_1 m2)`);
      t('m2', `${s} s2.put(m0_1 m2) s2.test(M2 m0_1 m2)`);
      t('m2_err_m2', `${s} s2.put(m0_1 m2:m1 err(invalid M)) s2.test(M2)`);
      t('m2_err_m0_1', `${s} s2.put(m0_1 m2:m1 err(invalid M)) s2.test(M2)`);
    });
    describe('M3.put', ()=>{
      let s = `s.scroll(!prev_scroll) s.decl(1-32) s2.scroll(M3:M3)
        s2.test(M3)`;
      t('m0', `${s} s2.put(m0 m1 m2_3) s2.test(M3 m0 m1 m0_1 m2_3 m0_3)`);
      t('m0_m2_3', `${s} s2.put(m0 m1 m2 m3)
        s2.test(M3 m0 m1 m0_1 m2 m2_3 m3 m0_3)`);
      t('m0_err_m0', `${s} s2.put(m0:m1 m1 m2_3 err(invalid M)) s2.test(M3)`);
      t('m0_err_m1', `${s} s2.put(m0 m1:m0 m2_3 err(invalid M)) s2.test(M3)`);
      t('m0_err_m2_3', `${s} s2.put(m0 m1 m2_3:m0 err(invalid M))
        s2.test(M3)`);
      t('m0_missing_m1', `${s} s2.put(m0 m2_3) s2.test(M3)`);
      t('m0_missing_m2_3', `${s} s2.put(m0 m1) s2.test(M3)`);
      t('m1', `${s} s2.put(m0 m1 m2_3) s2.test(M3 m0 m1 m0_1 m2_3 m0_3)`);
      t('m2', `${s} s2.put(m0_1 m2 m3) s2.test(M3 m0_1 m2 m3 m2_3 m0_3)`);
      t('m3', `${s} s2.put(m0_1 m2 m3) s2.test(M3 m0_1 m2 m3 m2_3 m0_3)`);
      t('d1', `${s} s2.put(m0 d1 sig1 m2_3)
        s2.test(M0 d1 sig1 M3 m0 m1 m0_1 m2_3 m0_3)`);
      // XXX: todo m4 and all data tests
    });
    if (true) return; // XXX WIP
    // XXX: make the last scroll used the default
    t('xxx', `s.scroll(def) decl(1-32) // s.decl
      s2.scroll(M0:s.M0)
      s2.put(1(m0_1:m0_1) 2(m2:m2) 3(m3:m3 M3:M3))
      s2.put(1(m0_1:m0_1) 2(m2:m2) 3(m3:m3 M3:M3) branch:ok)
      s2.put(1(m0_1:m0_1) 2(m2:m2) 3(sig3:sig3 M3:M3) fail(xxx missing...))
    `);
  });
});
