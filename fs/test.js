'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import xtest from '../util/test_lib.js';
import etask from '../util/etask.js';
import FS from './fs.js';
import {test_run, test_run_register_hook, new_scroll, get_scroll, get_def}
  from '../storage/test_cmd.js';

xtest.init();

const cmd_fs = t=>etask(function*cmd_fs(){
  let name = t.ctx||get_def('left');
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!get_scroll(name, true), 'scroll already exist '+name);
  assert(!t.r, 'invalid arg '+t.r);
  let db_opt;
  new_scroll(name, null, null, t.prev?.ctx, db_opt, null,
    function create_func(opt, d){ return FS.create(opt); },
    function open_func(){ assert.fail('XXX TODO fs.open_func'); });
});

const test_run_single = (curr, o)=>etask(function*_test_run_single(){
  switch (o.cmd){
  case 'fs': yield cmd_fs(o); break;
  default: return false;
  }
  return true;
});
test_run_register_hook(test_run_single);

describe('fs', ()=>{
  const t = (name, test)=>it(name, ()=>test_run(test));
  t('xxx', `s..fs`);
  return;
  // XXX: how to add blob
  // XXX: rm commit
  t('xxx1', `
    s..fs                           #seq0=... // XXX TODO
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
