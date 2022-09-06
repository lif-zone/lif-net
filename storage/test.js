'use strict'; /*jslint node:true*/ /*global describe,it,beforeEach,afterEach*/
// XXX: need jslint mocha: true
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';
import tparser from './test_parser.js';
import xtest from '../util/test_lib.js'; // eslint-disable-line no-unused-vars
import etask from '../util/etask.js';
import crypto from '../util/crypto.js';
import xsinon from '../util/sinon.js';
import Scroll from './scroll.js';
import buf_util from '../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;
const assign = Object.assign.bind(Object);

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

function get_val(exp){
  let m;
  if (m = exp.match(/^sig(\d+)$/)) // sig10
    return t_scroll.seq_sig(m[1]);
  if (m = exp.match(/^m(\d+)$/)) // m10
    return t_scroll.seq_m(m[1]);
  if (m = exp.match(/^M(\d+)$/)) // M10
    return t_scroll.seq_M(m[1]);
  if (m = exp.match(/^M$/)) // M
    return t_scroll.seq_M();
  if (m = exp.match(/^d(\d+)$/)) // d10
    return t_scroll.seq_d(m[1]);
  if (m = exp.match(/^h\((.*)\+(.*)\)$/)) // h(d10+sig11)
    return Scroll.hash_concat(get_val(m[1]), get_val(m[2]));
  if (m = exp.match(/^sign\((.*)\+(.*)\)$/)){ // sign(d10+M9)
    return crypto.sign(Scroll.hash_concat(get_val(m[1]), get_val(m[2])),
      t_keypair.key);
  }
  if (m = exp.match(/^sign\((.*)\)$/)) // sign(d10)
    return crypto.sign(crypto.sha256(get_val(m[1])), t_keypair.key);
  if (m = exp.match(/^0x([0-9a-f]+)$/))
    return s2b(m[1]);
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
    pub: t_keypair.pub}, {scroll: {topic: 'genesis'}});
  yield t_genesis_scroll.decl('1');
  t_prev_scroll = yield Scroll.create({key: t_keypair.key,
    pub: t_keypair.pub, prev_scroll: t_genesis_scroll.seq_M(1)},
    {scroll: {topic: 'prev_scroll'}});
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
    switch(tt.cmd){
    case '!prev_scroll': prev_scroll = null; break;
    default: assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  t_scroll = yield Scroll.create({key: t_keypair.key, pub: t_keypair.pub,
    prev_scroll}, {scroll: {topic: 'test'}});
});

const cmd_decl = t=>etask(function*cmd_decl(){
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  assert(t_scroll, 'scroll not found');
  for (let curr=t.r, i=0; curr = tparser.parse_get_next(curr); i++)
    yield t_scroll.decl(curr.exp);
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

// implemented: transport of lif
// in progress: data structure of lif
// later: transport and storage of lif (mem<->net/db)
// 0.0 0.1 0.2 0.3 0.4 0.5
//     1.1 1.2
describe('scroll', ()=>{
  describe('decl', ()=>{
    const t = (name, test)=>it(name, ()=>test_run(test));
    t('no_prev_scroll', `scroll(!prev_scroll) decl(1)
      d0==0x8a74603fce8e81356c0d4d95b5e991d25f2e03974ff14c4caa6cae36bb9a7f87
      sig0==0x157bbdddd869ade81a1d55db89d3e011575ccc08e0c29aa1c7fbb27609b8886efc7afadc29570af1bac56a528af21cd30fae0c32ad2e474fff849c76f60e640f
      m0==0xd6c8e98ebf695b1709e5977b49746d9054154fe1ceafc7fc9203ba75c7f79519
      m0==h(d0+sig0) sig0==sign(d0) M0==m0
      m1==h(d1+sig1) sig1==sign(d1+M0) M1==h(m0+m1)
    `);
    t('with_prev_scroll', `scroll decl(1)
      d0==0x8a74603fce8e81356c0d4d95b5e991d25f2e03974ff14c4caa6cae36bb9a7f87
      sig0==0xb3e730b7199b547bfb43f3e0d30d49f811f0e53eece394c7091974c692afbd41957188d313ddc3ca63d6d7194f46d02ad8737e73e7f7d7d9b14ae0dba435cd0c
      m0==0xb6fd516305407a6e2a3ee5f1070f62a315f93c1456c76e0edd132c883cf2c709
      m0==h(d0+sig0) sig0==sign(d0+prev_scroll1) M0==m0
      m1==h(d1+sig1) sig1==sign(d1+M0) M1==h(m0+m1)
    `);
    if (true) return; // XXX WIP
    t('simple', `
      // XXX TODO scroll(prev:prev_scroll1)
      // decl(1 2 3)
      // XXX rdecl(5) rdecl(1.5 err)
      // d0==A1234 sig0==B1234 m0==C1234
      // sig0==sign(d0+prev_scroll) m0==h(d0+sig0)
    `);
    t(`scroll decl(1 2 3) rdecl(5) rdecl(1.5 err)`);
    t(`scroll decl(1 2 3) rdecl(5) rdecl(1.5 err)`);
    t(`scroll(prev:prev_scroll1) decl(1 2 3) // XXX rdecl(5) rdecl(1.5 err)
      d0==A1234 sig0==B1234 m0==C1234
      sig0==sign(d0+prev_scroll) m0==h(d0+sig0)
      sig1==sign(d1) m0=h(d
    `);
    t(`tree append(D0)
      h0==A1234 sig0==B1234 m0==C1234
      m0==h(d0+sig0) sig0==sign(d0) m0==h(d0+sig0) t#tree(sz:1 mroot:m0)
      b.append(D1) b.commit
      m1==h(d1+sig1) sig1==sign(d1+sig1) m1==h(d0+sig0) M1==hroot(m1 m0-1))
      t#tree(sz:2 mroot:M1)
    `);
    t(`tree(sz:10) c=tree p=t.proof(8-10) b=c.clone(p) b.commit
      c#node(8 data:D8) c#node(9 data:D9) c#node(10 data:D10)
      c#tree(sz:10 avail:3 mroot:M10)
    `);
  });
/* XXX: rm
test('nodes', async function (t) {
  const tree = await create()

  const b = tree.batch()

  for (let i = 0; i < 8; i++) {
    b.append(Buffer.from([i]))
  }

  b.commit()

  t.is(await tree.nodes(0), 0)
})
*/
});
