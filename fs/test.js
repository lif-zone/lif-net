'use strict'; /*eslint-env mocha*/
import proc from '../util/proc.js';
// XXX xtest.init()
import xtest from '../util/test_lib.js'; // eslint-disable-line no-unused-vars

proc.init();

it('xxx', ()=>{
  const t = ()=>{};
  // XXX: how to add blob
  // XXX: rm commit
  t('xxx1', `
    s..scroll(topic:fs)             #seq0=... // XXX TODO
    add(/)                          #seq1={op:add dir:/}
    add(/f1 blob1)                  #seq2={op:add file:/f1} D2F2=blob1
    commit                          #seq3={group:2 op:commit} // XXX: needed?
    add(/f2 blob1)                  #seq4={op:add link:2)
    commit                          #seq5={group:1 op:commit}
    mod(/f2 content:1)              #seq6={op:mod content:1}
    commit                          #seq7={group:1 op:commit}
    tag(t1 seq:5)                   #seq8={link:5}
    add(/f3 branch:b prev:3 blob1)  #seq9={op:add branch:b prev:3 bseq:3-1.0
                                      file:/f3 link:2}
    commit                          #seq10={bseq:3-1.1 group:1 op:commit}
    mod(/f1 prev:7 blob2)           #seq11={prev:7 bseq:8 file:/f1} D11F2=blob2
  `);
});
// XXX: change default hash to sha256
