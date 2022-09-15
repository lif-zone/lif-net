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
import xsinon from '../util/sinon.js';
import Scroll from './scroll.js';
import buf_util from '../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;
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
    assert.equal(b2s(a), b2s(b), 'failed '+meta.s);
  else
    assert.equal(a, b, 'failed '+meta.s);

}

const calc_m = (scroll, s, e)=>etask(function*calc_m(){
  assert(Number.isInteger(Math.log2(e-s+1)), 'invalid merkel range '+s+'_'+e);
  let q = [];
  for (let i=s; i<=e; i++)
    q.push({s: i, e: i, m: yield scroll.m_hash(i)});
  while (q.length!=1){
    let q2 = [];
    for (let i=0; i<q.length/2; i++){
      q2.push({s: q[2*i].s, e: q[2*i+1].e,
        m: Scroll.hconcat([Scroll.PARENT_TYPE,
        enc.encode(enc.uint64, q[2*i+1].e-q[2*i].s+1),
        q[2*i].m, q[2*i+1].m])});
    }
    q = q2;
  }
  assert.equal(b2s(yield scroll.m_hash([s, e])), b2s(q[0].m));
  return q[0].m;
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
    return Scroll.hconcat(a);
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
  let name = t.ctx||'s', M0, scroll;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!t_scroll[name], 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case '!prev_scroll': prev_scroll = null; break;
    case 'M0': M0 = yield get_val(tt.r); break;
    default: assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  if (M0)
   scroll = yield Scroll.open({pub: t_keypair.pub, M0});
  else {
    scroll = yield Scroll.create({key: t_keypair.key, pub: t_keypair.pub,
        prev_scroll}, {topic: 'test'});
  }
  t_scroll[name] = scroll;
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
        yield scroll.decl(''+j);
    } else
      yield scroll.decl(curr.exp);
  }
});

const cmd_push = t=>etask(function*cmd_push(){
  let name = t.ctx||'s', scroll = t_scroll[name];
  let diff = {seq: {}}, err;
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg(curr.exp);
    assert(!t2.l, 'invalid push exp '+curr.exp);
    if (t2.cmd=='err'){
      assert(!err, 'err already defined');
      err = t2.r||true;
      continue;
    }
    let val = yield get_val(t2.r||t2.cmd);
    let m = t2.cmd.match(/^([a-zA-Z]+)(\d+)$/);
    assert.equal(m?.length, 3, 'invalid push exp '+curr.exp);
    let type = m[1], seq = +m[2];
    let seq_o = diff.seq[seq] = diff.seq[seq]||{};
    assert(['sig', 'd', 'm'].includes(type), 'invalid type '+type);
    seq_o[type] = val;
  }
  // xerr('XXX push %s %s', name, JSON.stringify(diff));
  // XXX diff:
  // {seq: {7: {M, sig, d, D, m: {7:0xa, 6:0xb, 4:0xc, 0:0xd}}, 8:{}}}
  try {
    yield scroll.push(diff);
    assert(!err, 'missing error '+err);
  }
  catch(e){ assert.equal(''+e, 'Error: '+err, 'error mismatch'); }
});

const cmd_test = t=>etask(function*cmd_test(){
  let name = t.ctx||'s';
  for (let curr=t.r; curr = tparser.parse_get_next(curr);){
    let t2 = tparser.parse_exp_arg(curr.exp);
    assert(!t2.l, 'invalid test exp '+curr.exp);
    let exp = yield get_val(t2.r||t2.cmd);
    let val = yield get_val(name+'.'+t2.cmd);
    assert_buffer(val, exp, t2.meta);
    // xerr('XXX val %s exp %s', val, exp);
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
  case 'push': yield cmd_push(o); break;
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
        roots.forEach(o=>{
          assert.equal(o.s==o.e ? ''+o.s : o.s+'_'+o.e, o.name);
          a.push(o.name);
        });
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
    describe('push', ()=>{
      // XXX: test with prev_scroll
      let s = 's.scroll(!prev_scroll) s.decl(1) s2.scroll(M0:s.M0)';
      // XXX: test that all rest is null
      t('sig0_d0', `${s} s2.push(sig0 d0)
        s2.test(M0) // XXX  sig0:s.sig0 d0:s.d0)`);
      t('sig0_d0_err1', `${s} s2.push(sig0 d0:d1 err(invalid sig0))`);
      t('sig0_d0_err2', `${s} s2.push(sig0:sig1 d0:d0 err(invalid sig0))`);
      t('m0', `${s} s2.push(m0)`);
      if (true) return; // XXX WIP
      // XXX derry: review test
      // XXX push(0(sig:sig0)) => push(sig0:sig0) or push(sig0:sig1)
      // == push(sig0:s.sig0) or push(sig0:s.sig1)
      // XXX diff format
      // XXX parallel etask
      // XXX using etask in class methods x
      // XXX: test also prev_scroll
      t('sig_ok', `${s} s2.push(sig0 d0) s2.test(0 M0 sig0 d0 m0)`);
      t('sig_err', `${s} s2.push(sig0:sig1 d0) err(invalid sig0))
        s2.test(0 M0)`);
      t('sig_err2', `${s} s2.push(0(sig0 d1) err(invalid sig0))
        s2.test(0 M0)`);
    });
    if (true) return; // XXX WIP
    // XXX: make the last scroll used the default
    t('xxx', `s.scroll(def) decl(1-32) // s.decl
      s2.scroll(M0:s.M0)
      s2.push(1(m0_1:m0_1) 2(m2:m2) 3(m3:m3 M3:M3))
      s2.push(1(m0_1:m0_1) 2(m2:m2) 3(m3:m3 M3:M3) branch:ok)
      s2.push(1(m0_1:m0_1) 2(m2:m2) 3(sig3:sig3 M3:M3) fail(xxx missing...))
    `);
  });
});
