'use strict'; /*jslint node:true*/ /*global describe,it,beforeEach,afterEach*/
// XXX: need jslint mocha: true
import assert from 'assert';
import xutil from '../util/util.js';
import xerr from '../util/xerr.js';

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

describe('basic', ()=>{
  it('test', ()=>{
    const t = ()=>{};
    t(`tree b=batch
      b.append(D0) b.commit
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
