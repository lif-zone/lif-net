'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import xtest from '../util/test_lib.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import {Buffer} from 'buffer';
import FS from './fs.js';
import tparser from '../storage/test_parser.js';
import DiffMatchAndPath from 'diff-match-patch';
const Diff = new DiffMatchAndPath();
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
      assert(!file && !dir, 'invalid arg '+tt.cmd+' in '+t.meta.s);
      if (FS.valid_dir(tt.cmd))
        dir = tt.cmd;
      else if (FS.valid_file(tt.cmd))
        file = tt.cmd;
      else
        assert.fail('invalid file/dir '+tt.cmd);
    }
  }
  assert(file||dir, 'missing file/dir');
  if (file)
    yield fs.add_file(file, buf);
  else
    yield fs.add_dir(dir);
});

const cmd_mod = t=>etask(function*cmd_mod(){
  this.on('uncaught', e=>xerr.xexit(e)); // XXX: need xtest.etask
  let name = t.ctx||get_def('left'), fs = get_scroll(name), file, buf;
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    if (/^buf/.test(tt.cmd)){
      buf = t_buf[tt.r];
      assert(buf, 'buf not found '+tt.r);
    } else {
      assert(!file, 'invalid arg '+tt.cmd+' in '+t.meta.s);
      file = tt.cmd;
      assert(FS.valid_file(file), 'invalid file '+file);
    }
  }
  assert(FS.valid_file(file), 'missing file');
  yield fs.mod_file(file, buf);
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
  t_buf[name] = Buffer.from(val+'\n');
});

const test_run_single = (curr, o, step)=>etask(function*_test_run_single(){
  switch (o.cmd){
  case 'fs': yield cmd_fs(o); break;
  case 'add': yield cmd_add(o); break;
  case 'mod': yield cmd_mod(o); break;
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
    if (o.l=='f2'){
      let oo = parse_exp(o.r), a;
      switch (oo.cmd){
      case 'diff':
        a = oo.r.split(',');
        assert(a.length==2, 'invalid diff '+o.r);
        bo[o.l] = Buffer.from(Diff.patch_toText(
          Diff.patch_make(t_buf[a[0]].toString(), t_buf[a[1]].toString())));
        break;
      default:
        assert(t_buf[o.r], 'buf not found '+o.r);
        bo[o.l] = t_buf[o.r];
      }
    } else
      bo[o.l] = o.r;
  }
  return bo;
});
test_register_get_seq(get_seq);

describe('util', ()=>{
  it('parse_buf_ref', ()=>{
    const t = (val, exp)=>assert.deepEqual(FS.parse_buf_ref(val), exp);
    t(null, {l: '_'});
    t(undefined, {l: '_'});
    t(0, {d: 0});
    t(1, {d: 1});
    t('', {buf: Buffer.from('')});
    t('a', {buf: Buffer.from('a')});
    t({d: 1}, {d: 1});
    t({d: '_'}, {l: '_'});
  });
});

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
    let b1, b2, b3, b = 'x'.repeat(68);
    // XXX: create low-level scroll using decl to check all possible
    // combinations
    // XXX: test empty file
    // XXX: test binary
    // XXX: test branches+conflict
    // XXX: support buf(b:123 b2:1234)
    // XXX: test seq0
    // XXX: test binary
    // XXX: test mv/rm file/dir
    t('basic', `s..#seq buf(b1 val:0) buf(b2 val:1) s..fs #seq0={}
      add(/f1 buf:b1) #seq1={op:add file:/f1 content:1 f2:b1}
      add(/f2 buf:b2) #seq2={op:add file:/f2 content:1 f2:b2}`);
    [b1, b2, b3] = [b+'x1', b+'x2', b+'x3'];
    t('mod_same', `s..#seq buf(b val:b) s..fs #seq0={}
      add(/f buf:b) #seq1={op:add file:/f content:1 f2:b}
      mod(/f buf:b) #seq2={op:mod file:/f link:1}`);
    t('mod_diff', `s..#seq
      buf(b1 val:${b1}) buf(b2 val:${b2}) buf(b3 val:${b3}) s..fs #seq0={}
      add(/f1 buf:b1) #seq1={op:add file:/f1 content:1 f2:b1}
      mod(/f1 buf:b2) #seq2={op:mod file:/f1 link:1 diff:1 f2:diff(b1,b2)}
      mod(/f1 buf:b3) #seq3={op:mod file:/f1 link:2 diff:1 f2:diff(b2,b3)}`);
    [b1, b2] = [b+'1', b+'2'];
    t('mod_nodiff', `s..#seq buf(b1 val:${b1}) buf(b2 val:${b2}) s..fs #seq0={}
      add(/f1 buf:b1) #seq1={op:add file:/f1 content:1 f2:b1}
      mod(/f1 buf:b2) #seq2={op:mod file:/f1 content:1 f2:b2}`);
    t('link', `s..#seq buf(b1 val:0) s..fs #seq0={}
      add(/f1 buf:b1) #seq1={op:add file:/f1 content:1 f2:b1}
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
