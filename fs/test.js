'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import xtest from '../util/test_lib.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import {Buffer} from 'buffer';
import crypto from '../util/crypto.js';
import FS from './fs.js';
import GIT from './git.js';
import git_util from './git_util.js';
import buf_util from '../net/buf_util.js';
import tparser from '../storage/test_parser.js';
import DiffMatchAndPath from 'diff-match-patch';
import DB from '../storage/db.js';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;
const Diff = new DiffMatchAndPath();
const {parse_get_next, parse_exp, parse_exp_arg, rm_parentesis,
  parse_exp_arg_pair} = tparser;
import {test_run, new_scroll, get_scroll, get_def, test_register,
  test_register_cmd, get_val, parse_db_init, js_struct_from_str}
  from '../storage/test_cmd.js';

xtest.init();
// XXX: use memoryDatabase: ':memory:'
DB.init({shim_conf: {checkOrigin: false, databaseBasePath: '/tmp',
  deleteDatabaseFiles: true, useSQLiteIndexes: true}});
let t_buf;

// XXX: mv to generic place and review with derry
function encode_str(s){ return '__enc__'+encodeURI(s); }

function decode_str(s){
  const prefix = '__enc__';
  if (s.substr(0, prefix.length)==prefix)
    return decodeURI(s.substr(prefix.length));
  return s;
}

const cmd_fs = t=>etask(function*cmd_fs(){
  let name = t.ctx||get_def('left'), M, db_opt, len, csum_sha256;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!get_scroll(name, true), 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp), t2, a;
    switch (tt.cmd){
    case 'db': db_opt = parse_db_init(tt); break;
    case 'len': len = true; break;
    case 'csum_sha256': csum_sha256 = true; break;
    default:
      t2 = parse_exp_arg_pair(curr.exp);
      if (a = t2.l.match(/^M(\d+)$/)){
        let h = yield get_val(t2.r);
        assert(h, 'missing '+t2.r);
        M = +a[1] ? {seq: +a[1], h} : h;
        break;
      }
      assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  let scroll_decl = len||csum_sha256 ? {} : undefined;
  if (len)
    scroll_decl.len = len;
  if (csum_sha256)
    scroll_decl.csum_sha256 = csum_sha256;
  yield new_scroll(name, M, null, t.prev?.ctx, db_opt, scroll_decl,
    function create_func(opt, d){ return FS.create(opt, d); },
    function open_func(opt){ return FS.open(opt); });
});

const cmd_add = t=>etask(function*cmd_add(){
  let name = t.ctx||get_def('left'), fs = get_scroll(name), dir, file, buf;
  let branch, prev;
  assert(t.r, 'missing arg '+t.meta.s);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    if (tt.cmd=='branch')
      branch = tt.r;
    else if (tt.cmd=='main')
      branch = null;
    else if (tt.cmd=='prev')
      prev = +tt.r;
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
    yield fs.add_file(file, buf, {branch, prev});
  else
    yield fs.add_dir(dir, {branch, prev});
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

const cmd_git = t=>etask(function*cmd_git(){
  let name = t.ctx||get_def('left'), M, db_opt, src;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!get_scroll(name, true), 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp), t2, a;
    switch (tt.cmd){
    case 'src': src = 'https://github.com/'+tt.r; break;
    case 'db': db_opt = parse_db_init(tt); break;
    default:
      t2 = parse_exp_arg_pair(curr.exp);
      if (a = t2.l.match(/^M(\d+)$/)){
        let h = yield get_val(t2.r);
        assert(h, 'missing '+t2.r);
        M = +a[1] ? {seq: +a[1], h} : h;
        break;
      }
      assert.fail('invalid arg '+tt.cmd+' in '+t.meta.s);
    }
  }
  assert(src, 'missing src');
  let scroll_decl = src ? {src} : undefined;
  yield new_scroll(name, M, null, t.prev?.ctx, db_opt, scroll_decl,
    function create_func(opt, d){ return GIT.create(opt, d); },
    function open_func(opt){ return GIT.open(opt); });
});

const cmd_sync = t=>etask(function*cmd_sync(){
  let name = t.ctx||get_def('left'), git = get_scroll(name);
  assert(!t.r, 'invalid arg');
  yield git.sync();
});

const test_run_single = (curr, o, step)=>etask(function*_test_run_single(){
  switch (o.cmd){
  case 'fs': yield cmd_fs(o); break;
  case 'add': yield cmd_add(o); break;
  case 'mod': yield cmd_mod(o); break;
  case 'rm': yield cmd_rm(o); break;
  case 'buf': yield cmd_buf(o); break;
  case 'git': yield cmd_git(o); break;
  case 'sync': yield cmd_sync(o); break;
  default: return false;
  }
  return true;
});

const test_get_seq = s=>etask(function*get_seq(){
  let bo = {};
  s = rm_parentesis(s, '{');
  for (let curr=s; curr = parse_get_next(curr);){
    let o = parse_exp(curr.exp);
    if (!o.r)
      bo[o.l] = '';
    else if (['f2', 'csum_sha256'].includes(o.l)){ // XXX: ugly
      let oo = parse_exp(o.r), a;
      switch (oo.cmd){
      case 'sha256':
        assert(t_buf[oo.r], 'buf not found '+oo.r);
        bo[o.l] = b2s(crypto.sha256(t_buf[oo.r]));
        break;
      case 'diff':
        a = oo.r.split(' ');
        assert(a.length==2, 'invalid diff '+o.r);
        assert(t_buf[a[0]], 'buf not found '+a[0]);
        assert(t_buf[a[1]], 'buf not found '+a[1]);
        bo[o.l] = Buffer.from(Diff.patch_toText(
          Diff.patch_make(t_buf[a[0]].toString(), t_buf[a[1]].toString())));
        break;
      default:
        if ('0x'==o.r.substr(0, 2))
          bo[o.l] = s2b(o.r.substr(2));
        else {
          assert(t_buf[o.r], 'buf not found '+o.r);
          bo[o.l] = t_buf[o.r];
        }
      }
    } else if ('desc'==o.cmd){ // XXX: need better way to handle \n
      bo[o.cmd] = decode_str(rm_parentesis(o.r, '('))+'\n';
    } else if ('file'==o.cmd)
      bo[o.cmd] = rm_parentesis(o.r, '(');
    else if (['content', 'group', 'link', 'diff'].includes(o.l) &&
      /^\d+$/.test(o.r))
    {
      bo[o.l] = +o.r;
    } else
      bo[o.l] = o.r.at(0)=='{' ? js_struct_from_str(o.r) : o.r;
  }
  return bo;
});

function state_valid_filter(s){
  // XXX: mv seq from storage/test_cmd.js to this file
  switch (s){
  case 'fs': return true;
  case 'file': return true;
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
  if (m){
    let cfid = m[2] ? +m[2] : 0, branch = m[4], name = def||get_def('left');
    return {name, type: 'fs', cfid, branch};
  }
  m = v.match(/^file(.*)$/);
  assert(m?.[1], 'invalid var '+v);
  let name = def||get_def('left'), file, cfid = 0;
  let branch = null;
  for (let curr=rm_parentesis(m[1]); curr = parse_get_next(curr);){
    if (!file){
      file = curr.exp;
      continue;
    }
    let o = parse_exp_arg(curr.exp);
    switch (o.cmd){
    case 'branch': branch = o.r; break;
    case 'c': cfid = +o.r; break;
    default: assert.fail('invalid state_split_var arg '+curr.exp);
    }
  }
  return {name, type: 'file', file, cfid, branch};
}

function state_apply(state, o){
  let {val, branch, cfid} = o;
  if (o.type=='fs'){
    let {add, rm} = val;
    branch = branch||'main';
    state.fs = state.fs||{};
    state.fs[cfid] = state.fs[cfid]||{};
    for (let i=0; i<add.length; i++){
      state.fs[cfid][branch] = state.fs[cfid][branch]||[];
      let path = add[i], path_i = state.fs[cfid][branch].indexOf(path);
      assert.strictEqual(path_i, -1, 'uneeded add '+path);
      state.fs[cfid][branch].push(path);
    }
    for (let i=0; i<rm.length; i++){
      state.fs[cfid][branch] = state.fs[cfid][branch]||[];
      let path = rm[i], path_i = state.fs[cfid][branch].indexOf(path);
      assert(path_i>-1, 'uneeded rm '+path);
      state.fs[cfid][branch].splice(path_i, 1);
    }
    if (!state.fs[cfid].main)
      state.fs[cfid].main = [];
  } else if (o.type=='file'){
    state.file = state.file||{};
    assert(o.file, 'missing file');
    state.file[o.file] = o.val;
  } else
    assert.fail('invalid type '+o.type);
}

const state_split = (o, def)=>etask(function*state_split(){
  if (/^(c\d+)?fs/.test(o.l)){
    switch (o.cmd){
    case '!': return {...state_split_var(o.r, def), val: null};
    case '=': return {...state_split_var(o.l, def), val: yield get_fs(o.r)};
    default: assert.fail('invalid state_split '+o.meta.s);
    }
  }
  if (/^file\(/.test(o.l)){
    switch (o.cmd){
    case '!': return {...state_split_var(o.r, def), val: null};
    case '=': return {...state_split_var(o.l, def), val: t_buf[o.r]};
    default: assert.fail('invalid state_split '+o.meta.s);
    }
  }
});

const state_curr = (filter, state, fs)=>etask(function*state_curr(){
  let f;
  if (f = filter.find(s=>/^fs/.test(s))){
    if (fs.top.seq<1)
      return;
    for (const [cfid] of fs.conflict){
      let m = f.match(/^fs(\d+)$/), seq;
      if (m)
        seq = +m[1];
      else
        seq = fs.top.seq;
      state.fs = state.fs||{};
      state.fs[cfid] = state.fs[cfid]||{};
      state.fs[cfid] = yield fs.test_dump_fs(cfid, seq);
    }
  }
  else if (f = filter.find(s=>/^file/.test(s))){
    let o = state_split_var(f);
    state.file = state.file||{};
    state.file[o.file] = yield fs.get_file(o.cfid, o.file, o.branch);
  }
});

function state_assert(filter, state_curr, state_exp){
  if (filter.find(s=>/^fs/.test(s)))
    assert.deepEqual(state_curr.fs, state_exp.fs, 'state fs mismatch');
  if (filter.find(s=>/^file/.test(s)))
    assert.deepEqual(state_curr.file, state_exp.file, 'state file mismatch');
}

function state_get_steps(filter, name, s){
  if (filter.find(s=>/^fs/.test(s))){
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
  let f;
  if (f = filter.find(s=>/^file\(/.test(s)))
    return f+'='+s;
  if (f = filter.find(s=>/^seq\d/.test(s)))
    return f+'='+s;
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
  // XXX: cleanup tests using macros
  describe('dir', ()=>{
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
    t('rm_multi', `s..#(seq fs) s..fs #(seq0={})
      add(/)         #(seq1={op:add dir:/} fs=/)
      add(/d/)       #(seq2={op:add dir:/d/} fs=/d/)
      add(/d/dd1/)   #(seq3={op:add dir:/d/dd1/} fs=/d/dd1/)
      add(/d/dd2/)   #(seq4={op:add dir:/d/dd2/} fs=/d/dd2/)
      rm(/d/)        #(seq5={op:rm dir:/d/dd2/} seq6={op:rm dir:/d/dd1/}
                       seq7={op:rm dir:/d/} fs=[!/d/ !/d/dd1/ !/d/dd2/])
      ##fs1=[/]
      ##fs2=[/ /d/]
      ##fs3=[/ /d/ /d/dd1/]
      ##fs4=[/ /d/ /d/dd1/ /d/dd2/]
      ##fs5=[/ /d/ /d/dd1/]
      ##fs6=[/ /d/]
      ##fs7=[/]
      ##fs=[/]`);
    let stest = `s..#(seq fs) s..fs #(seq0={})
      add(/)            #(seq1={op:add dir:/} fs=/)
      add(/d/)          #(seq2={op:add dir:/d/} fs=/d/)
      add(/d/dd1/)      #(seq3={op:add dir:/d/dd1/} fs=/d/dd1/)
      add(/d/dd1/ddd1/) #(seq4={op:add dir:/d/dd1/ddd1/} fs=/d/dd1/ddd1/)
      add(/d/dd2/)      #(seq5={op:add dir:/d/dd2/} fs=/d/dd2/)
      add(/d/dd2/ddd1/) #(seq6={op:add dir:/d/dd2/ddd1/} fs=/d/dd2/ddd1/)
      add(/d/dd2/ddd2/) #(seq7={op:add dir:/d/dd2/ddd2/} fs=/d/dd2/ddd2/)`;
    t('rm_multi_deep_rm_/', stest+` rm(/) #(
      seq8={op:rm dir:/d/dd2/ddd2/}
      seq9={op:rm dir:/d/dd2/ddd1/}
      seq10={op:rm dir:/d/dd2/}
      seq11={op:rm dir:/d/dd1/ddd1/}
      seq12={op:rm dir:/d/dd1/}
      seq13={op:rm dir:/d/}
      seq14={op:rm dir:/}
      fs=[!/ !/d/ !/d/dd1/ !/d/dd1/ddd1/ !/d/dd2/ !/d/dd2/ddd1/ !/d/dd2/ddd2/]
    )`);
    t('rm_multi_deep_rm_/d/', stest+` rm(/d/) #(
      seq8={op:rm dir:/d/dd2/ddd2/}
      seq9={op:rm dir:/d/dd2/ddd1/}
      seq10={op:rm dir:/d/dd2/}
      seq11={op:rm dir:/d/dd1/ddd1/}
      seq12={op:rm dir:/d/dd1/}
      seq13={op:rm dir:/d/}
      fs=[!/d/ !/d/dd1/ !/d/dd1/ddd1/ !/d/dd2/ !/d/dd2/ddd1/ !/d/dd2/ddd2/])`);
    t('rm_multi_deep_rm_/d/dd1/', stest+` rm(/d/dd1/) #(
      seq8={op:rm dir:/d/dd1/ddd1/}
      seq9={op:rm dir:/d/dd1/}
      fs=[!/d/dd1/ !/d/dd1/ddd1/])`);
    t('rm_multi_deep_rm_/d/dd2', stest+` rm(/d/dd2/) #(
      seq8={op:rm dir:/d/dd2/ddd2/}
      seq9={op:rm dir:/d/dd2/ddd1/}
      seq10={op:rm dir:/d/dd2/}
      fs=[!/d/dd2/ !/d/dd2/ddd1/ !/d/dd2/ddd2/])`);
  });
  // XXX: add by date
  describe('file', ()=>{ // XXX: test fs in all
    let d1, d2, d3, d = 'x'.repeat(68);
    // XXX: create low-level scroll using decl to check all possible
    // combinations
    // XXX: binary file
    // XXX: what if trying to add file without directory that exists
    // (create directory if it doesn't exist)
    t('add_buf', `s..#seq buf(d:0) s..fs #seq0={}
      add(/f1 buf:d) #seq1={op:add file:/f1 content:1 f2:d}`);
    t('add_buf_len_a', `s..#seq buf(d:a) s..fs(len) #seq0={}
      add(/f1 buf:d) #seq1={op:add file:/f1 len:2 content:1 f2:d}`);
    t('add_buf_len_ab', `s..#seq buf(d:ab) s..fs(len) #seq0={}
      add(/f1 buf:d) #seq1={op:add file:/f1 len:3 content:1 f2:d}`);
    t('add_empty', `s..#seq s..fs #seq0={} add(/f1) #seq1={op:add file:/f1}`);
    t('add_two_diff', `s..#seq buf(d1:0) buf(d2:1) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={op:add file:/f1 content:1 f2:d1}
      add(/f2 buf:d2) #seq2={op:add file:/f2 content:1 f2:d2}`);
    t('add_two_same_def', `s..#seq buf(d:0) s..fs #seq0={}
      add(/f1 buf:d) #seq1={op:add file:/f1 content:1 f2:d}
      add(/f2 buf:d) #seq2={op:add file:/f2 content:1 f2:d}`);
    t('add_two_same_sha256', `s..#seq buf(d:0) s..fs(csum_sha256) #seq0={}
      add(/f1 buf:d) #seq1={op:add file:/f1 content:1 f2:d
        csum_sha256:sha256(d)}
      add(/f2 buf:d) #seq2={op:add file:/f2 link:1 csum_sha256:sha256(d)}`);
    t('add_three_same_sha256', `s..#seq buf(d:0) s..fs(csum_sha256) #seq0={}
      add(/f1 buf:d) #seq1={op:add file:/f1 content:1 f2:d
        csum_sha256:sha256(d)}
      add(/f2 buf:d) #seq2={op:add file:/f2 link:1 csum_sha256:sha256(d)}
      add(/f3 buf:d) #seq3={op:add file:/f3 link:1 csum_sha256:sha256(d)}`);
    t('mod_same_def', `s..#seq buf(d:d) s..fs #seq0={}
      add(/f buf:d) #seq1={op:add file:/f content:1 f2:d}
      mod(/f buf:d) #seq2={op:mod file:/f link:1}`);
    t('mod_same_sha256', `s..#seq buf(d:d) s..fs(csum_sha256) #seq0={}
      add(/f buf:d) #seq1={op:add file:/f content:1 f2:d csum_sha256:sha256(d)}
      mod(/f buf:d) #seq2={op:mod file:/f link:1 csum_sha256:sha256(d)}`);
    t('mod_same_existing_same', `s..#seq buf(d:d) buf(d2:d2) s..fs #seq0={}
      add(/f buf:d) #seq1={op:add file:/f content:1 f2:d}
      add(/f2 buf:d2) #seq2={op:add file:/f2 content:1 f2:d2}
      mod(/f buf:d2) #seq3={op:mod file:/f content:1 f2:d2}`);
    t('mod_same_existing_sha256', `s..#seq buf(d:d) buf(d2:d2)
      s..fs(csum_sha256) #seq0={}
      add(/f buf:d) #seq1={op:add file:/f content:1 f2:d csum_sha256:sha256(d)}
      add(/f2 buf:d2) #seq2={op:add file:/f2 content:1 f2:d2
        csum_sha256:sha256(d2)}
      mod(/f buf:d2) #seq3={op:mod file:/f link:2 csum_sha256:sha256(d2)}`);
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
    t('mod_empty', `s..#seq buf(d:d) s..fs #seq0={}
      add(/f) #seq1={op:add file:/f}
      mod(/f buf:d) #seq2={op:mod file:/f content:1 f2:d}`);
    t('mod_to_empty', `s..#seq buf(d:d) s..fs #seq0={}
      add(/f buf:d) #seq1={op:add file:/f content:1 f2:d}
      mod(/f) #seq2={op:mod file:/f}`);
    t('rm_same', `s..#(seq fs) buf(d:1) buf(d2:2)
      s..fs          #(seq0={})
      add(/)         #(seq1={op:add dir:/} fs=/)
      add(/f buf:d)  #(seq2={op:add file:/f content:1 f2:d} fs=/f)
      mod(/f buf:d2)  #seq3={op:mod file:/f content:1 f2:d2}
      rm(/f)         #(seq4={op:rm file:/f} fs=!/f)
      add(/f buf:d)  #(seq5={op:add file:/f content:1 f2:d} fs=/f)`);
     t('rm_sha256', `s..#(seq fs) buf(d:1) buf(d2:2)
      s..fs(csum_sha256) #(seq0={})
      add(/)           #(seq1={op:add dir:/} fs=/)
      add(/f buf:d)    #(seq2={op:add file:/f content:1 f2:d
                       csum_sha256:sha256(d)} fs=/f)
      mod(/f buf:d2)   #seq3={op:mod file:/f content:1 f2:d2
                       csum_sha256:sha256(d2)}
      rm(/f)           #(seq4={op:rm file:/f} fs=!/f)
      add(/f buf:d)    #(seq5={op:add file:/f link:2
                       csum_sha256:sha256(d)} fs=/f)`);
    [d1, d2] = [d+'x1', d+'x2'];
    t('rm_add_diff', `s..#(seq fs) buf(d1:${d1}) buf(d2:${d2})
      s..fs          #(seq0={})
      add(/)         #(seq1={op:add dir:/} fs=/)
      add(/f buf:d1)  #(seq2={op:add file:/f content:1 f2:d1} fs=/f)
      rm(/f)         #(seq3={op:rm file:/f} fs=!/f)
      add(/f buf:d2)  #(seq4={op:add file:/f content:1 f2:d2} fs=/f)`);
    t('rm_multi', `s..#(seq fs) buf(d1:1) buf(d2:2)
      s..fs             #(seq0={})
      add(/)            #(seq1={op:add dir:/} fs=/)
      add(/d/)          #(seq2={op:add dir:/d/} fs=/d/)
      add(/d/f1 buf:d1) #(seq3={op:add file:/d/f1 content:1 f2:d1} fs=/d/f1)
      add(/d/f2 buf:d2) #(seq4={op:add file:/d/f2 content:1 f2:d2} fs=/d/f2)
      rm(/d/)           #(seq5={op:rm file:/d/f2} seq6={op:rm file:/d/f1}
                          seq7={op:rm dir:/d/} fs=[!/d/ !/d/f1 !/d/f2])`);
  });
  describe('branch', ()=>{
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
      ##fs=([/ /f1 /f5 /f6]  b([/ /f1 /f2 /f3 /f4 /f7]))
      ##file(/f1)=d1 ##file(/f1 branch:b)=d1
      ##file(/f2)=null ##file(/f2 branch:b)=d2
      ##file(/f3)=null ##file(/f3 branch:b)=d3
      ##file(/f4)=null ##file(/f4 branch:b)=d4
      ##file(/f5)=d5 ##file(/f5 branch:b)=null
      ##file(/f6)=d6 ##file(/f6 branch:b)=null
      ##file(/f7)=null ##file(/f7 branch:b)=d7`);
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
        #seq7={bseq:1-1.3 op:mod file:/f content:1 f2:d7}
      ##file(/f)=d6 ##file(/f branch:b)=d7`);
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
        #seq6={bseq:1-1.2 op:mod file:/f link:3 diff:1 f2:diff(d3 d6)}
      ##file(/f)=d5 ##file(/f branch:b)=d6`);
    t('dir', `s..#seq s..fs #seq0={}
      add(/) #seq1={op:add dir:/}
      add(/d1/) #seq2={op:add dir:/d1/}
      add(/d2/ branch:b) #seq3={bseq:2-1.0 branch:b op:add dir:/d2/}
      add(/d3/) #seq4={bseq:2-1.1 op:add dir:/d3/}
      add(/d2/ main) #seq5={bseq:3 op:add dir:/d2/}
      add(/d3/ main) #seq6={bseq:4 op:add dir:/d3/}
      add(/d4/ branch:b) #seq7={bseq:2-1.2 op:add dir:/d4/}
    `);
    t('multi_branch', `s..#(seq fs) s..fs #seq0={}
      add(/) #(seq1={op:add dir:/} fs=/)
      add(/d1/) #(seq2={op:add dir:/d1/} fs=/d1/)
      add(/d1/dd1/ branch:b1)
        #(seq3={branch:b1 bseq:2-1.0 op:add dir:/d1/dd1/}
        fs_b1=[/ /d1/ /d1/dd1/])
      add(/d1/dd2/)
        #(seq4={bseq:2-1.1 op:add dir:/d1/dd2/} fs_b1=/d1/dd2/)
      add(/d1/dd3/)
        #(seq5={bseq:2-1.2 op:add dir:/d1/dd3/} fs_b1=/d1/dd3/)
      add(/d1/dd1/ddd1/ branch:b2 prev:4)
        #(seq6={branch:b2 bseq:2-1.1-1.0 op:add dir:/d1/dd1/ddd1/}
        fs_b2=[/ /d1/ /d1/dd1/ /d1/dd1/ddd1/ /d1/dd2/])
      add(/d2/ main) #(seq7={bseq:3 op:add dir:/d2/} fs=/d2/)
      add(/d2/ branch:b3 prev:2)
      #(seq8={bseq:2-2.0 branch:b3 op:add dir:/d2/}
        fs_b3=[/ /d1/ /d2/])`);
  });
  describe('conflict', ()=>{
    t('no_conflict_asc', `s..fs add(/) add(/d1/) add(/d1/dd1/) S..#(seq fs)
      fs(s..M0)     #seq0={}
      tput(0 1    ) #(seq1={op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={op:add dir:/d1/} fs=[/d1/])
      tput(0 1 2 3) #(seq3={op:add dir:/d1/dd1/} fs=[/d1/dd1/])`);
    t('no_conflict_dsc', `s..fs add(/) add(/d1/) add(/d1/dd1/) S..#(seq fs)
      fs(s..M0)     #seq0={}
      tput(0 1 2 3) #(seq1={} seq2={} seq3={op:add dir:/d1/dd1/} fs=[])
      tput(0 1 2  ) #(seq2={op:add dir:/d1/} fs=[])
      tput(0 1    ) #(seq1={op:add dir:/} fs=[/ /d1/ /d1/dd1/])`);
    t('no_conflict_mid', `s..fs add(/) add(/d1/) add(/d1/dd1/) S..#(seq fs)
      fs(s..M0)     #seq0={}
      tput(0 1 2 3) #(seq1={} seq2={} seq3={op:add dir:/d1/dd1/} fs=[])
      tput(0 1    ) #(seq1={op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={op:add dir:/d1/} fs=[/d1/ /d1/dd1/])`);
    t('conflict_no_branch', `buf(d1:1) buf(d2:2)
      s..fs add(/) add(/d1/) add(/d1/f1 buf:d1)
      s1..fs(s..M0) tput(0) tput(0 1) add(/D1/) add(/D1/f2 buf:d2) S..#(seq fs)
      fs(M0)        #seq0={}
      tput(0 1    ) #(seq1={op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={op:add dir:/d1/} fs=[/d1/])
      tput(0 1 2 3) #(seq3={op:add file:/d1/f1 content:1 f2:d1} fs=[/d1/f1])
      tput(0 1 c  ) #(seq2c1={op:add dir:/D1/} seq3c1={} c1fs=[/ /D1/])
      tput(0 1 c d) #(seq3c1={op:add file:/D1/f2 content:1 f2:d2}
                      c1fs=[/D1/f2])
      ##file(/d1/f1)=d1 ##file(/d1/f2)=null ##file(/d1/f1 c:1)=null
      ##file(/D1/f2 c:1)=d2`);
    // XXX: test temporary conflict, conflict+branches and files
  });
  // XXX: test tag
  describe('db', ()=>{
    t('file_add', `s..#(seq fs) buf(d1:1) buf(d2:2) buf(d3:3)
      buf(d4:4) buf(d5:5) buf(d6:6) buf(d7:7) s..fs(db) #seq0={}
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
      ##fs=([/ /f1 /f5 /f6]  b([/ /f1 /f2 /f3 /f4 /f7]))
      ##file(/f1)=d1 ##file(/f1 branch:b)=d1
      ##file(/f2)=null ##file(/f2 branch:b)=d2
      ##file(/f3)=null ##file(/f3 branch:b)=d3
      ##file(/f4)=null ##file(/f4 branch:b)=d4
      ##file(/f5)=d5 ##file(/f5 branch:b)=null
      ##file(/f6)=d6 ##file(/f6 branch:b)=null
      ##file(/f7)=null ##file(/f7 branch:b)=d7`);
    t('multi_branch', `s..#(seq fs) s..fs(db) #seq0={}
      add(/) #(seq1={op:add dir:/} fs=/)
      add(/d1/) #(seq2={op:add dir:/d1/} fs=/d1/)
      add(/d1/dd1/ branch:b1)
        #(seq3={branch:b1 bseq:2-1.0 op:add dir:/d1/dd1/}
        fs_b1=[/ /d1/ /d1/dd1/])
      add(/d1/dd2/)
        #(seq4={bseq:2-1.1 op:add dir:/d1/dd2/} fs_b1=/d1/dd2/)
      add(/d1/dd3/)
        #(seq5={bseq:2-1.2 op:add dir:/d1/dd3/} fs_b1=/d1/dd3/)
      add(/d1/dd1/ddd1/ branch:b2 prev:4)
        #(seq6={branch:b2 bseq:2-1.1-1.0 op:add dir:/d1/dd1/ddd1/}
        fs_b2=[/ /d1/ /d1/dd1/ /d1/dd1/ddd1/ /d1/dd2/])
      add(/d2/ main) #(seq7={bseq:3 op:add dir:/d2/} fs=/d2/)
      add(/d2/ branch:b3 prev:2)
      #(seq8={bseq:2-2.0 branch:b3 op:add dir:/d2/}
        fs_b3=[/ /d1/ /d2/])`);
    t('conflict_no_branch', `buf(d1:1) buf(d2:2)
      s..fs(db) add(/) add(/d1/) add(/d1/f1 buf:d1)
      s1..fs(s..M0) tput(0) tput(0 1) add(/D1/) add(/D1/f2 buf:d2) S..#(seq fs)
      fs(M0)        #seq0={}
      tput(0 1    ) #(seq1={op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={op:add dir:/d1/} fs=[/d1/])
      tput(0 1 2 3) #(seq3={op:add file:/d1/f1 content:1 f2:d1} fs=[/d1/f1])
      tput(0 1 c  ) #(seq2c1={op:add dir:/D1/} seq3c1={} c1fs=[/ /D1/])
      tput(0 1 c d) #(seq3c1={op:add file:/D1/f2 content:1 f2:d2}
                      c1fs=[/D1/f2])
      ##file(/d1/f1)=d1 ##file(/d1/f2)=null ##file(/d1/f1 c:1)=null
      ##file(/D1/f2 c:1)=d2`);
  });
});

describe('git', ()=>{
  describe('util', function(){
    it('parse_commit', ()=>{
      const t = (val, exp)=>assert.deepEqual(git_util.parse_commit(val), exp);
      t('tree d1718651c1c6fd695c8ecfd3dac98c793c62b33d\n'+
        'parent 632392939fe3e3abcfd259ef24f2ff2a08d55f73\n'+
        'author lif-rnd <lif.zone.main@gmail.com> 1670841758 +0200\n'+
        'committer lif-rnd <lif.zone.main@gmail.com> 1670841758 +0200\n'+
        '\nCommit from cli with pgp\n'+
        '\nSigned-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
        {parent: ['632392939fe3e3abcfd259ef24f2ff2a08d55f73'],
        tree: 'd1718651c1c6fd695c8ecfd3dac98c793c62b33d',
        author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670841758, timezoneOffset: -120},
        committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670841758, timezoneOffset: -120},
        message: 'Commit from cli with pgp\n\n'+
          'Signed-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
      });
      t('tree d1718651c1c6fd695c8ecfd3dac98c793c62b33d\n'+
        'parent 632392939fe3e3abcfd259ef24f2ff2a08d55f73\n'+
        'author lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
        'committer lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
        '\nCommit from cli with pgp\n'+
        '\nSigned-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
        {parent: ['632392939fe3e3abcfd259ef24f2ff2a08d55f73'],
        tree: 'd1718651c1c6fd695c8ecfd3dac98c793c62b33d',
        author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670841758, timezoneOffset: 0},
        committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670841758, timezoneOffset: 0},
        message: 'Commit from cli with pgp\n\n'+
          'Signed-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
      });
      t('tree d1718651c1c6fd695c8ecfd3dac98c793c62b33d\n'+
        'parent 632392939fe3e3abcfd259ef24f2ff2a08d55f73\n'+
        'author lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
        'committer lif-rnd <lif.zone.main@gmail.com> 1670841758 +0000\n'+
        '\nCommit from cli with pgp\n'+
        '\nSigned-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
        {parent: ['632392939fe3e3abcfd259ef24f2ff2a08d55f73'],
        tree: 'd1718651c1c6fd695c8ecfd3dac98c793c62b33d',
        author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670841758, timezoneOffset: 0},
        committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
          timestamp: 1670841758, timezoneOffset: 0},
        message: 'Commit from cli with pgp\n\n'+
          'Signed-off-by: lif-rnd <lif.zone.main@gmail.com>\n',
      });
      t('tree 078aefbd762262acbb1fe3d372493017d954ab27\n'+
        'parent 4ee9e2edc6655e077b2b01f379b7acc5e3c35d8f\n'+
        'author lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200\n'+
        'committer lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200\n'+
        'gpgsig -----BEGIN PGP SIGNATURE-----\n'+
        ' \n'+
        ' iQGzBAABCgAdFiEEndepdIBVI/JR3VFqk63BrWpcXVgFAmOXBx8ACgkQk63BrWpc\n'+
        ' XVhX5AwAj0KkfEYd5jEm9Si5t4EfT0vFQqC2pHcBEwJB8g0Rvoq0otx4QEEHSYiE\n'+
        ' 1yNxxrl3Ei0/EFZsADDJ5oZODXEZGssQgIfRPphoqueMmcl/IQ9J5mtgaGS+0EtX\n'+
        ' pIt0ztktIJ3i1EZeSR3EB6Cch5gXORtWhDHTCgk8gReskuSLXm6f37V6PFM+mVl5\n'+
        ' 7ZfyV0H6paumCPubgQFJ60y2o4FC2jGe4MYiIZEU1x7l6WG808PSWBe3FknTG0yW\n'+
        ' 0vYpAwTfD7io5Q5HQzbjzyo+Z8xtj13zsfU1Lw/P3pMdgbOvDckvArgvCV23kD4A\n'+
        ' 3SmNdtToYwsTpMTEyPX7lZ+aOPsU4kyEHa/eDNZ41MsQOPajBFi+S1eTHBL7RxON\n'+
        ' o0u2MFoFEBmpNsLnVJUnY9a72tdeldGq5NKq1mrZIccOq88ybzlGWaVBAmGwTGXb\n'+
        ' I0XQP0JuNdGqXP50yMSzsqNpNIZPK6vrl6o7Faz2Y595cZbR+/XGnwmlaqTYTidX\n'+
        ' rFCDMFtn\n'+
        ' =gY2P\n'+
        ' -----END PGP SIGNATURE-----\n'+
        '\n'+
        'test\n', {
          tree: '078aefbd762262acbb1fe3d372493017d954ab27',
          parent: ['4ee9e2edc6655e077b2b01f379b7acc5e3c35d8f'],
          author: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
            timestamp: 1670842140, timezoneOffset: -120},
          committer: {name: 'lif-rnd', email: 'lif.zone.main@gmail.com',
            timestamp: 1670842140, timezoneOffset: -120},
          gpgsig: '-----BEGIN PGP SIGNATURE-----\n\n'+
          'iQGzBAABCgAdFiEEndepdIBVI/JR3VFqk63BrWpcXVgFAmOXBx8ACgkQk63BrWpc\n'+
          'XVhX5AwAj0KkfEYd5jEm9Si5t4EfT0vFQqC2pHcBEwJB8g0Rvoq0otx4QEEHSYiE\n'+
          '1yNxxrl3Ei0/EFZsADDJ5oZODXEZGssQgIfRPphoqueMmcl/IQ9J5mtgaGS+0EtX\n'+
          'pIt0ztktIJ3i1EZeSR3EB6Cch5gXORtWhDHTCgk8gReskuSLXm6f37V6PFM+mVl5\n'+
          '7ZfyV0H6paumCPubgQFJ60y2o4FC2jGe4MYiIZEU1x7l6WG808PSWBe3FknTG0yW\n'+
          '0vYpAwTfD7io5Q5HQzbjzyo+Z8xtj13zsfU1Lw/P3pMdgbOvDckvArgvCV23kD4A\n'+
          '3SmNdtToYwsTpMTEyPX7lZ+aOPsU4kyEHa/eDNZ41MsQOPajBFi+S1eTHBL7RxON\n'+
          'o0u2MFoFEBmpNsLnVJUnY9a72tdeldGq5NKq1mrZIccOq88ybzlGWaVBAmGwTGXb\n'+
          'I0XQP0JuNdGqXP50yMSzsqNpNIZPK6vrl6o7Faz2Y595cZbR+/XGnwmlaqTYTidX\n'+
          'rFCDMFtn\n=gY2P\n-----END PGP SIGNATURE-----',
          message: 'test\n'
        });
        let gpg_sig =
        ' wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
        ' brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
        ' 1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
        ' NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
        ' FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
        ' L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
        ' =dun1\n';
        t('tree 1b130e91ce06ba813c9695da80eb58152fe32587\n'+
          'author lif-rnd <79463501+lif-rnd@users.noreply.github.com> '+
          '1670839296 +0200\n'+
          'committer GitHub <noreply@github.com> 1670839296 +0200\n'+
          'gpgsig -----BEGIN PGP SIGNATURE-----\n'+
          ' \n'+gpg_sig+
          ' -----END PGP SIGNATURE-----\n'+
          ' \n'+
          '\n'+
          'Create file_from_www', {
          tree: '1b130e91ce06ba813c9695da80eb58152fe32587',
          parent: [],
          author: {name: 'lif-rnd',
            email: '79463501+lif-rnd@users.noreply.github.com',
            timestamp: 1670839296, timezoneOffset: -120},
          committer: {name: 'GitHub', email: 'noreply@github.com',
            timestamp: 1670839296, timezoneOffset: -120},
          gpgsig: '-----BEGIN PGP SIGNATURE-----\n\n'+
          'wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
          'brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
          '1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
          'NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
          'FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
          'L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
          '=dun1\n'+
          '-----END PGP SIGNATURE-----\n',
          message: 'Create file_from_www'
        });
    });
    it('render_header', ()=>{
      let t = (key, val, exp)=>assert.strictEqual(
        git_util.render_header(key, val), exp);
      t('tree', '1b130e91ce06ba813c9695da80eb58152fe32587',
        'tree 1b130e91ce06ba813c9695da80eb58152fe32587\n');
      t('author', 'lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200',
        'author lif-rnd <lif.zone.main@gmail.com> 1670842140 +0200\n');
      t('gpgsig', '-----BEGIN PGP SIGNATURE-----\n\n'+
        'wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
        'brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
        '1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
        'NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
        'FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
        'L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
        '=dun1\n'+
        '-----END PGP SIGNATURE-----\n',
        'gpgsig -----BEGIN PGP SIGNATURE-----\n'+
        ' \n'+
        ' wsBcBAABCAAQBQJjlvwACRBK7hj4Ov3rIwAAAswIAFPmNEqZow/IUewkig8OnOot\n'+
        ' brQTqOE9qb83naHpE6cGNOq+uOn0Twav6xsWI5B7/h7t0kOPMUPJcA8xmxduGN4+\n'+
        ' 1Sw0ByvVoeO3x/UOpavv5SayuyOuxFNOasHFrHwne4ONyzM5J8EUkV4/oHYE+2jZ\n'+
        ' NWeJlvSSg85wA23YF1/7tAFV/wZrC3tFkFht3ZQraHDNBV2nG/vqUxtPxuvRAR8V\n'+
        ' FwIGDJ4uYW1gSxMdAP6MPFVkY+pzJmzEHKT22TC1InhZ5mklEPDNuSnuYAxRE2Cs\n'+
        ' L/O964lnhIfRpRUuuN7Fq02PHWSgtcsav++OrzjM+75Tp8JMz5a8FUOTIqSpaZk=\n'+
        ' =dun1\n -----END PGP SIGNATURE-----\n \n');
    });
    describe('git_to_scroll', function(){
      this.timeout(10000); // XXX: git checkout/pull is slow
      const t = (name, test)=>it(name, ()=>test_run(test));
      // XXX: verify seq0 has the correct headers
      // XXX: do we need author in scroll header
      // XXX: derry: review encode_str/decode_str
      let desc5 = encode_str('Commit from cli with pgp\n\n'+
        'Signed-off-by: lif-rnd <lif.zone.main@gmail.com>');
      t('gpg', `s..#seq git(src(lif-rnd/test_gpg)) #seq0={}
        sync #(
        seq1={op:add dir:/
          git:{oid:1b130e91ce06ba813c9695da80eb58152fe32587 mode:0}}
        seq2={op:add file:/file_from_www content:1 f2:0x0a
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        // XXX: missing more stuff in commit (eg author, gpg, ts)
        seq3={group:2 op:commit desc(Create file_from_www)
          git:{oid:632392939fe3e3abcfd259ef24f2ff2a08d55f73}}
        seq4={link:2 op:add file:/file_from_cli
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq5={op:commit desc(${desc5})
          git:{oid:4ee9e2edc6655e077b2b01f379b7acc5e3c35d8f}}
        seq6={op:mod file:/file_from_cli content:1 f2:0x76320a
          git:{oid:8c1384d825dbbe41309b7dc18ee7991a9085c46e mode:100644}}
        seq7={op:commit desc(test)
          git:{oid:ca6b21664600f971cdeadbd357b98fd37ee53d8f}})`);
      // XXX: find proper way to fix xxx
      let d2 = '0x66696c6520613a0a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a';
      let d10 = '0x66696c6520630a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a58585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858585858580a';
      // XXX: mv git to lif-rnd
      t('move', `s..#seq git(src(lif-zone/test_move)) #seq0={}
        sync #(
        seq1={op:add dir:/
          git:{oid:56fb07d314f8b32b4f125895c9c2711f8dc66f1d mode:0}}
        seq2={op:add file:/a content:1 f2:${d2}
          git:{oid:7780c82f7ec168abd6f2cd9f756058fcedad80f2 mode:100644}}
        seq3={group:2 op:commit desc(Create a)
          git:{oid:4160553ff40409ebd42a5cf29c02b3e0d2cade54}}
        // XXX derry: detect move /a -> /b?
        seq4={op:rm file:/a}
        seq5={op:add file:/b link:2
          git:{oid:7780c82f7ec168abd6f2cd9f756058fcedad80f2 mode:100644}}
        seq6={group:2 op:commit desc(move a to b)
          git:{oid:d13f423f4853887bd7503f078b2887da6b64e43b}}
        seq7={op:add dir:/dir1/
          git:{oid:ae9feeea8f8441f0aead5573258d0c53a945a488 mode:040000}}
        seq8={op:add file:/dir1/b link:2
          git:{oid:7780c82f7ec168abd6f2cd9f756058fcedad80f2 mode:100644}}
        seq9={group:2 op:commit desc(move /b -> /dir1/b)
          git:{oid:05dfa3ebd084699425fe3ac202ec7cae7bbee89b}}
        seq10={op:add file:/dir1/c content:1 f2:${d10}
          git:{oid:bc9e3e7b4c0e05a8efb4942498c1afc86d431672 mode:100644}}
        seq11={op:commit desc(add c)
          git:{oid:3538536829ce7864fa53cdd85b78af1e8c5c8522}}
        // XXX derry: detect move /dir1/ -> /dir2/
        seq12={op:rm file:/dir1/c}
        seq13={op:rm file:/dir1/b}
        seq14={op:rm dir:/dir1/}
        seq15={op:add dir:/dir2/
          git:{oid:9129578255419d388a0419d7141018caabf23743 mode:040000}}
        seq16={op:add file:/dir2/b link:2
          git:{oid:7780c82f7ec168abd6f2cd9f756058fcedad80f2 mode:100644}}
        seq17={op:add file:/dir2/c link:10
          git:{oid:bc9e3e7b4c0e05a8efb4942498c1afc86d431672 mode:100644}}
        seq18={op:commit group:6 desc(/dir1 -> /dir2)
          git:{oid:a7dc61ad160e9e5d004f02b86e79bc289ad24af8}}
        seq19={op:rm file:/b}
        seq20={op:add dir:/b/
          git={oid:457a6ae49e105547244493d0f5426725c4fd2d20 mode:040000}}
        seq21={op:add file:/b/a content:1 f2:0x7878780a
          git={oid:d6459e005434a49a66a3ddec92279a86160ad71f mode:100644}}
        seq22={group:3 op:commit desc(change b from file to dir)
          git:{oid:c0232fb014456ae8ee9b8060121a67016eda6512}}
        seq23={op:rm file:/b/a}
        seq24={op:rm dir:/b/}
        seq25={op:add file:/b content:1 f2:0x5858585f626262620a
          git:{oid:6d700c06af2977bb61a59cdefb4957ec3ef4f6ff mode:100644}}
        seq26={group:3 op:commit desc(change b from dir to file)
          git:{oid:aa18f16781702a407f879aca38902577418f7cb3}})`);
      let desc18 = encode_str('Merge pull request #1 from lif-zone/branch1'+
        '\n\nMerge from Branch1');
      let d19 = '0x6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a6d61696e5f66696c65330a';
      let d21 = '0x4040202d312c3238202b312c33322040400a2b5858582530410a206d61696e5f66696c65332530416d61696e5f66696c65332530416d61696e5f660a';
      t('merge_simple', `s..#seq git(src(lif-zone/test_merge_simple)) #seq0={}
        sync #(
        seq1={op:add dir:/
          git:{oid:32cc970d8d2957a4f613b17070297f3c5ef6397a mode:0}}
        seq2={op:add file:/main_file1 content:1 f2:0x0a
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq3={op:commit group:2 desc(Create main_file1)
          git:{oid:90d08c6fe5d7a766218f3db8355402d1e88030a9}}
        seq4={op:mod file:/main_file1 content:1 f2:0x66696c65310a
          git:{oid:e2129701f1a4d54dc44f03c93bca0a2aec7c5449 mode:100644}}
        seq5={op:commit desc(Update main_file1)
          git:{oid:ff1c84df1f072b79a8fe8cc0edb3ed24e33134c8}}
        seq6={op:add file:/main_file2 content:1 f2:0x66696c65320a
          git:{oid:6c493ff740f9380390d5c9ddef4af18697ac9375 mode:100644}}
        seq7={op:commit desc(Create main_file2)
          git:{oid:ab861bddf2f5674d199ac1d04aa420286c2b4de6}}
        seq8={op:add file:/main_file3 content:1 f2:0x6d61696e5f66696c65330a
          git:{oid:9df9148b245e84d4eefc7adfb9d747c2a3e6966a mode:100644}}
        seq9={op:commit desc(Create main_file3)
          git:{oid:0999c0da6a48c7fb3e12a2478af689abe84ccd36}}
        seq10={op:add file:/branch_file1
          content:1 f2:0x6272616e63685f66696c65310a
          git:{oid:81feec21ec7e7b068f45ca64ca352e151331fcf2 mode:100644}}
        seq11={op:add file:/branch_file2 content:1
          f2:0x6272616e63685f66696c65320a
          git:{oid:00cd2033b090d099f771e57f39f23c858c22f651 mode:100644}}
        seq12={group:2 op:commit desc(${desc18})
          git:{oid:529918326b683cebb869faa11ee487f70828fb31}}
        seq13={op:mod file:/main_file3 content:1 f2:${d19}
          git:{oid:70350ee2b46550a16f7f3e4ab189620f89194ce3 mode:100644}}
        seq14={op:commit desc(Update main_file3)
          git:{oid:3c32b322655215d3723de7362a6880bb7ff20e4d}}
        seq15={op:mod file:/main_file3 diff:1 link:13 f2=${d21}
          git:{oid:c11256c184e585acd4bc63f86adc1b4cb512affa mode:100644}}
        seq16={op:commit desc(Update main_file3)
          git:{oid:e37d0cbddd4c351996dae2a01f04986dbab5b071}}
        seq17={bseq:7-1.0 branch:branch1 op:add file:/branch_file1 link:10
          git:{oid:81feec21ec7e7b068f45ca64ca352e151331fcf2 mode:100644}}
        seq18={bseq:7-1.1 op:commit desc(Create branch_file1)
          git:{oid:8ed244dd4cf2cac485cfe0665e0450f0fbb7e71e}}
        seq19={bseq:7-1.2 op:add file:/branch_file2 link:11
          git:{oid:00cd2033b090d099f771e57f39f23c858c22f651 mode:100644}}
        seq20={bseq:7-1.3 op:commit desc(Create branch_file2)
          git:{oid:d4181b6ca66e54bb077feb44f6554d0c6236ba2b}}
        // XXX: missing test_tag1
        )`);
      d2='0x66696c65310a'+('58'.repeat(99)+'0a').repeat(8);
      let desc7 = encode_str('Merge pull request #1 from lif-rnd/branch1'+
        '\n\nmerge branch1');
      t('branch', `s..#seq git(src(lif-rnd/test_branch)) #seq0={}
        sync #(
        seq1={op:add dir:/
          git:{oid:35338222e6691c303d4bc6768450229d93e14c67 mode:0}}
        seq2={op:add file:/file1 content:1 f2:${d2}
          git:{oid:634568dfc1c5c07e337f2d99a472a8d9b03c3964 mode:100644}}
        seq3={group:2 op:commit desc(Create file1)
          git:{oid:cb42290303d83a9254397228e586f45539bbe010}}
        seq4={op:add file:/file3 content:1 f2:0x0a
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq5={op:commit desc(Create file3)
          git:{oid:549f06c75c8818b582f552d110094a4b617196f9}}
        seq6={op:add file:/file1-branch1 link:4
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq7={op:commit desc(${desc7})
          git:{oid:ebfa9a6980f982ffef775895cbb5a6e48a3cfc3c}}
        seq8={bseq:3-1.0 branch:branch1 op:add file:/file1-branch1 link:4
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq9={bseq:3-1.1 op:commit desc(Create file1-branch1)
          git:{oid:f748254314933c43f7992743c3ef8c04f7f0a70d}}
        seq10={bseq:3-2.0 branch:branch2 op:add file:/file1-branch2 link:4
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq11={bseq:3-2.1 op:commit desc(Create file1-branch2)
          git:{oid:63f7e4a5ba325b71f00f32dc53d45a606c1b75eb}}
        seq12={bseq:3-2.1-1.0 branch:branch2_b1 op:add file(/file1 branch2b1)
          link:4
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq13={bseq:3-2.1-1.1 op:commit desc(Create file1 branch2b1)
          git:{oid:70327166e0bbc36da012739545f77e392f6557f5}}
        seq14={bseq:3-3.0 branch:branch3 op:add file(/file2 branch3)
          link:4
          git:{oid:8b137891791fe96927ad78e64b0aad7bded08bdc mode:100644}}
        seq15={bseq:3-3.1 op:commit desc(Create file2 branch3)
          git:{oid:9215645089772245e3583f257527e4ac40093607}})`);
    });
  });
});

