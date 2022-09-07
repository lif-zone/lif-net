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
const assign = Object.assign.bind(Object);
function enc_u64(v){ return enc.encode(enc.uint64, v); }

let t_scroll, t_genesis_scroll, t_prev_scroll, t_keypair;

// XXX: make it automatic for all node/browser in proc.js
xerr.set_exception_catch_all(true);
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

function calc_m(s, e){
  assert(Number.isInteger(Math.log2(e-s+1)), 'invalid merkel range '+s+'_'+e);
  let q = [];
  for (let i=s; i<=e; i++)
    q.push({s: i, e: i, m: t_scroll.seq_m(i)});
  while (q.length!=1){
    let q2 = [];
    for (let i=0; i<q.length/2; i++){
      q2.push({s: q[2*i].s, e: q[2*i+1].e,
        m: Scroll.hash_concat([Scroll.PARENT_TYPE,
        enc.encode(enc.uint64, q[2*i+1].e-q[2*i].s+1),
        q[2*i].m, q[2*i+1].m])});
    }
    q = q2;
  }
  assert.equal(b2s(t_scroll.seq_m(s+'_'+e)), b2s(q[0].m));
  return q[0].m;
}

function get_val(exp){
  let m;
  if (m = exp.match(/^sig(\d+)$/)) // sig10
    return t_scroll.seq_sig(m[1]);
  if (m = exp.match(/^m(\d+)$/)) // m10
    return t_scroll.seq_m(m[1]); // XXX: calc and assert it match data hash
  if (m = exp.match(/^m(\d+)_(\d+)$/)) // m0_1
    return calc_m(+m[1], +m[2]);
  if (m = exp.match(/^M(\d+)$/)) // M10
    return t_scroll.seq_M(m[1]);
  if (m = exp.match(/^M$/)) // M
    return t_scroll.seq_M();
  if (m = exp.match(/^d(\d+)$/)) // d10
    return t_scroll.seq_d(m[1]);
  if (m = exp.match(/^h\((.*)\)$/)){ // h(d10+sig11)
    let a=[];
    m[1].split('+').forEach(v=>a.push(get_val(v)));
    return Scroll.hash_concat(a);
  }
  if (m = exp.match(/^hleaf\((.*)\)$/)){
    let a=[Scroll.LEAF_TYPE];
    m[1].split('+').forEach(v=>a.push(get_val(v)));
    return Scroll.hash_concat(a);
  }
  if (m = exp.match(/^hroot\((.*)\)$/)){
    let a=[Scroll.ROOT_TYPE];
    m[1].split('+').forEach(v=>{
      let r = Scroll.parse_seq_range(v.replace('m', ''));
      a.push(get_val(v));
      a.push(enc_u64(r.seq));
      a.push(enc_u64(r.seq2-r.seq+1));
    });
    return Scroll.hash_concat(a);
  }

  if (m = exp.match(/^sign\((.*)\+(.*)\)$/)){ // sign(d10+M9)
    return crypto.sign(Scroll.hash_concat([get_val(m[1]), get_val(m[2])]),
      t_keypair.key);
  }
  if (m = exp.match(/^sign\((.*)\)$/)) // sign(d10)
    return crypto.sign(crypto.blake2b(get_val(m[1])), t_keypair.key);
  if (m = exp.match(/^0x([0-9a-f]+)$/))
    return s2b(m[1]);
  if (/^\d+$/.test(exp))
    return enc.encode(enc.uint64, +exp);
  if ('prev_scroll1'==exp)
    return t_prev_scroll.seq_M(1);
  assert.fail('invalid val exp '+exp);
}

const test_start = ()=>etask(function*test_start(){
  t_scroll = null;
  t_keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef75'+
    'ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
      'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  xsinon.clock_set({now: 0});
  t_genesis_scroll = yield Scroll.create({key: t_keypair.key,
    pub: t_keypair.pub}, {topic: 'genesis'});
  yield t_genesis_scroll.decl('1');
  t_prev_scroll = yield Scroll.create({key: t_keypair.key,
    pub: t_keypair.pub, prev_scroll: t_genesis_scroll.seq_M(1)},
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
      assign({}, exp, {meta: {s: s.trim()}}));
    t(' a ', {cmd: 'a', l: '', r: ''});
    t('a(b)', {cmd: 'a', l: '', r: 'b'});
    t('a(b c)', {cmd: 'a', l: '', r: 'b c'});
    t('a(b+c)', {cmd: 'a', l: '', r: 'b+c'});
    t('a(b==c)', {cmd: 'a', l: '', r: 'b==c'});
    t('a==b', {cmd: '==', l: 'a', r: 'b'});
    t('a:b', {cmd: ':', l: 'a', r: 'b'});
    t('a=b', {cmd: '=', l: 'a', r: 'b'});
    t('a+b', {cmd: '+', l: 'a', r: 'b'});
    t('a=b(2)', {cmd: '=', l: 'a', r: 'b(2)'});
    t('a(1)==b(2)', {cmd: '==', l: 'a(1)', r: 'b(2)'});
    t('a1==b(c+d)', {cmd: '==', l: 'a1', r: 'b(c+d)'});
    t('//', {cmd: '//', l: '', r: ''});
    t('// XXX', {cmd: '//', l: '', r: 'XXX'});
  });
  // XXX: test invalid parsing
});

const cmd_scroll = t=>etask(function*cmd_scroll(){
  let prev_scroll = t_prev_scroll.seq_M(1);
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!t_scroll, 'scroll already exists');
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let tt = tparser.parse_exp(curr.exp);
    switch (tt.cmd){
    case '!prev_scroll': prev_scroll = null; break;
    default: assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  t_scroll = yield Scroll.create({key: t_keypair.key, pub: t_keypair.pub,
    prev_scroll}, {topic: 'test'});
});

const cmd_decl = t=>etask(function*cmd_decl(){
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  assert(t_scroll, 'scroll not found');
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++){
    let m=curr.exp.match(/^(\d+)-(\d+)$/);
    if (m){
      for (let j=+m[1]; j<=+m[2]; j++)
        yield t_scroll.decl(''+j);
    } else
      yield t_scroll.decl(curr.exp);
  }
});

function cmd_eq(o){
  assert(o.l, 'missing left '+o.meta.s);
  assert(o.r, 'missing right '+o.meta.s);
  let l = get_val(o.l);
  let r = get_val(o.r);
  if (Buffer.isBuffer(l) && Buffer.isBuffer(r))
    assert.equal(b2s(l), b2s(r), 'failed '+o.meta.s);
  else
    assert.equal(l, r, 'failed '+o.meta.s);
}

const test_run = test=>etask(function*test_run(){
  yield test_start();
  for (let curr=test, i=0; curr = tparser.parse_get_next(curr); i++){
    let t = tparser.parse_exp(curr.exp);
    xerr.notice('cmd %s %s', i, t.meta.s);
    switch (t.cmd){
    case 'scroll': yield cmd_scroll(t); break;
    case 'decl': yield cmd_decl(t); break;
    case '//': break;
    case '==': yield cmd_eq(t); break;
    default: assert.fail('invalid cmd "'+t.cmd+'" in '+t.meta.s);
    }
  }
  yield test_end();
});

describe('scroll', ()=>{
  describe('util', ()=>{
    it('parse_seq_range', ()=>{
      const t = (val, exp)=>assert.deepEqual(Scroll.parse_seq_range(val), exp);
      t('1', {seq: '1', seq2: '1'});
      t('10', {seq: '10', seq2: '10'});
      t('10_100', {seq: '10', seq2: '100'});
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
    t('no_prev_scroll', `scroll(!prev_scroll) decl(1) sig0==${sig0}
      d0==0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
      m0==0xa0d3dfd96822872daa1351808936ebce919fd82f3af2a14abbac987446d48017
      m0==hleaf(d0+sig0) sig0==sign(d0) M0==hroot(m0)
      m1==hleaf(d1+sig1) sig1==sign(d1+M0) M1==hroot(m0_1)`);
    sig0 = '0xb34dd640e4fb8f08593c91840b1175d1014a96a9e211b5f790a3639809135a3'+
      'c26a4f98b3c7798566d7241e4f7a9e97d99b2d7e075ec1e1f4e71a28e3c0dba0c';
    t('with_prev_scroll', `scroll decl(1) sig0==${sig0}
      d0==0x750e42c4c40d2914db1fd0cdfa2ea853d00b468d78f23df882fe9cc1839b71b8
      m0==0x0d7b0519668a3c03ba5b206d8dd92846fdb00b282d35d4b5c0a29bd230489eee
      m0==hleaf(d0+sig0) sig0==sign(d0+prev_scroll1) M0==hroot(m0)
      m1==hleaf(d1+sig1) sig1==sign(d1+M0) M1==hroot(m0_1)`);
    // XXX branch support
    t('merkel', `scroll decl(1-32)
      m0==hleaf(d0+sig0) sig0==sign(d0+prev_scroll1) M0==hroot(m0)
      M0==h(2+m0+0+1)
      m1==hleaf(d1+sig1) sig1==sign(d1+M0) M1==hroot(m0_1) M1==h(2+m0_1+0+2)
      m2==hleaf(d2+sig2) sig2==sign(d2+M1) M2==hroot(m0_1+m2)
      M2==h(2+m0_1+0+2+m2+2+1)
      m3==hleaf(d3+sig3) sig3==sign(d3+M2) M3==hroot(m0_3)
      m4==hleaf(d4+sig4) sig4==sign(d4+M3) M4==hroot(m0_3+m4)
      m5==hleaf(d5+sig5) sig5==sign(d5+M4) M5==hroot(m0_3+m4_5)
      m6==hleaf(d6+sig6) sig6==sign(d6+M5) M6==hroot(m0_3+m4_5+m6)
      m7==hleaf(d7+sig7) sig7==sign(d7+M6) M7==hroot(m0_7)
      m8==hleaf(d8+sig8) sig8==sign(d8+M7) M8==hroot(m0_7+m8)
      m9==hleaf(d9+sig9) sig9==sign(d9+M8) M9==hroot(m0_7+m8_9)
      m10==hleaf(d10+sig10) sig10==sign(d10+M9) M10==hroot(m0_7+m8_9+m10)
      m11==hleaf(d11+sig11) sig11==sign(d11+M10) M11==hroot(m0_7+m8_11)
      m15==hleaf(d15+sig15) sig15==sign(d15+M14) M15==hroot(m0_15)
      m16==hleaf(d16+sig16) sig16==sign(d16+M15) M16==hroot(m0_15+m16)
      m30==hleaf(d30+sig30) sig30==sign(d30+M29)
        M30==hroot(m0_15+m16_23+m24_27+m28_29+m30)
      m31==hleaf(d31+sig31) sig31==sign(d31+M30) M31==hroot(m0_31)
      m32==hleaf(d32+sig32) sig32==sign(d32+M31) M32==hroot(m0_31+m32)
    `);
  });
});
