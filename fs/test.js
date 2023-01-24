'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import xtest from '../util/test_lib.js';
import etask from '../util/etask.js';
import {Buffer} from 'buffer';
import FS from './fs.js';
import tparser from '../storage/test_parser.js';
const {parse_get_next, parse_exp, parse_exp_arg, rm_parentesis} = tparser;
import {test_run, test_run_register_hook, new_scroll, get_scroll, get_def,
  test_register_get_seq} from '../storage/test_cmd.js';

xtest.init();

let t_buf = {}; // XXX: reset on test_start

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

const cmd_add = t=>etask(function*cmd_add(){
  let name = t.ctx||get_def('left'), fs = get_scroll(name), dir, file, buf;
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    if (/^buf/.test(tt.cmd)){
      buf = t_buf[tt.r];
      assert(buf, 'buf not found '+tt.r);
    } else {
      assert(!dir && !file, 'invalid arg '+tt.cmd+' in '+t.meta.s);
      if (FS.valid_dir(tt.cmd))
        dir = tt.cmd;
      else if (FS.valid_file(tt.cmd))
        file = tt.cmd;
      else
        assert.fail('invalid file/dir '+tt.cmd);
    }
  }
  if (file)
    yield fs.add_file(file, buf);
  else
    yield fs.add_dir(dir);
});

const cmd_buf = t=>etask(function*cmd_buf(){
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  let name, val;
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    if (!name){
      name = tt.cmd;
      continue;
    }
    switch (tt.cmd){
    case 'val': val = tt.r; break;
    default: assert.fail('invalid arg '+tt.cmd);
    }
  }
  t_buf[name] = Buffer.from(val);
});

const test_run_single = (curr, o, step)=>etask(function*_test_run_single(){
  switch (o.cmd){
  case 'fs': yield cmd_fs(o); break;
  case 'add': yield cmd_add(o); break;
  case 'buf': yield cmd_buf(o); break;
  default: return false;
  }
  return true;
});
test_run_register_hook(test_run_single);

const get_seq = s=>etask(function*get_seq(){
  let bo = {};
  s = rm_parentesis(s, '{');
  for (let curr=s; curr = parse_get_next(curr);){
    let o = parse_exp(curr.exp);
    // XXX yield get_val(o.r);
    if (o.l=='f2')
      bo[o.l] = t_buf[o.r];
    else
      bo[o.l] = o.r;
  }
  return bo;
});
test_register_get_seq(get_seq);

describe('fs', ()=>{
  const t = (name, test)=>it(name, ()=>test_run(test));
  t('dir', `s..#seq
    s..fs          #seq0={} // XXX: todo
    add(/)         #seq1={op:add dir:/}
    add(/d/)       #seq2={op:add dir:/d/}
    add(/d/dd/)    #seq3={op:add dir:/d/dd/}
    add(/d/dd2/)   #seq4={op:add dir:/d/dd2/}
    add(/d2/)      #seq5={op:add dir:/d2/}
    add(/d2/d2d/)  #seq6={op:add dir:/d2/d2d/}
    add(/d2/d2d2/) #seq7={op:add dir:/d2/d2d2/}`);
  describe('file', ()=>{
    // XXX: support buf(b:123 b2:1234)
    t('basic', `s..#seq buf(b1 val:0) buf(b2 val:1)
      s..fs           #seq0={} // XXX: todo
      add(/f1 buf:b1) #seq1={op:add file:/f1 f2:b1}
      add(/f2 buf:b2) #seq2={op:add file:/f2 f2:b2}`);
    if (0) // XXX WIP
    t('diff', `s..#seq buf(b1 val:0123456789) buf(b2 val:01234567890)
      buf(bdiff val:xxx)
      s..fs           #seq0={} // XXX: todo
      add(/f1 buf:b1) #seq1={op:add file:/f1 f2:b1}
      mod(/f1 buf:b2) #seq2={op:add file:/f1 link:1 diff:1 f2:bdiff}`);
    t('link', `s..#seq buf(b1 val:0)
      s..fs           #seq0={} // XXX: todo
      add(/f1 buf:b1) #seq1={op:add file:/f1 f2:b1}
      add(/f2 buf:b1) #seq2={op:add file:/f2 link:1}`);
  });
  return;
  // XXX: how to add blob
  // XXX: rm commit
  t('xxx1', `
    s..fs                           #seq0=... // XXX TODO
    add(/)                          #seq1={op:add dir:/}
    add(/f1 blob1)                  #seq2={op:add file:/f1 F2=blob1}
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
