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
import {test_run, new_scroll, get_scroll, get_def, test_register,
  test_register_cmd} from '../storage/test_cmd.js';

xtest.init();

let t_buf;

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
  let branch;
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    if (tt.cmd=='branch')
      branch = tt.r;
    else if (tt.cmd=='main')
      branch = null;
    else if (/^buf/.test(tt.cmd)){
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
    yield fs.add_file(file, buf, {branch});
  else
    yield fs.add_dir(dir, {branch});
});

const cmd_mod = t=>etask(function*cmd_mod(){
  this.on('uncaught', e=>xerr.xexit(e)); // XXX: need xtest.etask
  let name = t.ctx||get_def('left'), fs = get_scroll(name), file, buf, branch;
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    if (tt.cmd=='branch')
      branch = tt.r;
    else if (tt.cmd=='main')
      branch = null;
    else if (/^buf/.test(tt.cmd)){
      buf = t_buf[tt.r];
      assert(buf, 'buf not found '+tt.r);
    } else {
      assert(!file, 'invalid arg '+tt.cmd+' in '+t.meta.s);
      file = tt.cmd;
      assert(FS.valid_file(file), 'invalid file '+file);
    }
  }
  assert(FS.valid_file(file), 'missing file');
  yield fs.mod_file(file, buf, {branch});
});

const cmd_rm = t=>etask(function*cmd_rm(){
  let name = t.ctx||get_def('left'), fs = get_scroll(name), dir, file;
  let branch;
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    if (tt.cmd=='branch')
      branch = tt.r;
    else if (tt.cmd=='main')
      branch = null;
    else {
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
    yield fs.rm_file(file, {branch});
  else
    yield fs.rm_dir(dir, {branch});
});


const cmd_buf = t=>etask(function*cmd_buf(){
  assert(!t.l, 'invalid left arg '+t.meta.s);
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    let name = tt.cmd, val = tt.r;
    assert(!t_buf[name], 'buf already exist '+name);
    t_buf[name] = Buffer.from(val+'\n');
  }
});

const test_run_single = (curr, o, step)=>etask(function*_test_run_single(){
  switch (o.cmd){
  case 'fs': yield cmd_fs(o); break;
  case 'add': yield cmd_add(o); break;
  case 'mod': yield cmd_mod(o); break;
  case 'rm': yield cmd_rm(o); break;
  case 'buf': yield cmd_buf(o); break;
  default: return false;
  }
  return true;
});

const test_get_seq = s=>etask(function*get_seq(){
  let bo = {};
  s = rm_parentesis(s, '{');
  for (let curr=s; curr = parse_get_next(curr);){
    let o = parse_exp(curr.exp);
    // XXX yield get_val(o.r);
    if (o.l=='f2'){
      let oo = parse_exp(o.r), a;
      switch (oo.cmd){
      case 'diff':
        a = oo.r.split(' ');
        assert(a.length==2, 'invalid diff '+o.r);
        assert(t_buf[a[0]], 'buf not found '+a[0]);
        assert(t_buf[a[1]], 'buf not found '+a[1]);
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

function state_valid_filter(s){
  // XXX: mv seq from storage/test_cmd.js to this file
  switch (s){
  case 'fs': return true;
  }
  return false;
}

function get_fs(s){
  let ret = {add: [], rm: []};
  s = rm_parentesis(s, '[');
  for (let curr=s, i=0; curr = parse_get_next(curr); i++){
    let path = curr.exp;
    if (path[0]=='!')
      ret.rm.push(path.substr(1));
    else
      ret.add.push(path);
  }
  return ret;
}

function state_split_var(v, def){
  let m = v.match(/^(c(\d+))?fs(_(.*))?$/);
  assert(m, 'invalid var '+v);
  let cfid = m[2] ? +m[2] : 0, branch = m[4], name = def||get_def('left');
  return {name, type: 'fs', cfid, branch};
}

function state_apply(state, o){
  // XXX TODO: cfd, type let fs = get_scroll(name);
  let {val, branch} = o, {add, rm} = val;
  assert.equal(o.type, 'fs', 'invalid type');
  branch = branch||'main';
  state.fs = state.fs||{};
  for (let i=0; i<add.length; i++){
    state.fs[branch] = state.fs[branch]||[];
    let path = add[i], path_i = state.fs[branch].indexOf(path);
    assert.equal(path_i, -1, 'uneeded add '+path);
    state.fs[branch].push(path);
  }
  for (let i=0; i<rm.length; i++){
    state.fs[branch] = state.fs[branch]||[];
    let path = rm[i], path_i = state.fs[branch].indexOf(path);
    assert(path_i>-1, 'uneeded rm '+path);
    state.fs[branch].splice(path_i, 1);
  }
}

const state_split = (o, def)=>etask(function*state_split(){
  if (!/^fs/.test(o.l))
    return;
  switch (o.cmd){
  case '!': return {...state_split_var(o.r, def), val: null};
  case '=': return {...state_split_var(o.l, def), val: yield get_fs(o.r)};
  default: assert.fail('invalid state_split '+o.meta.s);
  }
});

const state_curr = (filter, state, fs)=>etask(function*state_curr(){
  let f;
  if (!(f = filter.find(s=>/^fs/.test(s))))
    return;
  if (fs.top.seq<1)
    return;
  let cfid = 0; // XXX: support cfid
  let m = f.match(/^fs(\d+)$/), seq;
  if (m)
    seq = +m[1];
  else
    seq = fs.top.seq;
  state.fs = yield fs.test_dump_fs(cfid, seq);
});

function state_assert(filter, state_curr, state_exp){
  if (!filter.find(s=>/^fs/.test(s)))
    return;
  assert.deepEqual(state_curr.fs, state_exp.fs, 'state fs mismatch');
}

function state_get_steps(filter, name, s){
  if (!filter.find(s=>/^fs/.test(s)))
    return;
  let steps = '';
  s = rm_parentesis(s);
  for (let curr=s; curr = parse_get_next(curr);){
    let o = parse_exp_arg(curr.exp);
    assert(!o.l || o.l==':', 'invalid arg '+curr.exp);
    if (!o.l && !o.r)
      steps += (steps&&' ')+'fs='+o.cmd;
    else
      steps += (steps&&' ')+'fs_'+o.cmd+'='+o.r;
  }
  return steps;
}

const test_start = ()=>etask(function*test_start(){ t_buf = {}; });

test_register_cmd(test_run_single);
test_register('get_seq', test_get_seq);
test_register('start', test_start);
test_register('state_valid_filter', state_valid_filter);
test_register('state_split', state_split);
test_register('state_apply', state_apply);
test_register('state_curr', state_curr);
test_register('state_assert', state_assert);
test_register('state_get_steps', state_get_steps);

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
  describe('dir', ()=>{
    // XXX: fix all other tests that use test_* and use ## instead
/* XXX: TODO
      // XXX:
      // ##fs(seq1 /)
      // ##fs(seq2 / /d1/)
      // ##fs(seq6 / /d1/ /d1/dd1/ /d1/dd2/ /d2/ /d2/dd1/)
      // ##fs(seq7 / /d1/ /d1/dd1/ /d1/dd2/ /d2/ /d2/dd1/ d2/dd2/)
      add(/)               #fs(/)
      add(/d1/)            #fs(/d1/)
      add(/d1/f1 buf:b1)   #fs(/d1/f1:b1)
      add(/d2/)            #fs(/d2/)
      rm(/d2/)             #fs(!/d2/)
      rm(/d1/)             #fs(!/d1/f1 !/d1/)
*/
    t('add', `s..#(seq fs)
      s..fs         #seq0={}
      add(/)        #(seq1={op:add dir:/} fs=/)
      add(/d1/)     #(seq2={op:add dir:/d1/} fs=/d1/)
      add(/d1/dd1/) #(seq3={op:add dir:/d1/dd1/} fs=/d1/dd1/)
      add(/d1/dd2/) #(seq4={op:add dir:/d1/dd2/} fs=/d1/dd2/)
      add(/d2/)     #(seq5={op:add dir:/d2/} fs=/d2/)
      add(/d2/dd1/) #(seq6={op:add dir:/d2/dd1/} fs=/d2/dd1/)
      add(/d2/dd2/) #(seq7={op:add dir:/d2/dd2/} fs=/d2/dd2/)
      ##fs1=[/]
      ##fs2=[/ /d1/]
      ##fs3=[/ /d1/ /d1/dd1/]
      ##fs4=[/ /d1/ /d1/dd1/ /d1/dd2/]
      ##fs5=[/ /d1/ /d1/dd1/ /d1/dd2/ /d2/]
      ##fs6=[/ /d1/ /d1/dd1/ /d1/dd2/ /d2/ /d2/dd1/]
      ##fs7=[/ /d1/ /d1/dd1/ /d1/dd2/ /d2/ /d2/dd1/ /d2/dd2/]
      ##fs=[/ /d1/ /d1/dd1/ /d1/dd2/ /d2/ /d2/dd1/ /d2/dd2/]
    `);
    t('rm_single', `s..#(seq fs)
      s..fs          #(seq0={})
      add(/)         #(seq1={op:add dir:/} fs=/)
      add(/d1/)      #(seq2={op:add dir:/d1/} fs=/d1/)
      add(/d2/)      #(seq3={op:add dir:/d2/} fs=/d2/)
      add(/d2/dd2/)  #(seq4={op:add dir:/d2/dd2/} fs=/d2/dd2/)
      rm(/d1/)       #(seq5={op:rm dir:/d1/} fs=!/d1/)
      rm(/d2/dd2/)   #(seq6={op:rm dir:/d2/dd2/} fs=!/d2/dd2/)
      rm(/d2/)       #(seq7={op:rm dir:/d2/} fs=!/d2/)
      ##fs1=[/]
      ##fs2=[/ /d1/]
      ##fs3=[/ /d1/ /d2/]
      ##fs4=[/ /d1/ /d2/ /d2/dd2/]
      ##fs5=[/ /d2/ /d2/dd2/]
      ##fs6=[/ /d2/]
      ##fs7=[/]
      ##fs=[/]`);
    if (0) // XXX WIP
    t('rm_multi', `s..#(seq fs)
      s..fs          #(seq0={})
      add(/)         #(seq1={op:add dir:/} fs=/)
      add(/d/)       #(seq2={op:add dir:/d/} fs=/d/)
      add(/d/dd1/)   #(seq3={op:add dir:/d/dd1/} fs=/d/dd1/)
      add(/d/dd2/)   #(seq4={op:add dir:/d/dd2/} fs=/d/dd2/)
      rm(/d/)
        #(seq5={op:rm dir:/d/} seq6={op:rm dir:/d/} seq7={op:rm dir:/d/}
        fs=[!/d/ !/d/dd1/ !/d/dd2])
    `);
    // XXX: test rm directory with multi directories
    // XXX: test rm file + directories with multiple files
  });
  // XXX: add by date
  describe('file', ()=>{ // XXX: test fs in all
    let d1, d2, d3, d = 'x'.repeat(68);
    // XXX: create low-level scroll using decl to check all possible
    // combinations
    // XXX: test empty file/binary file
    // XXX: test conflict
    // XXX: test seq0
    // XXX: test mv/rm file/dir
    // XXX: what if trying to add file without directory that exists
    // (create directory if it doesn't exist)
    t('add_two_diff', `s..#seq buf(d1:0) buf(d2:1) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={op:add file:/f1 content:1 f2:d1}
      add(/f2 buf:d2) #seq2={op:add file:/f2 content:1 f2:d2}`);
    t('add_two_same', `s..#seq buf(d1:0) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={op:add file:/f1 content:1 f2:d1}
      add(/f2 buf:d1) #seq2={op:add file:/f2 link:1}`);
    t('mod_same', `s..#seq buf(d:d) s..fs #seq0={}
      add(/f buf:d) #seq1={op:add file:/f content:1 f2:d}
      mod(/f buf:d) #seq2={op:mod file:/f link:1}`);
    [d1, d2, d3] = [d+'x1', d+'x2', d+'x3'];
    t('mod_diff', `s..#seq
      buf(d1:${d1}) buf(d2:${d2}) buf(d3:${d3}) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={op:add file:/f1 content:1 f2:d1}
      mod(/f1 buf:d2) #seq2={op:mod file:/f1 link:1 diff:1 f2:diff(d1 d2)}
      mod(/f1 buf:d3) #seq3={op:mod file:/f1 link:2 diff:1 f2:diff(d2 d3)}`);
    [d1, d2] = [d+'1', d+'2'];
    t('mod_nodiff', `s..#seq buf(d1:${d1}) buf(d2:${d2}) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={op:add file:/f1 content:1 f2:d1}
      mod(/f1 buf:d2) #seq2={op:mod file:/f1 content:1 f2:d2}`);
    t('rm', `s..#(seq fs) buf(d:1)
      s..fs          #(seq0={})
      add(/)         #(seq1={op:add dir:/} fs=/)
      add(/f buf:d)  #(seq2={op:add file:/f content:1 f2:d} fs=/f)
      rm(/f)         #(seq3={op:rm file:/f} fs=!/f)
      add(/f buf:d)  #(seq4={op:add file:/f link:2} fs=/f)`);
    [d1, d2] = [d+'x1', d+'x2'];
    t('rm_add_diff', `s..#(seq fs) buf(d1:${d1}) buf(d2:${d2})
      s..fs          #(seq0={})
      add(/)         #(seq1={op:add dir:/} fs=/)
      add(/f buf:d1)  #(seq2={op:add file:/f content:1 f2:d1} fs=/f)
      rm(/f)         #(seq3={op:rm file:/f} fs=!/f)
      add(/f buf:d2)  #(seq4={op:add file:/f content:1 f2:d2} fs=/f)`);
  });
  describe('branch', ()=>{
    // XXX: test branch deletion of file/dir
    // XXX: add test with mutli-branch
    // XXX: test prev
    let d1, d2, d3, d4, d5, d6, d = 'x'.repeat(68);
    t('file_add', `s..#(seq fs) buf(d1:1) buf(d2:2) buf(d3:3)
      buf(d4:4) buf(d5:5) buf(d6:6) buf(d7:7) s..fs #seq0={}
      add(/)          #(seq1={op:add dir:/} fs=/)
      add(/f1 buf:d1) #(seq2={op:add file:/f1 content:1 f2:d1} fs=/f1)
      add(/f2 branch:b buf:d2)
        #(seq3={bseq:2-1.0 branch:b op:add file:/f2 content:1 f2:d2}
        fs_b=[/ /f1 /f2])
      add(/f3 buf:d3) #(seq4={bseq:2-1.1 op:add file:/f3 content:1 f2:d3}
        fs_b=/f3)
      add(/f4 buf:d4) #(seq5={bseq:2-1.2 op:add file:/f4 content:1 f2:d4}
        fs_b=/f4)
      add(/f5 main buf:d5) #(seq6={bseq:3 op:add file:/f5 content:1 f2:d5}
        fs=/f5)
      add(/f6 buf:d6) #(seq7={bseq:4 op:add file:/f6 content:1 f2:d6}
        fs=/f6)
      add(/f7 branch:b buf:d7)
        #(seq8={bseq:2-1.3 op:add file:/f7 content:1 f2:d7} fs_b=/f7)
      ##fs1=[/]
      ##fs2=[/ /f1]
      ##fs3=([/ /f1]         b:[/ /f1 /f2])
      ##fs4=([/ /f1]         b:[/ /f1 /f2 /f3])
      ##fs5=([/ /f1]         b:[/ /f1 /f2 /f3 /f4])
      ##fs6=([/ /f1 /f5]     b:[/ /f1 /f2 /f3 /f4])
      ##fs7=([/ /f1 /f5 /f6] b:[/ /f1 /f2 /f3 /f4])
      ##fs8=([/ /f1 /f5 /f6] b:[/ /f1 /f2 /f3 /f4 /f7])
      ##fs=([/ /f1 /f5 /f6]  b([/ /f1 /f2 /f3 /f4 /f7]))`);
    t('file_mod_nodiff', `s..#seq buf(d1:1) buf(d2:2) buf(d3:3)
      buf(d4:4) buf(d5:5) buf(d6:6) buf(d7:7) s..fs #seq0={}
      add(/f buf:d1) #seq1={op:add file:/f content:1 f2:d1}
      mod(/f branch:b buf:d2)
        #seq2={bseq:1-1.0 branch:b op:mod file:/f content:1 f2:d2}
      mod(/f buf:d3) #seq3={bseq:1-1.1 op:mod file:/f content:1 f2:d3}
      mod(/f buf:d4) #seq4={bseq:1-1.2 op:mod file:/f content:1 f2:d4}
      mod(/f main buf:d5) #seq5={bseq:2 op:mod file:/f content:1 f2:d5}
      mod(/f buf:d6) #seq6={bseq:3 op:mod file:/f content:1 f2:d6}
      mod(/f branch:b buf:d7)
        #seq7={bseq:1-1.3 op:mod file:/f content:1 f2:d7}`);
    [d1, d2, d3, d4, d5, d6] = [d+'x1', d+'x2', d+'x3', d+'x4', d+'x5',
      d+'x6'];
    t('file_mod_diff', `s..#seq s..fs #seq0={} buf(d1:${d1})
      buf(d2:${d2}) buf(d3:${d3}) buf(d4:${d4}) buf(d5:${d5})
      buf(d6:${d6})
      add(/f buf:d1) #seq1={op:add file:/f content:1 f2:d1}
      mod(/f branch:b buf:d2)
        #seq2={bseq:1-1.0 branch:b op:mod file:/f link:1 diff:1 f2:diff(d1 d2)}
      mod(/f buf:d3)
        #seq3={bseq:1-1.1 op:mod file:/f link:2 diff:1 f2:diff(d2 d3)}
      mod(/f main buf:d4)
        #seq4={bseq:2 op:mod file:/f link:1 diff:1 f2:diff(d1 d4)}
      mod(/f buf:d5) #seq5={bseq:3 op:mod file:/f link:4 diff:1 f2:diff(d4 d5)}
      mod(/f branch:b buf:d6)
        #seq6={bseq:1-1.2 op:mod file:/f link:3 diff:1 f2:diff(d3 d6)}`);
    t('dir', `s..#seq s..fs #seq0={}
      add(/) #seq1={op:add dir:/}
      add(/d1/) #seq2={op:add dir:/d1/}
      add(/d2/ branch:b) #seq3={bseq:2-1.0 branch:b op:add dir:/d2/}
      add(/d3/) #seq4={bseq:2-1.1 op:add dir:/d3/}
      add(/d2/ main) #seq5={bseq:3 op:add dir:/d2/}
      add(/d3/ main) #seq6={bseq:4 op:add dir:/d3/}
      add(/d4/ branch:b) #seq7={bseq:2-1.2 op:add dir:/d4/}
    `);
  });
  // XXX: test tag
});
