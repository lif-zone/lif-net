'use strict'; /*jslint node:true*/ /*global describe,it,beforeEach,afterEach*/
// XXX: need jslint mocha: true
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';
import tparser from './test_parser.js';
import xtest from '../util/test_lib.js';
import etask from '../util/etask.js';
import crypto from '../util/crypto.js';
import xsinon from '../util/sinon.js';
import Scroll from './scroll.js';
const assign = Object.assign.bind(Object);

let t_scroll, t_keypair;

// XXX: make it automatic for all node/browser in proc.js
xerr.set_exception_catch_all(true);
process.on('uncaughtException', err=>xerr.xexit(err));
process.on('unhandledRejection', err=>xerr.xexit(err));
xerr.set_exception_handler('test', (prefix, o, err)=>xerr.xexit(err));

if (false && !xutil.is_inspect())
  beforeEach(function(){ xerr.set_buffered(true, 1000); });

afterEach(function(){
  if (this.currentTest.timedOut){
    xerr.notice(this.currentTest.err.stack);
    assert.fail(this.currentTest.fullTitle()+': FAILED TIMEOUT');
  }
  xerr.clear();
  xerr.set_buffered(false);
});

function test_start(){
  t_scroll = null;
  t_keypair = crypto.keypair();
  xsinon.clock_set({now: 0});
}

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

const cmd_scroll = o=>etask(function*cmd_scroll(){
  let prev_scroll, ts=Date.now();
  assert(!o.l && !o.r, o.cmd+' invalid arg '+o.meta.s);
  assert(!t_scroll, 'scroll already exists');
  t_scroll = yield Scroll.create({key: t_keypair.key, pub: t_keypair.pub,
    ts, prev_scroll}, {topic: 'test'});
});

const cmd_decl = o=>etask(function*cmd_decl(){
});

const test_run = test=>etask(function*test_run(){
  yield test_start();
  for (let curr=test, i=0; curr = tparser.parse_get_next(curr); i++){
    let o = tparser.parse_exp(curr.exp);
    xerr.notice('cmd %s %s', i, o.meta.s);
    switch (o.cmd){
    case 'scroll': yield cmd_scroll(o); break;
    case 'decl': yield cmd_decl(o); break;
    case '//': break;
    default: assert.fail('invalid cmd "'+o.cmd+'" in '+o.meta.s);
    }
  }
  yield test_end();
});

// implemented: transport of lif
// in progress: data structure of lif
// later: transport and storage of lif (mem<->net/db)
// 0.0 0.1 0.2 0.3 0.4 0.5
//     1.1 1.2
describe('basic', ()=>{
  describe('test', ()=>{
    // default test configuration
    // genesis_scroll(0 1) prev_scroll(based on genesis_scroll(1))
    // genesis_scroll = genesis_scroll0.1
    // prev_scroll = prev_scroll0.1
    const t = (name, test)=>it(name, ()=>test_run(test));
    t('scroll', `scroll`);
    t('simple', `
      // XXX TODO scroll(prev:prev_scroll1)
      // decl(1 2 3)
      // XXX rdecl(5) rdecl(1.5 err)
      // d0==A1234 sig0==B1234 m0==C1234
      // sig0==sign(d0+prev_scroll) m0==h(d0+sig0)
    `);
    if (true) return; // XXX WIP
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
