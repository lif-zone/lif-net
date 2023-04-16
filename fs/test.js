'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import {execSync} from 'node:child_process';
import fs from 'fs';
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
  parse_exp_arg_pair, parse_push, get_array_str, get_bool} = tparser;
import {test_run, new_scroll, get_scroll, get_def, test_register,
  test_register_cmd, get_val, parse_db_init, js_struct_from_str}
  from '../storage/test_cmd.js';

xtest.init();
// XXX: use memoryDatabase: ':memory:'
DB.init({shim_conf: {checkOrigin: false, databaseBasePath: '/tmp',
  deleteDatabaseFiles: true, useSQLiteIndexes: true}});
let t_buf, t_git_repo_dir;

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
  let name = t.ctx||get_def('left'), M, db_opt, src, head;
  assert(!t.l, 'invalid arg '+t.meta.s);
  assert(!get_scroll(name, true), 'scroll already exist '+name);
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp), t2, a;
    switch (tt.cmd){
    case 'src': src = 'https://github.com/'+tt.r; break;
    case 'head': head = tt.r; break;
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
  let scroll_decl = {git: src ? {src} : undefined};
  if (head){
    scroll_decl.git = scroll_decl.git||{};
    scroll_decl.git.head = head;
  }
  yield new_scroll(name, M, null, t.prev?.ctx, db_opt, scroll_decl,
    function create_func(opt, d){ return GIT.create(opt, d); },
    function open_func(opt){ return GIT.open(opt); });
});

const cmd_sync = t=>etask(function*cmd_sync(){
  let name = t.ctx||get_def('left'), git = get_scroll(name);
  let gitdir, src, err, flip_protect, head, seal;
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    let tt = parse_exp_arg(curr.exp);
    switch (tt.cmd){
    case 'gitdir': gitdir = tt.r; break;
    case 'head': head = tt.r; break;
    case 'seal': seal = get_bool(tt.r); break;
    case 'src': src = 'https://github.com'+tt.r; break;
    case 'flip_protect':
      flip_protect = tt.r=='false' ? false : tt.r||true;
      break;
    case 'err': err = tt.r||undefined; break;
    default: assert.fail('invalid sync arg '+tt.cmd);
    }
  }
  try {
    yield git.sync({head, gitdir, src, flip_protect, seal});
    assert.equal(undefined, err, 'did not get expected error');
  } catch(e){ assert.equal(''+e, err); }
});

const cmd_verify_git = t=>etask(function*cmd_verify_git(){
  let name = t.ctx||get_def('left'), git = get_scroll(name), cfid = 0;
  assert(!t.r, 'invalid args');
  yield git.verify_git({cfid});
});

const cmd_fs_write = t=>etask(function*cmd_fs_write(){
  let file, buf;
  for (let curr=t.r, i=0; curr = parse_get_next(curr); i++){
    if (!file)
      file = curr.exp;
    else if (!buf){
      assert(t_buf[curr.exp], 'buf not found '+curr.exp);
      buf = t_buf[curr.exp];
    } else
      assert.fail('invalid fs_write '+t.r);
  }
  fs.writeFileSync(file, buf);
});

const cmd_fs_mkdir = t=>etask(function*cmd_fs_mkdir(){
  let dir = t.r;
  fs.mkdirSync(dir, {recursive: true});
});

const cmd_fs_cp = t=>etask(function*cmd_fs_cp(){
  let a = t.r.split(' '), [src, dst] = a;
  assert(src, 'missing src');
  assert(dst, 'missing dst');
  assert.equal(a.length, 2, 'too many args');
  // XXX: HACK
  fs.rmSync('/tmp/__lif_test/git_test/sync', {recursive: true, force: true});
  fs.cpSync(src, dst, {force: true, recursive: true});
});

const cmd_git_cleanup = t=>etask(function*cmd_git_cleanup(){
  fs.rmSync('/tmp/__lif_test', {recursive: true, force: true});
});

const cmd_git_init = t=>etask(function*cmd_git_init(){
  let repo_dir = t.r;
  assert(t.r, 'missing repo_dir');
  t_git_repo_dir = repo_dir;
  execSync('git init '+repo_dir);
});

const cmd_git_add = t=>etask(function*cmd_git_add(){
  let file = t.r;
  assert(t.r, 'missing file');
  execSync('git add '+file, {cwd: t_git_repo_dir});
});

const cmd_git_commit = (curr, t)=>etask(function*cmd_git_commit(){
  let a = t.r.split(' '), [oid, msg] = a;
  assert(oid, 'missing commit oid var');
  assert(msg, 'missing commit message');
  assert.equal(a.length, 2, 'too many args');
  execSync('git commit --allow-empty -m "'+msg+'"', {cwd: t_git_repo_dir});
  let log = execSync('git log', {cwd: t_git_repo_dir}).toString();
  let m = log.match(/^commit ([0-9a-f]+)\n/);
  parse_push(curr, '$$'+oid+'('+m[1]+')');
});

const cmd_git_br_new = t=>etask(function*cmd_git_br_new(){
  let br = t.r;
  assert(t.r, 'missing branch');
  execSync('git checkout -b'+br, {cwd: t_git_repo_dir, stdio: 'ignore'});
});

const cmd_git_br_del = t=>etask(function*cmd_git_br_del(){
  let br = t.r;
  assert(t.r, 'missing branch');
  execSync('git branch -D '+br, {cwd: t_git_repo_dir, stdio: 'ignore'});
});

const cmd_git_br_rename = t=>etask(function*cmd_git_br_rename(){
  let a = t.r.split(' '), [br_old, br_new] = a;
  assert(br_old, 'missing branch');
  assert(br_new, 'missing branch');
  assert.equal(a.length, 2, 'too many args');
  execSync('git branch -m '+br_old+' '+br_new,
    {cwd: t_git_repo_dir, stdio: 'ignore'});
});

const cmd_git_br = t=>etask(function*cmd_git_br(){
  let br = t.r;
  assert(t.r, 'missing branch');
  execSync('git checkout '+br, {cwd: t_git_repo_dir, stdio: 'ignore'});
});

const cmd_git_br_orphan = t=>etask(function*cmd_git_br_orphan(){
  let br = t.r;
  assert(t.r, 'missing branch');
  execSync('git checkout --orphan '+br,
    {cwd: t_git_repo_dir, stdio: 'ignore'});
});

const cmd_git_tag = t=>etask(function*cmd_git_tag(){
  let a = t.r.split(' '), [tag, commit] = a;
  commit = commit||'';
  assert(tag, 'missing tag');
  assert(commit, 'missing commit');
  assert(a.length<=3, 'too many args');
  execSync('git tag -f '+tag+' '+commit, {cwd: t_git_repo_dir});
});

const cmd_git_tag_annotate = (curr, t)=>etask(function*cmd_git_tag_annotate(){
  let a = t.r.split(' '), [toid, tag, commit, msg] = a;
  commit = commit||'';
  assert(toid, 'missing toid name');
  assert(tag, 'missing tag');
  assert(commit, 'missing commit');
  assert(msg, 'missing msg');
  assert(a.length==4, 'too many args');
  execSync('git tag -m "'+msg+' " -f '+tag+' '+commit, {cwd: t_git_repo_dir});
  let log = execSync('git show-ref --tags '+tag,
    {cwd: t_git_repo_dir}).toString();
  let m = log.match(/^([0-9a-f]+) .*/);
  xerr.notice('XXX toid %s %s', toid, m[1]);
  parse_push(curr, '$$'+toid+'('+m[1]+')');
});


const cmd_git_tag_del = t=>etask(function*cmd_git_tag_del(){
  let tag = t.r;
  assert(tag, 'missing tag');
  execSync('git tag -d '+tag, {cwd: t_git_repo_dir});
});

const cmd_git_merge = (curr, t)=>etask(function*cmd_git_merge(){
  let a = t.r.split(' '), oid = a[0], msg = a[a.length-1];
  a.shift();
  a.pop();
  assert(oid, 'missing commit oid var');
  assert(msg, 'missing commit message');
  assert(a.length, 'missing branch merge list');
  execSync('git merge --allow-unrelated-histories '+a.join(' ')+
    ' -m "'+msg+'"', {cwd: t_git_repo_dir});
  let log = execSync('git log', {cwd: t_git_repo_dir}).toString();
  let m = log.match(/^commit ([0-9a-f]+)\n/);
  parse_push(curr, '$$'+oid+'('+m[1]+')');
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
  case 'verify_git': yield cmd_verify_git(o); break;
  case 'git_cleanup': yield cmd_git_cleanup(o); break;
  case 'git_init': yield cmd_git_init(o); break;
  case 'git_add': yield cmd_git_add(o); break;
  case 'git_commit': yield cmd_git_commit(curr, o); break;
  case 'git_br_new': yield cmd_git_br_new(o); break;
  case 'git_br_del': yield cmd_git_br_del(o); break;
  case 'git_br_rename': yield cmd_git_br_rename(o); break;
  case 'git_br': yield cmd_git_br(o); break;
  case 'git_br_orphan': yield cmd_git_br_orphan(o); break;
  case 'git_tag': yield cmd_git_tag(o); break;
  case 'git_tag_annotate': yield cmd_git_tag_annotate(curr, o); break;
  case 'git_tag_del': yield cmd_git_tag_del(o); break;
  case 'git_merge': yield cmd_git_merge(curr, o); break;
  case 'fs_write': yield cmd_fs_write(o); break;
  case 'fs_mkdir': yield cmd_fs_mkdir(o); break;
  case 'fs_cp': yield cmd_fs_cp(o); break;
  default: return false;
  }
  return true;
});

const test_get_seq = s=>etask(function*get_seq(){
  let bo = {};
  s = rm_parentesis(s, '{');
  for (let curr=s; curr = parse_get_next(curr);){
    let o = parse_exp(curr.exp);
    if (['f2', 'csum_sha256'].includes(o.l)){ // XXX: ugly
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
    } else if ('desc'==o.l) // XXX: need better way to handle \n
      bo[o.l] = o.r+'\n';
    else if ('desc'==o.cmd) // XXX: need better way to handle \n
      bo[o.cmd] = decode_str(rm_parentesis(o.r, '('))+'\n';
    else if ('_desc'==o.l) // XXX: need better way to handle \n
      bo.desc = o.r;
    else if ('_desc'==o.cmd) // XXX: need better way to handle \n
      bo.desc = decode_str(rm_parentesis(o.r, '('));
    else if ('branch'==o.cmd)
      bo[o.cmd] = rm_parentesis(o.r, '(');
    else if ('file'==o.cmd)
      bo[o.cmd] = rm_parentesis(o.r, '(');
    else if (['content', 'group', 'link', 'diff'].includes(o.l) &&
      /^\d+$/.test(o.r))
    {
      bo[o.l] = +o.r;
    } else
      bo[o.l] = o.r.at(0)=='{' ? js_struct_from_str(o.r) : o.r;
    if (o.l=='git' && !bo.git.oid)
      delete bo.git.oid;
    if (o.l=='git' && !bo.git.branch)
      delete bo.git.branch;
    if (o.l=='git'){
      if (!bo.git.merge)
        delete bo.git.merge;
      else if (bo.git.merge[0]=='[')
        bo.git.merge = get_array_str(bo.git.merge);
    }
    if (!bo.branch)
      delete bo.branch;
    if (o.l=='bseq' && !bo.bseq)
      delete bo.bseq;
  }
  if (bo.git && Object.keys(bo.git).length==0)
    delete bo.git;
  if (bo.git?.gpgsig)
    bo.git.gpgsig = decode_str(rm_parentesis(bo.git.gpgsig, '('));
  if (bo.git?.src)
    bo.git.src = decode_str(bo.git.src);
  if (!bo.op)
    delete bo.op;
  return bo;
});

const git_sha_file = (scroll, filter)=>etask(function*git_sha_file(){
  let ret = {};
  for (let i=0; i<filter.length; i++){
    let t = parse_exp_arg(filter[i]);
    let file, cfid=0, seq;
    assert.strictEqual(t.cmd, 'git_sha_file', 'invalid git_sha_file '+
      filter[i]);
    assert(!t.l, 'invalid git_sha_file '+filter[i]);
    for (let curr=t.r; curr = parse_get_next(curr);){
      let tt = parse_exp_arg_pair(curr.exp);
      switch (tt.l){
      case 'seq': seq = +tt.r; break;
      default:
        if (!file)
          file = tt.l;
        else
          assert.fail('invalid git_sha_file '+tt.l+' for '+filter[i]);
      }
    }
    assert(seq!==undefined, 'missing seq');
    ret[file+' seq:'+seq] = yield scroll.calc_sha_file({file, cfid, seq});
  }
  return ret;
});

const git_sha_dir = (scroll, filter)=>etask(function*git_sha_dir(){
  let ret = {};
  for (let i=0; i<filter.length; i++){
    let t = parse_exp_arg(filter[i]);
    let cfid = 0, dir, seq;
    assert.strictEqual(t.cmd, 'git_sha_dir', 'invalid git_sha_dir '+
      filter[i]);
    assert(!t.l, 'invalid git_sha_dir '+filter[i]);
    for (let curr=t.r; curr = parse_get_next(curr);){
      let tt = parse_exp_arg_pair(curr.exp);
      switch (tt.l){
      case 'seq': seq = +tt.r; break;
      default:
        if (!dir)
          dir = tt.l;
        else
          assert.fail('invalid git_sha_dir '+tt.l+' for '+filter[i]);
      }
    }
    ret[t.r] = yield scroll.calc_sha_dir({dir, cfid, seq});
  }
  return ret;
});

function state_valid_filter(s){
  // XXX: mv seq from storage/test_cmd.js to this file
  switch (s){
  case 'fs': return true;
  case 'file': return true;
  case 'git_sha_file': return true;
  case 'git_sha_dir': return true;
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
  if (m){
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
  m = v.match(/^git_sha_file\((.*)\)$/);
  if (m){
    let name = def||get_def('left'), file = m[1];
    return {name, type: 'git_sha_file', key: file};
  }
  m = v.match(/^git_sha_dir\((.*)\)$/);
  if (m){
    let name = def||get_def('left'), dir = m[1];
    return {name, type: 'git_sha_dir', key: dir};
  }
  assert.fail('invalid var '+v);
}

function state_apply(state, o){
  let {val, key, branch, cfid} = o;
  if (o.type=='git_sha_file'){
    let so = state.git_sha_file = state.git_sha_file||{};
      so[key] = !val ? undefined : val;
  } else if (o.type=='git_sha_dir'){
    let so = state.git_sha_dir = state.git_sha_dir||{};
      so[key] = !val ? undefined : val;
  } else if (o.type=='fs'){
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
  if (/^git_sha_file/.test(o.l))
    return {...state_split_var(o.l, def), val: o.r};
  if (/^git_sha_dir/.test(o.l))
    return {...state_split_var(o.l, def), val: o.r};
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
    state.file[o.file] = yield fs.get_file(o.file, o);
  } else if (filter.find(s=>/^git_sha_file/.test(s)))
    state.git_sha_file = yield git_sha_file(fs, filter);
  else if (filter.find(s=>/^git_sha_dir/.test(s)))
    state.git_sha_dir = yield git_sha_dir(fs, filter);
});

function state_assert(filter, state_curr, state_exp){
  if (filter.find(s=>/^fs/.test(s)))
    assert.deepEqual(state_curr.fs, state_exp.fs, 'state fs mismatch');
  if (filter.find(s=>/^file/.test(s)))
    assert.deepEqual(state_curr.file, state_exp.file, 'state file mismatch');
  if (filter.find(s=>/^git_sha_dir/.test(s))){
    assert.deepEqual(state_curr.git_sha_dir, state_exp.git_sha_dir,
      'state git_sha_dir mismatch');
  }
  if (filter.find(s=>/^git_sha_file/.test(s))){
    assert.deepEqual(state_curr.git_sha_file, state_exp.git_sha_file,
      'state git_sha_file mismatch');
  }
  if (filter.find(s=>/^git_sha_dir/.test(s))){
    assert.deepEqual(state_curr.git_sha_dir, state_exp.git_sha_dir,
      'state git_sha_dir mismatch');
  }
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
  else if (/^git_sha_file\(.*\)$/.test(filter))
    return filter+'='+s;
  if (/^git_sha_dir\(.*\)$/.test(filter))
    return filter+'='+s;
}

const test_start = ()=>etask(function*test_start(){
  t_buf = {};
  yield cmd_git_cleanup();
});

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
      add(/)        #(seq1={type:fs op:add dir:/} fs=/)
      add(/d1/)     #(seq2={type:fs op:add dir:/d1/} fs=/d1/)
      add(/d1/dd1/) #(seq3={type:fs op:add dir:/d1/dd1/} fs=/d1/dd1/)
      add(/d1/dd2/) #(seq4={type:fs op:add dir:/d1/dd2/} fs=/d1/dd2/)
      add(/d2/)     #(seq5={type:fs op:add dir:/d2/} fs=/d2/)
      add(/d2/dd1/) #(seq6={type:fs op:add dir:/d2/dd1/} fs=/d2/dd1/)
      add(/d2/dd2/) #(seq7={type:fs op:add dir:/d2/dd2/} fs=/d2/dd2/)
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
      add(/)         #(seq1={type:fs op:add dir:/} fs=/)
      add(/d1/)      #(seq2={type:fs op:add dir:/d1/} fs=/d1/)
      add(/d2/)      #(seq3={type:fs op:add dir:/d2/} fs=/d2/)
      add(/d2/dd2/)  #(seq4={type:fs op:add dir:/d2/dd2/} fs=/d2/dd2/)
      rm(/d1/)       #(seq5={type:fs op:rm dir:/d1/} fs=!/d1/)
      rm(/d2/dd2/)   #(seq6={type:fs op:rm dir:/d2/dd2/} fs=!/d2/dd2/)
      rm(/d2/)       #(seq7={type:fs op:rm dir:/d2/} fs=!/d2/)
      ##fs1=[/]
      ##fs2=[/ /d1/]
      ##fs3=[/ /d1/ /d2/]
      ##fs4=[/ /d1/ /d2/ /d2/dd2/]
      ##fs5=[/ /d2/ /d2/dd2/]
      ##fs6=[/ /d2/]
      ##fs7=[/]
      ##fs=[/]`);
    t('rm_multi', `s..#(seq fs) s..fs #(seq0={})
      add(/)         #(seq1={type:fs op:add dir:/} fs=/)
      add(/d/)       #(seq2={type:fs op:add dir:/d/} fs=/d/)
      add(/d/dd1/)   #(seq3={type:fs op:add dir:/d/dd1/} fs=/d/dd1/)
      add(/d/dd2/)   #(seq4={type:fs op:add dir:/d/dd2/} fs=/d/dd2/)
      rm(/d/)        #(seq5={type:fs op:rm dir:/d/dd2/} seq6={type:fs
                     op:rm dir:/d/dd1/} seq7={type:fs op:rm dir:/d/}
                     fs=[!/d/ !/d/dd1/ !/d/dd2/])
      ##fs1=[/]
      ##fs2=[/ /d/]
      ##fs3=[/ /d/ /d/dd1/]
      ##fs4=[/ /d/ /d/dd1/ /d/dd2/]
      ##fs5=[/ /d/ /d/dd1/]
      ##fs6=[/ /d/]
      ##fs7=[/]
      ##fs=[/]`);
    let stest = `s..#(seq fs) s..fs #(seq0={})
      add(/)            #(seq1={type:fs op:add dir:/} fs=/)
      add(/d/)          #(seq2={type:fs op:add dir:/d/} fs=/d/)
      add(/d/dd1/)      #(seq3={type:fs op:add dir:/d/dd1/} fs=/d/dd1/)
      add(/d/dd1/ddd1/) #(seq4={type:fs op:add dir:/d/dd1/ddd1/}
                        fs=/d/dd1/ddd1/)
      add(/d/dd2/)      #(seq5={type:fs op:add dir:/d/dd2/} fs=/d/dd2/)
      add(/d/dd2/ddd1/) #(seq6={type:fs op:add dir:/d/dd2/ddd1/}
                        fs=/d/dd2/ddd1/)
      add(/d/dd2/ddd2/) #(seq7={type:fs op:add dir:/d/dd2/ddd2/}
                        fs=/d/dd2/ddd2/)`;
    t('rm_multi_deep_rm_/', stest+` rm(/) #(
      seq8={type:fs op:rm dir:/d/dd2/ddd2/}
      seq9={type:fs op:rm dir:/d/dd2/ddd1/}
      seq10={type:fs op:rm dir:/d/dd2/}
      seq11={type:fs op:rm dir:/d/dd1/ddd1/}
      seq12={type:fs op:rm dir:/d/dd1/}
      seq13={type:fs op:rm dir:/d/}
      seq14={type:fs op:rm dir:/}
      fs=[!/ !/d/ !/d/dd1/ !/d/dd1/ddd1/ !/d/dd2/ !/d/dd2/ddd1/ !/d/dd2/ddd2/]
    )`);
    t('rm_multi_deep_rm_/d/', stest+` rm(/d/) #(
      seq8={type:fs op:rm dir:/d/dd2/ddd2/}
      seq9={type:fs op:rm dir:/d/dd2/ddd1/}
      seq10={type:fs op:rm dir:/d/dd2/}
      seq11={type:fs op:rm dir:/d/dd1/ddd1/}
      seq12={type:fs op:rm dir:/d/dd1/}
      seq13={type:fs op:rm dir:/d/}
      fs=[!/d/ !/d/dd1/ !/d/dd1/ddd1/ !/d/dd2/ !/d/dd2/ddd1/ !/d/dd2/ddd2/])`);
    t('rm_multi_deep_rm_/d/dd1/', stest+` rm(/d/dd1/) #(
      seq8={type:fs op:rm dir:/d/dd1/ddd1/}
      seq9={type:fs op:rm dir:/d/dd1/}
      fs=[!/d/dd1/ !/d/dd1/ddd1/])`);
    t('rm_multi_deep_rm_/d/dd2', stest+` rm(/d/dd2/) #(
      seq8={type:fs op:rm dir:/d/dd2/ddd2/}
      seq9={type:fs op:rm dir:/d/dd2/ddd1/}
      seq10={type:fs op:rm dir:/d/dd2/}
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
      add(/f1 buf:d) #seq1={type:fs op:add file:/f1 content:1 f2:d}`);
    t('add_buf_len_a', `s..#seq buf(d:a) s..fs(len) #seq0={}
      add(/f1 buf:d) #seq1={type:fs op:add file:/f1 len:2 content:1 f2:d}`);
    t('add_buf_len_ab', `s..#seq buf(d:ab) s..fs(len) #seq0={}
      add(/f1 buf:d) #seq1={type:fs op:add file:/f1 len:3 content:1 f2:d}`);
    t('add_empty', `s..#seq s..fs #seq0={} add(/f1)
      #seq1={type:fs op:add file:/f1}`);
    t('add_two_diff', `s..#seq buf(d1:0) buf(d2:1) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={type:fs op:add file:/f1 content:1 f2:d1}
      add(/f2 buf:d2) #seq2={type:fs op:add file:/f2 content:1 f2:d2}`);
    t('add_two_same_def', `s..#seq buf(d:0) s..fs #seq0={}
      add(/f1 buf:d) #seq1={type:fs op:add file:/f1 content:1 f2:d}
      add(/f2 buf:d) #seq2={type:fs op:add file:/f2 content:1 f2:d}`);
    t('add_two_same_sha256', `s..#seq buf(d:0) s..fs(csum_sha256) #seq0={}
      add(/f1 buf:d) #seq1={type:fs op:add file:/f1 content:1 f2:d
        csum_sha256:sha256(d)}
      add(/f2 buf:d) #seq2={type:fs op:add file:/f2 link:1
        csum_sha256:sha256(d)}`);
    t('add_three_same_sha256', `s..#seq buf(d:0) s..fs(csum_sha256) #seq0={}
      add(/f1 buf:d) #seq1={type:fs op:add file:/f1 content:1 f2:d
        csum_sha256:sha256(d)}
      add(/f2 buf:d) #seq2={type:fs op:add file:/f2 link:1
        csum_sha256:sha256(d)}
      add(/f3 buf:d) #seq3={type:fs op:add file:/f3 link:1
        csum_sha256:sha256(d)}`);
    t('mod_same_def', `s..#seq buf(d:d) s..fs #seq0={}
      add(/f buf:d) #seq1={type:fs op:add file:/f content:1 f2:d}
      mod(/f buf:d) #seq2={type:fs op:mod file:/f link:1}`);
    t('mod_same_sha256', `s..#seq buf(d:d) s..fs(csum_sha256) #seq0={}
      add(/f buf:d) #seq1={type:fs op:add file:/f content:1 f2:d
        csum_sha256:sha256(d)}
      mod(/f buf:d) #seq2={type:fs op:mod file:/f link:1
        csum_sha256:sha256(d)}`);
    t('mod_same_existing_same', `s..#seq buf(d:d) buf(d2:d2) s..fs #seq0={}
      add(/f buf:d) #seq1={type:fs op:add file:/f content:1 f2:d}
      add(/f2 buf:d2) #seq2={type:fs op:add file:/f2 content:1 f2:d2}
      mod(/f buf:d2) #seq3={type:fs op:mod file:/f content:1 f2:d2}`);
    t('mod_same_existing_sha256', `s..#seq buf(d:d) buf(d2:d2)
      s..fs(csum_sha256) #seq0={}
      add(/f buf:d) #seq1={type:fs op:add file:/f content:1
        f2:d csum_sha256:sha256(d)}
      add(/f2 buf:d2) #seq2={type:fs op:add file:/f2 content:1 f2:d2
        csum_sha256:sha256(d2)}
      mod(/f buf:d2) #seq3={type:fs op:mod file:/f link:2
        csum_sha256:sha256(d2)}`);
    [d1, d2, d3] = [d+'x1', d+'x2', d+'x3'];
    t('mod_diff', `s..#seq
      buf(d1:${d1}) buf(d2:${d2}) buf(d3:${d3}) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={type:fs op:add file:/f1 content:1 f2:d1}
      mod(/f1 buf:d2) #seq2={type:fs op:mod file:/f1 link:1 diff:1
        f2:diff(d1 d2)}
      mod(/f1 buf:d3) #seq3={type:fs op:mod file:/f1 link:2 diff:1
        f2:diff(d2 d3)}`);
    [d1, d2] = [d+'1', d+'2'];
    t('mod_nodiff', `s..#seq buf(d1:${d1}) buf(d2:${d2}) s..fs #seq0={}
      add(/f1 buf:d1) #seq1={type:fs op:add file:/f1 content:1 f2:d1}
      mod(/f1 buf:d2) #seq2={type:fs op:mod file:/f1 content:1 f2:d2}`);
    t('mod_empty', `s..#seq buf(d:d) s..fs #seq0={}
      add(/f) #seq1={type:fs op:add file:/f}
      mod(/f buf:d) #seq2={type:fs op:mod file:/f content:1 f2:d}`);
    t('mod_to_empty', `s..#seq buf(d:d) s..fs #seq0={}
      add(/f buf:d) #seq1={type:fs op:add file:/f content:1 f2:d}
      mod(/f) #seq2={type:fs op:mod file:/f}`);
    t('rm_same', `s..#(seq fs) buf(d:1) buf(d2:2)
      s..fs          #(seq0={})
      add(/)         #(seq1={type:fs op:add dir:/} fs=/)
      add(/f buf:d)  #(seq2={type:fs op:add file:/f content:1 f2:d} fs=/f)
      mod(/f buf:d2)  #seq3={type:fs op:mod file:/f content:1 f2:d2}
      rm(/f)         #(seq4={type:fs op:rm file:/f} fs=!/f)
      add(/f buf:d)  #(seq5={type:fs op:add file:/f content:1 f2:d} fs=/f)`);
     t('rm_sha256', `s..#(seq fs) buf(d:1) buf(d2:2)
      s..fs(csum_sha256) #(seq0={})
      add(/)           #(seq1={type:fs op:add dir:/} fs=/)
      add(/f buf:d)    #(seq2={type:fs op:add file:/f content:1 f2:d
                       csum_sha256:sha256(d)} fs=/f)
      mod(/f buf:d2)   #seq3={type:fs op:mod file:/f content:1 f2:d2
                       csum_sha256:sha256(d2)}
      rm(/f)           #(seq4={type:fs op:rm file:/f} fs=!/f)
      add(/f buf:d)    #(seq5={type:fs op:add file:/f link:2
                       csum_sha256:sha256(d)} fs=/f)`);
    [d1, d2] = [d+'x1', d+'x2'];
    t('rm_add_diff', `s..#(seq fs) buf(d1:${d1}) buf(d2:${d2})
      s..fs          #(seq0={})
      add(/)         #(seq1={type:fs op:add dir:/} fs=/)
      add(/f buf:d1)  #(seq2={type:fs op:add file:/f content:1 f2:d1} fs=/f)
      rm(/f)         #(seq3={type:fs op:rm file:/f} fs=!/f)
      add(/f buf:d2)  #(seq4={type:fs op:add file:/f content:1 f2:d2} fs=/f)`);
    t('rm_multi', `s..#(seq fs) buf(d1:1) buf(d2:2)
      s..fs             #(seq0={})
      add(/)            #(seq1={type:fs op:add dir:/} fs=/)
      add(/d/)          #(seq2={type:fs op:add dir:/d/} fs=/d/)
      add(/d/f1 buf:d1) #(seq3={type:fs op:add file:/d/f1 content:1 f2:d1}
                        fs=/d/f1)
      add(/d/f2 buf:d2) #(seq4={type:fs op:add file:/d/f2 content:1 f2:d2}
                        fs=/d/f2)
      rm(/d/)           #(seq5={type:fs op:rm file:/d/f2}
                        seq6={type:fs op:rm file:/d/f1}
                        seq7={type:fs op:rm dir:/d/}
                        fs=[!/d/ !/d/f1 !/d/f2])`);
  });
  describe('branch', ()=>{
    let d1, d2, d3, d4, d5, d6, d = 'x'.repeat(68);
    t('file_add', `s..#(seq fs) buf(d1:1) buf(d2:2) buf(d3:3)
      buf(d4:4) buf(d5:5) buf(d6:6) buf(d7:7) s..fs #seq0={}
      add(/)          #(seq1={type:fs op:add dir:/} fs=/)
      add(/f1 buf:d1) #(seq2={type:fs op:add file:/f1 content:1 f2:d1} fs=/f1)
      add(/f2 branch:b buf:d2)
        #(seq3={bseq:2-1.0 branch:b type:fs op:add file:/f2 content:1 f2:d2}
        fs_b=[/ /f1 /f2])
      add(/f3 buf:d3) #(seq4={bseq:2-1.1 type:fs op:add file:/f3 content:1
        f2:d3} fs_b=/f3)
      add(/f4 buf:d4) #(seq5={bseq:2-1.2 type:fs op:add file:/f4 content:1
        f2:d4} fs_b=/f4)
      add(/f5 main buf:d5) #(seq6={bseq:3 type:fs op:add file:/f5 content:1
        f2:d5} fs=/f5)
      add(/f6 buf:d6) #(seq7={bseq:4 type:fs op:add file:/f6 content:1 f2:d6}
        fs=/f6)
      add(/f7 branch:b buf:d7)
        #(seq8={bseq:2-1.3 type:fs op:add file:/f7 content:1 f2:d7} fs_b=/f7)
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
      add(/f buf:d1) #seq1={type:fs op:add file:/f content:1 f2:d1}
      mod(/f branch:b buf:d2)
        #seq2={bseq:1-1.0 branch:b type:fs op:mod file:/f content:1 f2:d2}
      mod(/f buf:d3) #seq3={bseq:1-1.1 type:fs op:mod file:/f content:1 f2:d3}
      mod(/f buf:d4) #seq4={bseq:1-1.2 type:fs op:mod file:/f content:1 f2:d4}
      mod(/f main buf:d5) #seq5={bseq:2 type:fs op:mod file:/f content:1 f2:d5}
      mod(/f buf:d6) #seq6={bseq:3 type:fs op:mod file:/f content:1 f2:d6}
      mod(/f branch:b buf:d7)
        #seq7={bseq:1-1.3 type:fs op:mod file:/f content:1 f2:d7}
      ##file(/f)=d6 ##file(/f branch:b)=d7`);
    [d1, d2, d3, d4, d5, d6] = [d+'x1', d+'x2', d+'x3', d+'x4', d+'x5',
      d+'x6'];
    t('file_mod_diff', `s..#seq s..fs #seq0={} buf(d1:${d1})
      buf(d2:${d2}) buf(d3:${d3}) buf(d4:${d4}) buf(d5:${d5})
      buf(d6:${d6})
      add(/f buf:d1) #seq1={type:fs op:add file:/f content:1 f2:d1}
      mod(/f branch:b buf:d2)
        #seq2={bseq:1-1.0 branch:b type:fs op:mod file:/f link:1 diff:1
        f2:diff(d1 d2)}
      mod(/f buf:d3)
        #seq3={bseq:1-1.1 type:fs op:mod file:/f link:2 diff:1 f2:diff(d2 d3)}
      mod(/f main buf:d4)
        #seq4={bseq:2 type:fs op:mod file:/f link:1 diff:1 f2:diff(d1 d4)}
      mod(/f buf:d5) #seq5={bseq:3 type:fs op:mod file:/f link:4 diff:1
        f2:diff(d4 d5)}
      mod(/f branch:b buf:d6)
        #seq6={bseq:1-1.2 type:fs op:mod file:/f link:3 diff:1 f2:diff(d3 d6)}
      ##file(/f)=d5 ##file(/f branch:b)=d6`);
    t('dir', `s..#seq s..fs #seq0={}
      add(/) #seq1={type:fs op:add dir:/}
      add(/d1/) #seq2={type:fs op:add dir:/d1/}
      add(/d2/ branch:b) #seq3={bseq:2-1.0 branch:b type:fs op:add dir:/d2/}
      add(/d3/) #seq4={bseq:2-1.1 type:fs op:add dir:/d3/}
      add(/d2/ main) #seq5={bseq:3 type:fs op:add dir:/d2/}
      add(/d3/ main) #seq6={bseq:4 type:fs op:add dir:/d3/}
      add(/d4/ branch:b) #seq7={bseq:2-1.2 type:fs op:add dir:/d4/}
    `);
    t('multi_branch', `s..#(seq fs) s..fs #seq0={}
      add(/) #(seq1={type:fs op:add dir:/} fs=/)
      add(/d1/) #(seq2={type:fs op:add dir:/d1/} fs=/d1/)
      add(/d1/dd1/ branch:b1)
        #(seq3={branch:b1 bseq:2-1.0 type:fs op:add dir:/d1/dd1/}
        fs_b1=[/ /d1/ /d1/dd1/])
      add(/d1/dd2/)
        #(seq4={bseq:2-1.1 type:fs op:add dir:/d1/dd2/} fs_b1=/d1/dd2/)
      add(/d1/dd3/)
        #(seq5={bseq:2-1.2 type:fs op:add dir:/d1/dd3/} fs_b1=/d1/dd3/)
      add(/d1/dd1/ddd1/ branch:b2 prev:4)
        #(seq6={branch:b2 bseq:2-1.1-1.0 type:fs op:add dir:/d1/dd1/ddd1/}
        fs_b2=[/ /d1/ /d1/dd1/ /d1/dd1/ddd1/ /d1/dd2/])
      add(/d2/ main) #(seq7={bseq:3 type:fs op:add dir:/d2/} fs=/d2/)
      add(/d2/ branch:b3 prev:2)
      #(seq8={bseq:2-2.0 branch:b3 type:fs op:add dir:/d2/}
        fs_b3=[/ /d1/ /d2/])`);
  });
  describe('conflict', ()=>{
    t('no_conflict_asc', `s..fs add(/) add(/d1/) add(/d1/dd1/) S..#(seq fs)
      fs(s..M0)     #seq0={}
      tput(0 1    ) #(seq1={type:fs op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={type:fs op:add dir:/d1/} fs=[/d1/])
      tput(0 1 2 3) #(seq3={type:fs op:add dir:/d1/dd1/} fs=[/d1/dd1/])`);
    t('no_conflict_dsc', `s..fs add(/) add(/d1/) add(/d1/dd1/) S..#(seq fs)
      fs(s..M0)     #seq0={}
      tput(0 1 2 3) #(seq1={} seq2={} seq3={type:fs op:add dir:/d1/dd1/} fs=[])
      tput(0 1 2  ) #(seq2={type:fs op:add dir:/d1/} fs=[])
      tput(0 1    ) #(seq1={type:fs op:add dir:/} fs=[/ /d1/ /d1/dd1/])`);
    t('no_conflict_mid', `s..fs add(/) add(/d1/) add(/d1/dd1/) S..#(seq fs)
      fs(s..M0)     #seq0={}
      tput(0 1 2 3) #(seq1={} seq2={} seq3={type:fs op:add dir:/d1/dd1/} fs=[])
      tput(0 1    ) #(seq1={type:fs op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={type:fs op:add dir:/d1/} fs=[/d1/ /d1/dd1/])`);
    t('conflict_no_branch', `buf(d1:1) buf(d2:2)
      s..fs add(/) add(/d1/) add(/d1/f1 buf:d1)
      s1..fs(s..M0) tput(0) tput(0 1) add(/D1/) add(/D1/f2 buf:d2) S..#(seq fs)
      fs(M0)        #seq0={}
      tput(0 1    ) #(seq1={type:fs op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={type:fs op:add dir:/d1/} fs=[/d1/])
      tput(0 1 2 3) #(seq3={type:fs op:add file:/d1/f1 content:1 f2:d1}
                    fs=[/d1/f1])
      tput(0 1 c  ) #(seq2c1={type:fs op:add dir:/D1/} seq3c1={} c1fs=[/ /D1/])
      tput(0 1 c d) #(seq3c1={type:fs op:add file:/D1/f2 content:1 f2:d2}
                      c1fs=[/D1/f2])
      ##file(/d1/f1)=d1 ##file(/d1/f2)=null ##file(/d1/f1 c:1)=null
      ##file(/D1/f2 c:1)=d2`);
    // XXX: test temporary conflict, conflict+branches and files
  });
  describe('db', function(){
    xtest.set_timeout(this, 5000);
    t('file_add', `s..#(seq fs) buf(d1:1) buf(d2:2) buf(d3:3)
      buf(d4:4) buf(d5:5) buf(d6:6) buf(d7:7) s..fs(db) #seq0={}
      add(/)          #(seq1={type:fs op:add dir:/} fs=/)
      add(/f1 buf:d1) #(seq2={type:fs op:add file:/f1 content:1 f2:d1} fs=/f1)
      add(/f2 branch:b buf:d2)
        #(seq3={bseq:2-1.0 branch:b type:fs op:add file:/f2 content:1 f2:d2}
        fs_b=[/ /f1 /f2])
      add(/f3 buf:d3) #(seq4={bseq:2-1.1 type:fs op:add file:/f3 content:1
        f2:d3} fs_b=/f3)
      add(/f4 buf:d4) #(seq5={bseq:2-1.2 type:fs op:add file:/f4 content:1
        f2:d4} fs_b=/f4)
      add(/f5 main buf:d5) #(seq6={bseq:3 type:fs op:add file:/f5 content:1
        f2:d5} fs=/f5)
      add(/f6 buf:d6) #(seq7={bseq:4 type:fs op:add file:/f6 content:1 f2:d6}
        fs=/f6)
      add(/f7 branch:b buf:d7)
        #(seq8={bseq:2-1.3 type:fs op:add file:/f7 content:1 f2:d7} fs_b=/f7)
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
      add(/) #(seq1={type:fs op:add dir:/} fs=/)
      add(/d1/) #(seq2={type:fs op:add dir:/d1/} fs=/d1/)
      add(/d1/dd1/ branch:b1)
        #(seq3={branch:b1 bseq:2-1.0 type:fs op:add dir:/d1/dd1/}
        fs_b1=[/ /d1/ /d1/dd1/])
      add(/d1/dd2/)
        #(seq4={bseq:2-1.1 type:fs op:add dir:/d1/dd2/} fs_b1=/d1/dd2/)
      add(/d1/dd3/)
        #(seq5={bseq:2-1.2 type:fs op:add dir:/d1/dd3/} fs_b1=/d1/dd3/)
      add(/d1/dd1/ddd1/ branch:b2 prev:4)
        #(seq6={branch:b2 bseq:2-1.1-1.0 type:fs op:add dir:/d1/dd1/ddd1/}
        fs_b2=[/ /d1/ /d1/dd1/ /d1/dd1/ddd1/ /d1/dd2/])
      add(/d2/ main) #(seq7={bseq:3 type:fs op:add dir:/d2/} fs=/d2/)
      add(/d2/ branch:b3 prev:2)
      #(seq8={bseq:2-2.0 branch:b3 type:fs op:add dir:/d2/}
        fs_b3=[/ /d1/ /d2/])`);
    t('conflict_no_branch', `buf(d1:1) buf(d2:2)
      s..fs(db) add(/) add(/d1/) add(/d1/f1 buf:d1)
      s1..fs(s..M0) tput(0) tput(0 1) add(/D1/) add(/D1/f2 buf:d2) S..#(seq fs)
      fs(M0)        #seq0={}
      tput(0 1    ) #(seq1={type:fs op:add dir:/} fs=[/])
      tput(0 1 2  ) #(seq2={type:fs op:add dir:/d1/} fs=[/d1/])
      tput(0 1 2 3) #(seq3={type:fs op:add file:/d1/f1 content:1 f2:d1}
                    fs=[/d1/f1])
      tput(0 1 c  ) #(seq2c1={type:fs op:add dir:/D1/} seq3c1={} c1fs=[/ /D1/])
      tput(0 1 c d) #(seq3c1={type:fs op:add file:/D1/f2 content:1 f2:d2}
                      c1fs=[/D1/f2])
      ##file(/d1/f1)=d1 ##file(/d1/f2)=null ##file(/d1/f1 c:1)=null
      ##file(/D1/f2 c:1)=d2`);
  });
});

describe('git', function(){
  xtest.set_timeout(this, 10000);
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
  });
  describe('sync', ()=>{
    let _t_common = `$$mf(mode:100644) $$m0(mode:0) $$md(mode:040000)
      buf(d1:1) $$bm(branch:master)
      $$d1(d00491fd7e5bb6fa28c517a0bb32b8b506539d4d)
      $$R(/tmp/__lif_test/git_test/repo)
      $$R2(/tmp/__lif_test/git_test/sync)
      $$add_f1(fs_write($R/f1 d1) git_add(f1) git_commit(oid1 c_f1))
      $$add_f2(fs_write($R/f2 d1) git_add(f2) git_commit(oid2 c_f2))
      $$add_f3(fs_write($R/f3 d1) git_add(f3) git_commit(oid3 c_f3))
      $$add_f4(fs_write($R/f4 d1) git_add(f4) git_commit(oid4 c_f4))
      $$add_f5(fs_write($R/f5 d1) git_add(f5) git_commit(oid5 c_f5))
      $$add_f6(fs_write($R/f6 d1) git_add(f6) git_commit(oid6 c_f6))
      $$add_d1(fs_mkdir($R/d1) fs_write($R/d1/f d1) git_add($R/d1/f)
        git_commit(od1 c_d1))
      git_init($R)
      $$sync_err() $$flip() $$sync_head(master) $$sync_seal(false)
      $$sync(fs_cp($R/.git $R2) sync(seal:$sync_seal head:$sync_head
        $flip err($sync_err) gitdir($R2)))
      $$t(##seq$1={bseq:$2 type:$4 op:$5 $7... git:{oid:$3 $6}})
      $$tb(##seq$1={bseq:$2 type:$4
        op:$5 branch($rm_parentesis($6)) $9... git:{oid:$3 branch:$7 $8}})`;
    let t_common = `${_t_common} s..git(src:git_test head:master)`;
    const t = (name, test)=>it(name, ()=>test_run(test));
    t('sync_empty', `${t_common} $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !))
      ##seq3={}`);
    t('commit_empty', `${t_common} $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !))
      git_commit(oid1 c_f1) $sync $_(
      (3  ! !     fs       add $m0 dir:/)
      (4  ! $oid1 commit   add !   group:1 desc:c_f1))
      git_commit(oid2 c_f2) $sync $_(
      (5  ! $oid2 commit add !   desc:c_f2))
      ##seq6={} verify_git`);
    t('commit_file', `${t_common} $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !))
      $add_f1 $sync $_(
      (3  ! !     fs       add $m0 dir:/)
      (4  ! $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1 commit   add !   group:2 desc:c_f1))
      $add_f2 $sync $_(
      (6  ! $d1   fs       add $mf file:/f2 link:4)
      (7  ! $oid2 commit   add !   group:1 desc:c_f2))
      ##seq8={}
      ##git_sha_file(/f1 seq:4)=$d1
      ##git_sha_file(/f2 seq:6)=$d1
      ##git_sha_dir(/ seq:6)=cdfbe84a9047568f4312fc01c4beddc712e0256e
      verify_git`);
    t('dir', `${t_common} $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !))
      $add_d1 $sync $_(
      (3  ! !     fs       add $m0 dir:/)
      (4  ! !     fs       add $md dir:/d1/)
      (5  ! $d1   fs       add $mf file:/d1/f content:1 f2:d1)
      (6  ! $od1  commit   add !   group:3 desc:c_d1))
      ##seq7={}
    `);
    t('one_branch_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add !   branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   group:1 desc:c_f3))
      ##seq11={} verify_git`);
    t('one_branch_full', `${t_common} $add_f1 git_br_new(b1) $add_f2
      git_br(master) $add_f3 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1)
      (6  !     $d1   fs       add $mf file:/f3 link:4)
      (7  !     $oid3 commit   add !   group:1 desc:c_f3)
      (8  5-1.0 $oid1 git_br   add !   branch:b1)
      (9  5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (10 5-1.2 $oid2 commit   add !   group:1 desc:c_f2))
      ##seq11={} verify_git`);
    t('one_branch_del_branch_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm       !)
      (2  !     !     git_head add $bm       !)
      (3  !     !     fs       add $m0       dir:/)
      (4  !     $d1   fs       add $mf       file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !         group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add !         branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add $mf       file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !         group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add $mf       file:/f3 link:4)
      (10 7     $oid3 commit   add !         group:1 desc:c_f3))
      git_br_del(b1) $sync $_(
      (11 5-1.3 !     git_br   rm  branch:b1 !))
      ##seq12={} verify_git`);
    t('one_branch_del_branch_full', `${t_common} $add_f1 git_br_new(b1)
      $add_f2 git_br(master) $add_f3 git_br_del(b1) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1)
      (6  !     $d1   fs       add $mf file:/f3 link:4)
      (7  !     $oid3 commit   add !   group:1 desc:c_f3))
      ##seq8={} verify_git`);
    t('one_branch_rename_branch_inc', `${t_common}
      $add_f1 $sync $tb $$(
      (1  !     !     git_br   add !   !  $bm !)
      (2  !     !     git_head add !   !  $bm !)
      (3  !     !     fs       add !   !  $m0 dir:/)
      (4  !     $d1   fs       add !   !  $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   !  !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add b1  !  !   !))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add !   !  $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   !  !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add !   !  $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   !  !   group:1 desc:c_f3))
      git_br_rename(b1 b2) $sync $_(
      (11 5-1.3 !     git_br   rm  !   b1 !   !)
      (12 5-1.4 $oid2 git_br   add !   b2 !   !))
      ##seq13={} verify_git`);
    t('one_branch_rename_branch_full', `${t_common} $add_f1 git_br_new(b1)
      $add_f2 git_br(master) $add_f3 git_br_rename(b1 b2) $sync $tb $$(
      (1  !     !     git_br   add !  !  $bm !)
      (2  !     !     git_head add !  !  $bm !)
      (3  !     !     fs       add !  !  $m0 dir:/)
      (4  !     $d1   fs       add !  !  $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !  !  !   group:2 desc:c_f1)
      (6  !     $d1   fs       add !  !  $mf file:/f3 link:4)
      (7  !     $oid3 commit   add !  !  !   group:1 desc:c_f3)
      (8  5-1.0 $oid1 git_br   add b2 !  !   branch:b2)
      (9  5-1.1 $d1   fs       add !  !  $mf file:/f2 link:4)
      (10 5-1.2 $oid2 commit   add !  !  !   group:1 desc:c_f2))
      ##seq11={} verify_git`);
    t('one_branch_rename_same_inc', `${t_common}
      $add_f1 $sync $tb $$(
      (1  !     !     git_br   add !      !  $bm !)
      (2  !     !     git_head add !      !  $bm !)
      (3  !     !     fs       add !      !  $m0 dir:/)
      (4  !     $d1   fs       add !      !  $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !      !  !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add b1     !  !   !))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add !      !  $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !      !  !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add !      !  $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !      !  !   group:1 desc:c_f3))
      git_br_del(b1) $sync $_(
      (11 5-1.3 !     git_br   rm  !      b1 !   !))
      git_br(master) git_br_new(b1) $sync $_(
      (12 7-1.0 $oid3 git_br   add (b1 2) b1 !   !))
      ##seq13={} verify_git`);
    t('two_branch_rename_new_branch_no_commit_inc', `${t_common}
      $add_f1 $sync $tb $$(
      (1  !     !     git_br   add !   !   $bm !)
      (2  !     !     git_head add !   !   $bm !)
      (3  !     !     fs       add !   !   $m0 dir:/)
      (4  !     $d1   fs       add !   !   $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   !   !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add b1  !   !   !))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add !   !   $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   !   !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add !   !   $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   !   !   group:1 desc:c_f3))
      git_br_new(b2) $sync $_(
      (11 7-1.0 $oid3 git_br   add b2  !   !   !))
      $add_f4 $sync $_(
      (12 7-1.1 $d1   fs       add !   !   $mf file:/f4 link:4)
      (13 7-1.2 $oid4 commit   add !   !   !   group:1 desc:c_f4))
      git_br_rename(b1 bb1) git_br_rename(b2 bb2)
      $sync $_(
      (14 7-1.3 !     git_br   rm  !   b2  !   !)
      (15 5-1.3 !     git_br   rm  !   b1  !   !)
      (16 5-1.4 $oid2 git_br   add !   bb1 !   !)
      (17 7-1.4 $oid4 git_br   add !   bb2 !   !))
      ##seq18={} verify_git`);
    t('two_branch_rename_new_branch_commit_after_inc', `${t_common}
      $add_f1 $sync $tb $$(
      (1  !     !     git_br   add !   !   $bm !)
      (2  !     !     git_head add !   !   $bm !)
      (3  !     !     fs       add !   !   $m0 dir:/)
      (4  !     $d1   fs       add !   !   $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   !   !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add b1  !   !   !))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add !   !   $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   !   !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add !   !   $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   !   !   group:1 desc:c_f3))
      git_br_new(b2) $sync $_(
      (11 7-1.0 $oid3 git_br   add b2  !   !   !))
      $add_f4 $sync $_(
      (12 7-1.1 $d1   fs       add !   !   $mf file:/f4 link:4)
      (13 7-1.2 $oid4 commit   add !   !   !   group:1 desc:c_f4))
      git_br_rename(b1 bb1) git_br_rename(b2 bb2)
      git_br(bb1) $add_f5 git_br(bb2) $add_f6 $sync $_(
      (14 7-1.3 !     git_br   rm  !   b2  !   !)
      (15 5-1.3 !     git_br   rm  !   b1  !   !)
      (16 5-1.4 $oid2 git_br   add !   bb1 !   !)
      (17 5-1.5 $d1   fs       add !   !   $mf file:/f5 link:4)
      (18 5-1.6 $oid5 commit   add !   !   !   group:1 desc:c_f5)
      (19 7-1.4 $oid4 git_br   add !   bb2 !   !)
      (20 7-1.5 $d1   fs       add !   !   $mf file:/f6 link:4)
      (21 7-1.6 $oid6 commit   add !   !   !   group:1 desc:c_f6))
      ##seq22={} verify_git`);
    t('two_branch_rename_flip_branch_no_commit_inc', `${t_common}
      $add_f1 $sync $tb $$(
      (1  !     !     git_br   add !   !   $bm !)
      (2  !     !     git_head add !   !   $bm !)
      (3  !     !     fs       add !   !   $m0 dir:/)
      (4  !     $d1   fs       add !   !   $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   !   !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add b1  !   !   !))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add !   !   $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   !   !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add !   !   $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   !   !   group:1 desc:c_f3))
      git_br_new(b2) $sync $_(
      (11 7-1.0 $oid3 git_br   add b2  !   !   !))
      $add_f4 $sync $_(
      (12 7-1.1 $d1   fs       add !   !   $mf file:/f4 link:4)
      (13 7-1.2 $oid4 commit   add !   !   !   group:1 desc:c_f4))
      // rename-flip b1<>b2
      git_br_rename(b1 tmp) git_br_rename(b2 b1) git_br_rename(tmp b2)
      $sync $_(
      (14 7-1.3 !     git_br   rm  !   b2  !   !)
      (15 5-1.3 !     git_br   rm  !   b1  !   !)
      (16 7-1.4 $oid4 git_br   add !   b1  !   !)
      (17 5-1.4 $oid2 git_br   add !   b2  !   !))
      ##seq18={} verify_git`);
    t('two_branch_rename_flip_branch_with_commit_inc', `${t_common}
      $add_f1 $sync $tb $$(
      (1  !     !     git_br   add !   !   $bm !)
      (2  !     !     git_head add !   !   $bm !)
      (3  !     !     fs       add !   !   $m0 dir:/)
      (4  !     $d1   fs       add !   !   $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   !   !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add b1  !   !   !))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add !   !   $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   !   !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add !   !   $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   !   !   group:1 desc:c_f3))
      git_br_new(b2) $sync $_(
      (11 7-1.0 $oid3 git_br   add b2  !   !   !))
      $add_f4 $sync $_(
      (12 7-1.1 $d1   fs       add !   !   $mf file:/f4 link:4)
      (13 7-1.2 $oid4 commit   add !   !   !   group:1 desc:c_f4))
      // rename-flip b1<>b2
      git_br_rename(b1 tmp) git_br_rename(b2 b1) git_br_rename(tmp b2)
      // commit new files on b1 & b2
      git_br(b1) $add_f5 git_br(b2) $add_f6
      $sync $_(
      (14 7-1.3 !     git_br   rm  !   b2  !   !)
      (15 5-1.3 !     git_br   rm  !   b1  !   !)
      (16 7-1.4 $oid4 git_br   add !   b1  !   !)
      (17 7-1.5 $d1   fs       add !   !   $mf file:/f5 link:4)
      (18 7-1.6 $oid5 commit   add !   !   !   group:1 desc:c_f5)
      (19 5-1.4 $oid2 git_br   add !   b2  !   !)
      (20 5-1.5 $d1   fs       add !   !   $mf file:/f6 link:4)
      (21 5-1.6 $oid6 commit   add !   !   !   group:1 desc:c_f6))
      ##seq22={} verify_git`);
    t('three_branch_inc', `${t_common}
      $add_f1 $sync $tb $$(
      (1  !         !     git_br   add !   !   $bm !)
      (2  !         !     git_head add !   !   $bm !)
      (3  !         !     fs       add !    ! $m0 dir:/)
      (4  !         $d1   fs       add !    ! $mf file:/f1 content:1 f2:d1)
      (5  !         $oid1 commit   add !    ! !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0     $oid1 git_br   add b1   ! !   !))
      git_br_new(b2) $sync $_(
      (7  5-2.0     $oid1 git_br   add b2   ! !   !))
      git_br(b1) $add_f2 $sync $_(
      (8  5-1.1     $d1   fs       add !    ! $mf file:/f2 link:4)
      (9  5-1.2     $oid2 commit   add !    ! !   group:1 desc:c_f2))
      git_br_new(b1_1) $add_f3 $sync $_(
      (10 5-1.2-1.0 $oid2 git_br   add b1_1 ! !   !)
      (11 5-1.2-1.1 $d1   fs       add !    ! $mf file:/f3 link:4)
      (12 5-1.2-1.2 $oid3 commit   add !    ! !   group:1 desc:c_f3))
      git_br(b2) $add_f4 $sync $_(
      (13 5-2.1     $d1   fs       add !    ! $mf file:/f4 link:4)
      (14 5-2.2     $oid4 commit   add !    ! !   group:1 desc:c_f4))
      git_br(master) $add_f5 $sync $_(
      (15 6         $d1   fs       add !    ! $mf file:/f5 link:4)
      (16 7         $oid5 commit   add !    ! !   group:1 desc:c_f5))
      ##seq17={} verify_git`);
    t('three_branch_full', `${t_common} $add_f1 git_br_new(b1) git_br_new(b2)
      git_br(b1) $add_f2 git_br_new(b1_1) $add_f3 git_br(b2) $add_f4
      git_br(master) $add_f5 $sync $tb $$(
      (1  !         !     git_br   add !    !   $bm !)
      (2  !         !     git_head add !    !   $bm !)
      (3  !         !     fs       add !    ! $m0 dir:/)
      (4  !         $d1   fs       add !    ! $mf file:/f1 content:1 f2:d1)
      (5  !         $oid1 commit   add !    ! !   group:2 desc:c_f1)
      (6  !         $d1   fs       add !    ! $mf file:/f5 link:4)
      (7  !         $oid5 commit   add !    ! !   group:1 desc:c_f5)
      (8  5-1.0     $oid1 git_br   add b1   ! !   !)
      (9  5-1.1     $d1   fs       add !    ! $mf file:/f2 link:4)
      (10 5-1.2     $oid2 commit   add !    ! !   group:1 desc:c_f2)
      (11 5-1.2-1.0 $oid2 git_br   add b1_1 ! !   !)
      (12 5-1.2-1.1 $d1   fs       add !    ! $mf file:/f3 link:4)
      (13 5-1.2-1.2 $oid3 commit   add !    ! !   group:1 desc:c_f3)
      (14 5-2.0     $oid1 git_br   add b2   ! !   !)
      (15 5-2.1     $d1   fs       add !    ! $mf file:/f4 link:4)
      (16 5-2.2     $oid4 commit   add !    ! !   group:1 desc:c_f4))
      ##seq17={} verify_git`);
    t('merge_two_parents_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add !   branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit add !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   group:1 desc:c_f3))
      git_merge(oid4 b1 c_merge) $$M(merge:$oid2) $sync $_(
      (11 8     $d1   fs       add $mf file:/f2 link:4)
      (12 9     $oid4 commit   add $M  group:1 desc:c_merge))
      ##seq13={} verify_git`);
    t('merge_two_parents_full', `${t_common} $add_f1 git_br_new(b1)
      $add_f2 git_br(master) $add_f3 git_merge(oid4 b1 c_merge)
      $$M(merge:$oid2) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs     add $m0 dir:/)
      (4  !     $d1   fs     add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit add !   group:2 desc:c_f1)
      (6  !     $d1   fs     add $mf file:/f3 link:4)
      (7  !     $oid3 commit add !   group:1 desc:c_f3)
      (8  !     $d1   fs     add $mf file:/f2 link:4)
      (9  !     $oid4 commit add $M   group:1 desc:c_merge)
      (10 5-1.0 $oid1 git_br add !   branch:b1)
      (11 5-1.1 $d1   fs     add $mf file:/f2 link:4)
      (12 5-1.2 $oid2 commit add !   group:1 desc:c_f2))
      ##seq13={} verify_git`);
    t('merge_two_parents_del_branch_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add !   branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add $mf file:/f3 link:4)
      (10 7     $oid3 commit   add !   group:1 desc:c_f3))
      git_merge(oid4 b1 c_merge) $$M(merge:$oid2) $sync $_(
      (11 8     $d1   fs       add $mf file:/f2 link:4)
      (12 9     $oid4 commit   add $M   group:1 desc:c_merge))
      git_br_del(b1) $$B(branch:b1) $sync $_(
      (13  5-1.3 !    git_br   rm  $B   !))
      ##seq14={} verify_git`);
    t('merge_two_parents_del_branch_full', `${t_common} $add_f1
      git_br_new(b1) $add_f2 git_br(master) $add_f3
      git_merge(oid4 b1 c_merge) git_br_del(b1) $$M(merge:$oid2) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1)
      (6  !     $d1   fs       add $mf file:/f3 link:4)
      (7  !     $oid3 commit   add !   group:1 desc:c_f3)
      (8  !     $d1   fs       add $mf file:/f2 link:4)
      (9  !     $oid4 commit   add $M  group:1 desc:c_merge)
      (10 5-1.0 $oid1 git_br   add !   branch:_null)
      (11 5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (12 5-1.2 $oid2 commit   add !   group:1 desc:c_f2))
      ##seq13={} verify_git`);
    t('merge_three_parents_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add !   branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   group:1 desc:c_f2))
      git_br(master) git_br_new(b2) $sync $_(
      (9  5-2.0 $oid1 git_br   add !   branch:b2))
      $add_f3 $sync $_(
      (10 5-2.1 $d1   fs       add $mf file:/f3 link:4)
      (11 5-2.2 $oid3 commit   add !   group:1 desc:c_f3))
      git_br(master) $add_f4 $sync $_(
      (12 6     $d1   fs       add $mf file:/f4 link:4)
      (13 7     $oid4 commit   add !   group:1 desc:c_f4))
      git_merge(oid5 b1 b2 c_merge) $$M(merge:[$oid2 $oid3]) $sync $_(
      (14 8     $d1   fs       add $mf file:/f2 link:4)
      (15 9     $d1   fs       add $mf file:/f3 link:4)
      (16 _10   $oid5 commit   add $M  group:2 desc:c_merge))
      ##seq17={} verify_git`);
    t('merge_three_parents_full', `${t_common} $add_f1 git_br_new(b1)
      $add_f2 git_br(master) git_br_new(b2) $add_f3 git_br(master) $add_f4
      git_merge(oid5 b1 b2 c_merge) $$M(merge:[$oid2 $oid3]) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1)
      (6  !     $d1   fs       add $mf file:/f4 link:4)
      (7  !     $oid4 commit   add !   group:1 desc:c_f4)
      (8  !     $d1   fs       add $mf file:/f2 link:4)
      (9  !     $d1   fs       add $mf file:/f3 link:4)
      (10 !     $oid5 commit   add $M  group:2 desc:c_merge)
      (11 5-1.0 $oid1 git_br   add !   branch:b1)
      (12 5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (13 5-1.2 $oid2 commit   add !   group:1 desc:c_f2)
      (14 5-2.0 $oid1 git_br   add !   branch:b2)
      (15 5-2.1 $d1   fs       add $mf file:/f3 link:4)
      (16 5-2.2 $oid3 commit   add !   group:1 desc:c_f3))
      ##seq17={} verify_git`);
    t('merge_three_parents_del_br_full', `${t_common} $add_f1 git_br_new(b1)
      $add_f2 git_br(master) git_br_new(b2) $add_f3 git_br(master) $add_f4
      git_merge(oid5 b1 b2 c_merge) $$M(merge:[$oid2 $oid3])
      git_br_del(b1) git_br_del(b2) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1)
      (6  !     $d1   fs       add $mf file:/f4 link:4)
      (7  !     $oid4 commit   add !   group:1 desc:c_f4)
      (8  !     $d1   fs       add $mf file:/f2 link:4)
      (9  !     $d1   fs       add $mf file:/f3 link:4)
      (10 !     $oid5 commit   add $M  group:2 desc:c_merge)
      (11 5-1.0 $oid1 git_br   add !   branch:_null)
      (12 5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (13 5-1.2 $oid2 commit   add !   group:1 desc:c_f2)
      (14 5-2.0 $oid1 git_br   add !   branch(_null 2))
      (15 5-2.1 $d1   fs       add $mf file:/f3 link:4)
      (16 5-2.2 $oid3 commit   add !   group:1 desc:c_f3))
      ##seq17={} verify_git`);
    t('merge_one_parent_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add !   branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !   group:1 desc:c_f2))
      git_br(master) git_merge(oid3 b1 c_merge) $sync $_(
      (9  6     $d1   fs       add $mf file:/f2 link:4)
      (10 7     $oid2 commit   add !   group:1 desc:c_f2))
      ##seq11={} verify_git`);
    t('merge_one_parent_full', `${t_common} $add_f1 git_br_new(b1)
      $add_f2 git_br(master) git_merge(oid3 b1 c_merge) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1)
      (6  !     $d1   fs       add $mf file:/f2 link:4)
      (7  !     $oid2 commit   add !   group:1 desc:c_f2)
      (8  7-1.0 $oid2 git_br   add !   branch:b1))
      ##seq9={} verify_git`);
    t('merge_one_parent_on_branch_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !         !     git_br   add $bm !)
      (2  !         !     git_head add $bm !)
      (3  !         !     fs       add $m0 dir:/)
      (4  !         $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !         $oid1 commit   add !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0     $oid1 git_br   add !   branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1     $d1   fs       add $mf file:/f2 link:4)
      (8  5-1.2     $oid2 commit   add !   group:1 desc:c_f2))
      git_br_new(b2) $sync $_(
      (9  5-1.2-1.0 $oid2 git_br   add !   branch:b2))
      $add_f3 $sync $_(
      (10 5-1.2-1.1 $d1   fs       add $mf file:/f3 link:4)
      (11 5-1.2-1.2 $oid3 commit   add !   group:1 desc:c_f3))
      git_br(b1) git_merge(oid4 b2 c_merge) $sync $_(
      (12 5-1.3   $d1     fs       add $mf file:/f3 link:4)
      (13 5-1.4   $oid3   commit   add !   group:1 desc:c_f3))
      ##seq14={} verify_git`);
    t('tag_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !)
      (3  ! !     fs       add $m0 dir:/)
      (4  ! $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1 commit   add !   group:2 desc:c_f1))
      $add_f2 $sync $_(
      (6  ! $d1   fs       add $mf file:/f2 link:4)
      (7  ! $oid2 commit   add !   group:1 desc:c_f2))
      $add_f3 $sync $_(
      (8  ! $d1   fs       add $mf file:/f3 link:4)
      (9  ! $oid3 commit   add !   group:1 desc:c_f3))
      git_tag(t1 $oid1) $sync $_(
      (10 ! $oid1 tag      add !   tag:t1 link:5))
      git_tag(t1 $oid2) $sync $_(
      (11 ! $oid2 tag      mod !   tag:t1 link:7))
      git_tag(t3 $oid3) $sync $_(
      (12 ! $oid3 tag      add !   tag:t3 link:9))
      git_tag_del(t1) $sync $_(
      (13 ! $oid2 tag      rm  !   tag:t1))
      ##seq14={} verify_git`);
    t('tag_full', `${t_common} $add_f1 $add_f2 $add_f3 git_tag(t1 $oid1)
      git_tag(t1 $oid2) git_tag(t3 $oid3) git_tag_del(t1) $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !)
      (3  ! !     fs       add $m0 dir:/)
      (4  ! $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1 commit   add !   group:2 desc:c_f1)
      (6  ! $d1   fs       add $mf file:/f2 link:4)
      (7  ! $oid2 commit   add !   group:1 desc:c_f2)
      (8  ! $d1   fs       add $mf file:/f3 link:4)
      (9  ! $oid3 commit   add !   group:1 desc:c_f3)
      (10 ! $oid3 tag      add !   tag:t3 link:9))
      ##seq11={} verify_git`);
    t('tag_annotate_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  ! !      git_br   add $bm !)
      (2  ! !      git_head add $bm !)
      (3  ! !      fs       add $m0 dir:/)
      (4  ! $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1  commit   add !   group:2 desc:c_f1))
      $add_f2 $sync $_(
      (6  ! $d1    fs       add $mf file:/f2 link:4)
      (7  ! $oid2  commit   add !   group:1 desc:c_f2))
      $add_f3 $sync $_(
      (8  ! $d1    fs       add $mf file:/f3 link:4)
      (9  ! $oid3  commit   add !   group:1 desc:c_f3))
      git_tag_annotate(toid1 t1 $oid1 c_tag1) $$C(commit_oid:$oid1) $sync $_(
      (10 ! $toid1 tag_o    add $C  tag:t1 link:5 desc:c_tag1)
      (11 ! $toid1 tag      add !   tag:t1 link:10))
      ##seq12={} verify_git`);
    t('tag_annotate_full', `${t_common} $add_f1 $add_f2 $add_f3
      git_tag_annotate(toid1 t1 $oid1 c_tag1) $$C(commit_oid:$oid1)
      $sync $t $$(
      (1  ! !      git_br   add $bm !)
      (2  ! !      git_head add $bm !)
      (3  ! !      fs       add $m0 dir:/)
      (4  ! $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1  commit   add !   group:2 desc:c_f1)
      (6  ! $d1    fs       add $mf file:/f2 link:4)
      (7  ! $oid2  commit   add !   group:1 desc:c_f2)
      (8  ! $d1    fs       add $mf file:/f3 link:4)
      (9  ! $oid3  commit   add !   group:1 desc:c_f3)
      (10 ! $toid1 tag_o    add $C  tag:t1 link:5 desc:c_tag1)
      (11 ! $toid1 tag      add !   tag:t1 link:10))
      ##seq12={} verify_git`);
    t('flip_protect_off_tag', `${t_common} $$flip(flip_protect:false)
      $add_f1 $add_f2 $add_f3 $sync $t $$(
      (1  ! !      git_br   add $bm !)
      (2  ! !      git_head add $bm !)
      (3  ! !      fs       add $m0 dir:/)
      (4  ! $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1  commit   add !   group:2 desc:c_f1)
      (6  ! $d1    fs       add $mf file:/f2 link:4)
      (7  ! $oid2  commit   add !   group:1 desc:c_f2)
      (8  ! $d1    fs       add $mf file:/f3 link:4)
      (9  ! $oid3  commit   add !   group:1 desc:c_f3))
      git_tag(t1 $oid1) $sync $_(
      (10 ! $oid1  tag      add !   tag:t1 link:5))
      git_tag(t1 $oid2) $sync $_(
      (11 ! $oid2  tag      mod !   tag:t1 link:7))
      git_tag(t1 $oid1) $sync $_(
      (12 ! $oid1  tag      mod !   tag:t1 link:5))
      ##seq13={} verify_git`);
    t('flip_protect_warn_tag', `${t_common} $add_f1 $add_f2 $add_f3
      $sync $t $$(
      (1  ! !      git_br   add $bm !)
      (2  ! !      git_head add $bm !)
      (3  ! !      fs       add $m0 dir:/)
      (4  ! $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1  commit   add !   group:2 desc:c_f1)
      (6  ! $d1    fs       add $mf file:/f2 link:4)
      (7  ! $oid2  commit   add !   group:1 desc:c_f2)
      (8  ! $d1    fs       add $mf file:/f3 link:4)
      (9  ! $oid3  commit   add !   group:1 desc:c_f3))
      git_tag(t1 $oid1) $sync $_(
      (10 ! $oid1  tag      add !   tag:t1 link:5))
      git_tag(t1 $oid2) $sync $_(
      (11 ! $oid2  tag      mod !   tag:t1 link:7))
      xerr(git: adding tag t1 with a previous oid $oid1)
      git_tag(t1 $oid1)
      $sync xerr $_(
      (12 ! $oid1  tag      mod !   tag:t1 link:5))
      ##seq13={} verify_git`);
    t('flip_protect_true_tag', `${t_common} $$flip(flip_protect)
      $add_f1 $add_f2 $add_f3 $sync $t $$(
      (1  ! !      git_br   add $bm !)
      (2  ! !      git_head add $bm !)
      (3  ! !      fs       add $m0 dir:/)
      (4  ! $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1  commit   add !   group:2 desc:c_f1)
      (6  ! $d1    fs       add $mf file:/f2 link:4)
      (7  ! $oid2  commit   add !   group:1 desc:c_f2)
      (8  ! $d1    fs       add $mf file:/f3 link:4)
      (9  ! $oid3  commit   add !   group:1 desc:c_f3))
      git_tag(t1 $oid1) $sync $_(
      (10 ! $oid1  tag      add !   tag:t1 link:5))
      git_tag(t1 $oid2) $sync $_(
      (11 ! $oid2  tag      mod !   tag:t1 link:7))
      git_tag(t1 $oid1) $sync $_() ##seq12={}
      git_tag(t2 $oid2) $sync $_(
      (12 ! $oid2  tag      add !   tag:t2 link:7))
      git_tag_del(t1) $sync $_(
      (13 ! $oid2  tag      rm  !   tag:t1))
      git_tag(t1 $oid1) $sync $_() ##seq14={}
      git_tag(t1 $oid2) $sync $_() ##seq14={}
      git_tag(t1 $oid3) $sync $_(
      (14 ! $oid3  tag      add !   tag:t1 link:9))
      git_tag(t1 $oid2) $sync $_() ##seq15={} verify_git`);
    t('flip_protect_off_branch', `${t_common} $$flip(flip_protect:false)
      $add_f1 $add_f2 $add_f3 $sync $t $$(
      (1  !     !      git_br   add $bm !)
      (2  !     !      git_head add $bm !)
      (3  !     !      fs       add $m0 dir:/)
      (4  !     $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1  commit   add !   group:2 desc:c_f1)
      (6  !     $d1    fs       add $mf file:/f2 link:4)
      (7  !     $oid2  commit   add !   group:1 desc:c_f2)
      (8  !     $d1    fs       add $mf file:/f3 link:4)
      (9  !     $oid3  commit   add !   group:1 desc:c_f3))
      git_br_new(b1 $oid1) $sync $_(
      (10 5-1.0 $oid1  git_br   add !   branch:b1))
      git_br(master) git_br_del(b1) git_br_new(b1 $oid2) $sync $_(
      (11 5-1.1 $d1    fs       add $mf file:/f2 link:4)
      (12 5-1.2 $oid2  commit   add !  group:1 desc:c_f2))
      git_br(master) git_br_del(b1) git_br_new(b1 $oid1) $$B(branch:b1)
      $sync $_(
      (13  5-1.3 !     git_br   rm  $B  !)
      (14  5-2.0 $oid1 git_br   add $B  branch(b1 2)))
      git_br(master) git_br_del(b1) $sync $_(
      (15  5-2.1 !     git_br   rm  $B  !))
      git_br_new(b1 $oid2) $sync $_(
      (16  7-1.0 $oid2 git_br   add $B  branch(b1 3)))
      ##seq17={}
      git_br(master) git_br_del(b1) $sync $_(
      (17  7-1.1 !     git_br   rm  $B  !))
      git_br_new(b1 $oid2) $sync $_(
      (18  7-2.0 $oid2 git_br   add $B  branch(b1 4)))
      ##seq19={} verify_git`);
    t('flip_protect_warn_branch', `${t_common} $add_f1 $add_f2 $add_f3
      $sync $t $$(
      (1  !     !      git_br   add $bm !)
      (2  !     !      git_head add $bm !)
      (3  !     !      fs       add $m0 dir:/)
      (4  !     $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1  commit   add !   group:2 desc:c_f1)
      (6  !     $d1    fs       add $mf file:/f2 link:4)
      (7  !     $oid2  commit   add !   group:1 desc:c_f2)
      (8  !     $d1    fs       add $mf file:/f3 link:4)
      (9  !     $oid3  commit   add !   group:1 desc:c_f3))
      git_br_new(b1 $oid1) $sync $_(
      (10 5-1.0 $oid1  git_br   add !   branch:b1))
      git_br(master) git_br_del(b1) git_br_new(b1 $oid2) $sync $_(
      (11 5-1.1 $d1    fs       add $mf file:/f2 link:4)
      (12 5-1.2 $oid2  commit   add !  group:1 desc:c_f2))
      git_br(master) git_br_del(b1) git_br_new(b1 $oid1) $$B(branch:b1)
      xerr(git: adding branch b1 with a previous oid $oid1) $sync $_(
      (13  5-1.3 !     git_br   rm  $B  !)
      (14  5-2.0 $oid1 git_br   add $B  branch(b1 2)))
      xerr ##seq15={}
      git_br(master) git_br_del(b1) $sync $_(
      (15  5-2.1 !     git_br   rm  $B  !))
      git_br_new(b1 $oid2) $sync $_(
      (16  7-1.0 $oid2 git_br   add $B  branch(b1 3)))
      ##seq17={}
      git_br(master) git_br_del(b1) $sync $_(
      (17  7-1.1 !     git_br   rm  $B  !))
      git_br_new(b1 $oid2)
      xerr(git: adding branch b1 with a previous oid $oid2) $sync $_(
      (18  7-2.0 $oid2 git_br   add $B  branch(b1 4)))
      xerr ##seq19={} verify_git`);
    t('flip_protect_on_branch', `${t_common} $$flip(flip_protect)
      $add_f1 $add_f2 $add_f3 $sync $t $$(
      (1  !     !      git_br   add $bm !)
      (2  !     !      git_head add $bm !)
      (3  !     !      fs       add $m0 dir:/)
      (4  !     $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1  commit   add !   group:2 desc:c_f1)
      (6  !     $d1    fs       add $mf file:/f2 link:4)
      (7  !     $oid2  commit   add !   group:1 desc:c_f2)
      (8  !     $d1    fs       add $mf file:/f3 link:4)
      (9  !     $oid3  commit   add !   group:1 desc:c_f3))
      git_br_new(b1 $oid1) $sync $_(
      (10 5-1.0 $oid1  git_br   add !   branch:b1))
      git_br(master) git_br_del(b1) git_br_new(b1 $oid2) $sync $_(
      (11 5-1.1 $d1    fs       add $mf file:/f2 link:4)
      (12 5-1.2 $oid2  commit   add !  group:1 desc:c_f2))
      git_br(master) git_br_del(b1) git_br_new(b1 $oid1) $$B(branch:b1)
      ##seq13={}
      git_br(master) git_br_del(b1) $sync $_(
      (13  5-1.3 !     git_br   rm  $B  !))
      git_br_new(b1 $oid2) $sync $_(
      (14  7-1.0 $oid2 git_br   add $B  branch(b1 2)))
      ##seq15={}
      git_br(master) git_br_del(b1) $sync $_(
      (15  7-1.1 !     git_br   rm  $B  !))
      git_br_new(b1 $oid2) $sync $_()
      ##seq16={} verify_git`);
    t('no_head_inc', `${_t_common} s..git(src:git_test head:no_head)
      $$sync_head(no_head)
      $$bn(branch:no_head) $sync $t $$(
      (1  !     !        git_br   add $bn !)
      (2  !     !        git_head add $bn !))
      $add_f1 xerr(cannot find head no_head) $sync $_(
      (3  !       !      git_head rm  $bn !)
      (4  !       !      git_br   rm  $bn !)
      (5  !       !      git_br   add $bm !)
      (6  !       !      fs       add $m0 dir:/)
      (7  !       $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (8  !       $oid1  commit   add !   group:2 desc:c_f1))
      xerr
      $add_f2 xerr(cannot find head no_head) $sync $_(
      (9  !       $d1    fs       add $mf file:/f2 link:7)
      (10 !       $oid2  commit   add !   group:1 desc:c_f2))
      xerr
      git_br_new(no_head) $sync $_(
      (11 _10-1.0 $oid2  git_br add !   branch:no_head))
      $add_f3 $sync $_(
      (12 _10-1.1 !      git_head add $bn !)
      (13 _10-1.2 $d1    fs       add $mf file:/f3 link:7)
      (14 _10-1.3 $oid3  commit   add !   group:1 desc:c_f3))
      git_br(master) $add_f4 $sync $_(
      (15 _11     $d1   fs        add $mf file:/f4 link:7)
      (16 _12     $oid4  commit   add !   group:1 desc:c_f4))
      ##seq17={} verify_git`);
    t('no_head_inc2', `${_t_common} s..git(src:git_test head:no_head)
      $$sync_head(no_head) $$bn(branch:no_head)
      $sync $t $$(
      (1  !       !     git_br   add $bn !)
      (2  !       !     git_head add $bn !))
      $add_f1 xerr(cannot find head no_head) $sync $_(
      (3  !       !     git_head rm  $bn !)
      (4  !       !     git_br   rm  $bn !)
      (5  !       !     git_br   add $bm !)
      (6  !       !     fs       add $m0 dir:/)
      (7  !       $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (8  !       $oid1 commit   add !   group:2 desc:c_f1))
      xerr
      $add_f2 xerr(cannot find head no_head) $sync $_(
      (9  !       $d1   fs       add $mf file:/f2 link:7)
      (10 !       $oid2 commit   add !   group:1 desc:c_f2))
      dbg
      git_br_new(no_head) $add_f3 $sync $_(
      (11 _10-1.0 $oid2 git_br    add  !   branch:no_head)
      (12 _10-1.1 $d1   fs       add $mf file:/f3 link:7)
      (13 _10-1.2 $oid3 commit   add !   group:1 desc:c_f3)
      (14 _10-1.3 !     git_head add $bn !))
      git_br(master) $add_f4 $sync $_(
      (15 _11     $d1   fs        add $mf file:/f4 link:7)
      (16 _12     $oid4 commit   add !   group:1 desc:c_f4))
      ##seq17={} verify_git`);
    t('no_head_full', `${_t_common} s..git(src:git_test head:no_head)
      $$bn(branch:no_head)
      $add_f1
      $add_f2
      git_br_new(no_head) $add_f3
      git_br(master) $add_f4 $$sync_head(no_head) $sync $t $$(
      (1  !     !      git_br   add $bn !)
      (2  !     !      git_head add $bn !)
      (3  !     !      fs       add $m0 dir:/)
      (4  !     $d1    fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1  commit   add !   group:2 desc:c_f1)
      (6  !     $d1    fs       add $mf file:/f2 link:4)
      (7  !     $oid2  commit   add !   group:1 desc:c_f2)
      (8  !     $d1    fs       add $mf file:/f3 link:4)
      (9  !     $oid3  commit   add !   group:1 desc:c_f3)
      (10 7-1.0 $oid2  git_br   add !   branch:master)
      (11 7-1.1 $d1    fs       add $mf file:/f4 link:4)
      (12 7-1.2 $oid4  commit   add !   group:1 desc:c_f4))
      ##seq13={} verify_git`);
    t('head_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1))
      $add_f2 $sync $_(
      (6  !     $d1   fs        add $mf file:/f2 link:4)
      (7  !     $oid2 commit    add !   group:1 desc:c_f2))
      git_br_new(b1) $sync $_(
      (8  7-1.0 $oid2 git_br    add !   branch:b1))
      $add_f3 $sync $_(
      (9  7-1.1 $d1   fs        add $mf file:/f3 link:4)
      (10 7-1.2 $oid3 commit    add !   group:1 desc:c_f3))
      $$sync_head(b1) $$b1(branch:b1) $sync $_(
      (11 8     !     git_head  rm  $bm !)
      (12 7-1.3 !     git_head  add $b1 !))
      ##seq13={}`);
    t('head_full', `${t_common}
      $add_f1
      $add_f2
      git_br_new(b1)
      $add_f3
      $$sync_head(b1) $$b1(branch:b1) $sync $t $$(
      (1  !         !     git_br   add $bm !)
      (2  !         !     git_head add $bm !)
      (3  2-1.0     !     git_br   add !   branch:b1)
      (4  2-1.1     !     fs       add $m0 dir:/)
      (5  2-1.2     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (6  2-1.3     $oid1 commit   add !   group:2 desc:c_f1)
      (7  2-1.4     $d1   fs       add $mf file:/f2 link:5)
      (8  2-1.5     $oid2 commit   add !   group:1 desc:c_f2)
      (9  2-1.6     $d1   fs       add $mf file:/f3 link:5)
      (10 2-1.7     $oid3 commit   add !   group:1 desc:c_f3)
      (11 3         !     git_head rm  $bm !)
      (12 4         !     git_br   rm  $bm !)
      (13 2-1.5-1.0 $oid2 git_br   add !   branch:master)
      (14 2-1.8     !     git_head add $b1 !))
      ##seq15={}`);
    t('commit_two_roots_inc', `${t_common}
      $add_f1 $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !)
      (3  ! !     fs       add $m0 dir:/)
      (4  ! $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1 commit   add !   group:2 desc:c_f1))
      $add_f2 $sync $_(
      (6  ! $d1   fs       add $mf file:/f2 link:4)
      (7  ! $oid2 commit   add !   group:1 desc:c_f2))
      git_br_orphan(b1) $sync $_()
      $add_f3 $$sync_err(Error: multiple root not supported $oid3) $sync $_()
      ##seq8={} verify_git`);
    t('commit_two_roots_full', `${t_common} $add_f1 $add_f2 git_br_orphan(b1)
      $add_f3 $$sync_err(Error: multiple root not supported $oid3) $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !))
      ##seq3={} verify_git`);
    t('seal', `${t_common} $$sync_seal(true)
      $$s(src:${encode_str('https://github.com/git_test')})
      $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !   group:2 desc:c_f1)
      (6  !     !     seal     !   $s  !))
      git_br_new(b1) $sync $_(
      (7  5-1.0 $oid1 git_br   add !   branch:b1)
      (8  7     !     seal     !   $s  !))
      $add_f2 $sync $_(
      (9  5-1.1 $d1   fs       add $mf file:/f2 link:4)
      (10 5-1.2 $oid2 commit   add !   group:1 desc:c_f2)
      (11 8     !     seal     !   $s  !))
      ##seq12={}
    `);
    let gpg5 = encode_str('-----BEGIN PGP SIGNATURE-----\n'+
      '\nwsBcBAABCAAQBQJkNm+YCRBK7hj4Ov3rIwAArvwIAKD/lrcoHllSLAf5FvCwoKd/'+
      '\ndI3AVOdMZ4vXFPb36V2eh3fF8GBOab463mWx4cnAV3Lr11VY8IT/f30mch7qgrRy'+
      '\nRvVdRtdighdgizoqUgjsZ3QHhWavHeluehQ/+AwSgau30L/9X3H9UeeRjbes1gRr'+
      '\nyhrQ5cIV9mn3mUTB82AfhA23akZ21hEWmMbN3mivByZ7MNnv4D0ZMaedia3JmARn'+
      '\nV7ssY94HmzeAYsiqcBiQ4j5Ec308yGW8oEWD/CzsjdNEW4OJaMUprRqoxKrSVVq3'+
      '\nus+YUfJrJr5GrdaqMKvfKKZVGfwEqyeoWh/kU9anD6eNPgCRudqHjLFSHqrgHJQ='+
      '\n=Zdym\n-----END PGP SIGNATURE-----\n');
    let gpg7 = encode_str('-----BEGIN PGP SIGNATURE-----\n'+
      '\nwsBcBAABCAAQBQJkNm+rCRBK7hj4Ov3rIwAAHIkIAF2TSXNjQFBsR1jLB1Hk9J8Z'+
      '\nHbK8/Skv0iwmkTwfKkA7R4pT13QgskoFMMT6i7xOyBRQc2LEZLaR5FKQQhtxfSvc'+
      '\nYTn+l3nLJdU5OCZjBon7yo/uM8eOzqw81LgVp+JbKaORfzAZno/pOfn3N47Czwoy'+
      '\nQrC3Wdfq0EkeiXeOpC/yB2lDcynziuRT7QJFpuJIP3kJ5Zh3f6U1IY5C/Uo1Drrw'+
      '\nq+5JMVJrdU3qLTK9/FIvoX6EYERB5QZeUmw3smX/5HzcdVsY5bjY+bIdgWO8mES/'+
      '\nKzoGMn5nr2tgBTwjbgIgcG2PJ0wnf6JICns4USp0oRAE6EYAeH4vj2oSjyXCV5U='+
      '\n=udUT\n-----END PGP SIGNATURE-----\n');
    let gpg9 = encode_str('-----BEGIN PGP SIGNATURE-----\n'+
      '\niQGzBAABCgAdFiEEndepdIBVI/JR3VFqk63BrWpcXVgFAmQ2ei0ACgkQk63BrWpc'+
      '\nXVhqdQv/WdVqKEYqPV3iJukwR9qEWhZLo0Xl9WatvVynHKwV/mn0MWtUHV/KgvDu'+
      '\nL+rfWpMauoIx5v2labUg13+FAZ67FDvh8oDTVGXjwMiwtmPod3MIQTU+B5/zE99r'+
      '\nJWqpOsNtFb1yDDCY1NB5bFtfHU93FsVxaAcSssryCkdiEKURpjGKjE1lIv6uP3wh'+
      '\nkHfjljOX9GJ5zAN7LR1LD8eM9H4NCGcw7BLNYOc6MNiiGP8BvLquj6n2IDa7jq6c'+
      '\ninG9HkEifDEQnZuDrfhItmduAs46ehDjZASgwZz9qkDZNwqXAI6uYMdwkyQJrv4o'+
      '\nFRu9+B9ChDfap75JS1oZnOsxOHb9afZ6mYDWDQHIp+qe40JoJxkYBATr/fhfU//9'+
      '\nIXIZfJSlgGRFwwA2/V9+Luk0zJVjL/qUJjH9apW0V6j5n/PBW2ycYVnc/RtsLoAl'+
      '\nHu5BDdKp+5HRUXnzfKHuJzOVB9zMRhx4Z5l05dg9baZE0xFvFIFNh10wLc00nKhI'+
      '\n40aIXJC6\n=6XSv\n-----END PGP SIGNATURE-----\n');
    t('gpg', `${_t_common}
      $$bm(branch:main) $$mf(mode:100644) $$m0(mode:0)
      $$d1(8b137891791fe96927ad78e64b0aad7bded08bdc)
      $$oid1(cc89e3d5f7bee12d8cb3b0564c18b27b9507f7ff)
      $$oid2(b2694edc28f75909ec5e2af1b9cae53479753624)
      $$toid(1e86977cdcf23a10d2fe57debe9fba53be1467be)
      $$c(commit_oid:$oid2 gpgsig:${gpg9})
      $$g5(gpgsig:${gpg5})
      $$g7(gpgsig:${gpg7})
      $$sync(sync(seal:false head:main
        gitdir(${process.cwd()+'/test_git/test_tag_gpg'})))
      $$t(##seq$1={bseq:$2 type:$4 op:$5 $7... git:{oid:$3 $6}})
      s..git(src(lif-rnd/test_tag_gpg)) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:0x0a)
      (5  !     $oid1 commit   add $g5 group:2 _desc:add_f1)
      (6  !     $d1   fs       add $mf file:/f2 link:4)
      (7  !     $oid2 commit   add $g7 group:1 _desc:add_f2)
      (8  !     $oid2 tag      add !   link:7 tag:tag1)
      (9  !     $toid tag_o    add $c  link:7 tag:tag_gpg _desc:tag_gpg_desc)
      (10 !     $toid tag      add !   link:9 tag:tag_gpg))
      ##seq11={}`);
    t('gpg_remote', `${_t_common}
      $$bm(branch:main) $$mf(mode:100644) $$m0(mode:0)
      $$d1(8b137891791fe96927ad78e64b0aad7bded08bdc)
      $$oid1(cc89e3d5f7bee12d8cb3b0564c18b27b9507f7ff)
      $$oid2(b2694edc28f75909ec5e2af1b9cae53479753624)
      $$toid(1e86977cdcf23a10d2fe57debe9fba53be1467be)
      $$c(commit_oid:$oid2 gpgsig:${gpg9})
      $$g5(gpgsig:${gpg5})
      $$g7(gpgsig:${gpg7})
      $$sync(sync(seal:false))
      $$t(##seq$1={bseq:$2 type:$4 op:$5 $7... git:{oid:$3 $6}})
      s..git(src(lif-rnd/test_tag_gpg)) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $d1   fs       add $mf file:/f1 content:1 f2:0x0a)
      (5  !     $oid1 commit   add $g5 group:2 _desc:add_f1)
      (6  !     $d1   fs       add $mf file:/f2 link:4)
      (7  !     $oid2 commit   add $g7 group:1 _desc:add_f2)
      (8  !     $oid2 tag      add !   link:7 tag:tag1)
      (9  !     $toid tag_o    add $c  link:7 tag:tag_gpg _desc:tag_gpg_desc)
      (10 !     $toid tag      add !   link:9 tag:tag_gpg))
      ##seq11={}`);
    let gpg3 = encode_str('-----BEGIN PGP SIGNATURE-----\n'+
      '\nwsBcBAABCAAQBQJjhahDCRBK7hj4Ov3rIwAAnpwIAERdey8XBjlOhm5T8hnPhDUS'+
      '\nlfuK6mT/zO2Jw9YL1kfF6iK9cefdvFrcjq6Ecbq4TgkQSAaPYeBAEKJYhWa3yIMr'+
      '\nVBjQy0o6YnK8Sf2jqNr/vyCCLsRaN3ANuuV8G09AUjh6Cn1I635vNBMjg41T/jqX'+
      '\nFCVDrs+I+xUMItL9XIRG9IBrkKBzZv25kbhqg6smfmfBydR6nO7hNMF3qvG16Eye'+
      '\nhtz7p4/jH92e8a+GwEP6CD6PrS4bF2yv0KaCgJr/sQqN36mF9RcVanTHvSn7PBaV'+
      '\naFCYmUr36mXeGEd5VJflXD1o54ikte1/S5QwGmN1j+8lxwNSzoxfjQLEJYmn0V0='+
      '\n=B9M5\n-----END PGP SIGNATURE-----\n');
    t('move', `${_t_common}
      $$bm(branch:main) $$mf(mode:100644) $$m0(mode:0) $$md(mode:040000)
      $$d2(${'0x66696c6520613a0a'+('58'.repeat(104)+'0a').repeat(17)})
      $$d12(${'0x66696c6520630a'+('58'.repeat(104)+'0a').repeat(17)})
      $$d23(0x7878780a)
      $$d27(0x5858585f626262620a)
      $$of2(7780c82f7ec168abd6f2cd9f756058fcedad80f2)
      $$of12(bc9e3e7b4c0e05a8efb4942498c1afc86d431672)
      $$of23(d6459e005434a49a66a3ddec92279a86160ad71f)
      $$of27(6d700c06af2977bb61a59cdefb4957ec3ef4f6ff)
      $$oid1(4160553ff40409ebd42a5cf29c02b3e0d2cade54)
      $$oid2(d13f423f4853887bd7503f078b2887da6b64e43b)
      $$oid3(05dfa3ebd084699425fe3ac202ec7cae7bbee89b)
      $$oid4(3538536829ce7864fa53cdd85b78af1e8c5c8522)
      $$oid5(a7dc61ad160e9e5d004f02b86e79bc289ad24af8)
      $$oid6(c0232fb014456ae8ee9b8060121a67016eda6512)
      $$oid7(aa18f16781702a407f879aca38902577418f7cb3)
      $$g3(gpgsig:${gpg3})
      $$sync(sync(seal:false head:main
        gitdir(${process.cwd()+'/test_git/test_move'})))
      $$t(##seq$1={bseq:$2 type:$4 op:$5 $7... git:{oid:$3 $6}})
      s..git(src(lif-rnd/test_move)) $sync $t $$(
      (1  !     !     git_br   add $bm !)
      (2  !     !     git_head add $bm !)
      (3  !     !     fs       add $m0 dir:/)
      (4  !     $of2  fs       add $mf file:/a content:1 f2:$d2)
      (5  !     $oid1 commit   add $g3 group:2 _desc(Create a))
      (6  !     !     fs       rm  !   file:/a)
      (7  !     $of2  fs       add $mf file:/b link:4)
      (8  !     $oid2 commit   add !   group:2 desc(move a to b))
      (9  !     !     fs       add $md dir:/dir1/)
      (10 !     $of2  fs       add $mf file:/dir1/b link:4)
      (11 !     $oid3 commit   add !   group:2 desc(move /b -> /dir1/b))
      (12 !     $of12 fs       add $mf file:/dir1/c content:1 f2:$d12)
      (13 !     $oid4 commit   add !   group:1 desc(add c))
      (14 !     !     fs       rm  !   file:/dir1/c)
      (15 !     !     fs       rm  !   file:/dir1/b)
      (16 !     !     fs       rm  !   dir:/dir1/)
      (17 !     !     fs       add $md dir:/dir2/)
      (18 !     $of2  fs       add $mf file:/dir2/b link:4)
      (19 !     $of12 fs      add $mf file:/dir2/c link:12)
      (20 !     $oid5 commit   add !   group:6 desc(/dir1 -> /dir2))
      (21 !     !     fs       rm  !   file:/b)
      (22 !     !     fs       add $md dir:/b/)
      (23 !     $of23 fs       add $mf file:/b/a content:1 f2:$d23)
      (24 !     $oid6 commit   add !   group:3 desc(change b from file to dir))
      (25 !     !     fs       rm  !   file:/b/a)
      (26 !     !     fs       rm  !   dir:/b/)
      (27 !     $of27 fs       add $mf file:/b content:1 f2:$d27)
      (28 !     $oid7 commit   add !   group:3 desc(change b from dir to file))
      ) ##seq29={}`);
    t('db_sync_empty', `${_t_common} s..git(db src:git_test head:master)
      $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !))
      ##seq3={}`);
    t('db_one_branch_del_branch_inc', `${_t_common}
      s..git(db src:git_test head:master) $add_f1 $sync $t $$(
      (1  !     !     git_br   add $bm       !)
      (2  !     !     git_head add $bm       !)
      (3  !     !     fs       add $m0       dir:/)
      (4  !     $d1   fs       add $mf       file:/f1 content:1 f2:d1)
      (5  !     $oid1 commit   add !         group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0 $oid1 git_br   add !         branch:b1))
      $add_f2 $sync $_(
      (7  5-1.1 $d1   fs       add $mf       file:/f2 link:4)
      (8  5-1.2 $oid2 commit   add !         group:1 desc:c_f2))
      git_br(master) $add_f3 $sync $_(
      (9  6     $d1   fs       add $mf       file:/f3 link:4)
      (10 7     $oid3 commit   add !         group:1 desc:c_f3))
      git_br_del(b1) $sync $_(
      (11 5-1.3 !     git_br   rm  branch:b1 !))
      ##seq12={} verify_git`);
    t('db_three_branch_inc', `${_t_common} s..git(db src:git_test head:master)
      $add_f1 $sync $tb $$(
      (1  !         !     git_br   add !   !   $bm !)
      (2  !         !     git_head add !   !   $bm !)
      (3  !         !     fs       add !    ! $m0 dir:/)
      (4  !         $d1   fs       add !    ! $mf file:/f1 content:1 f2:d1)
      (5  !         $oid1 commit   add !    ! !   group:2 desc:c_f1))
      git_br_new(b1) $sync $_(
      (6  5-1.0     $oid1 git_br   add b1   ! !   !))
      git_br_new(b2) $sync $_(
      (7  5-2.0     $oid1 git_br   add b2   ! !   !))
      git_br(b1) $add_f2 $sync $_(
      (8  5-1.1     $d1   fs       add !    ! $mf file:/f2 link:4)
      (9  5-1.2     $oid2 commit   add !    ! !   group:1 desc:c_f2))
      git_br_new(b1_1) $add_f3 $sync $_(
      (10 5-1.2-1.0 $oid2 git_br   add b1_1 ! !   !)
      (11 5-1.2-1.1 $d1   fs       add !    ! $mf file:/f3 link:4)
      (12 5-1.2-1.2 $oid3 commit   add !    ! !   group:1 desc:c_f3))
      git_br(b2) $add_f4 $sync $_(
      (13 5-2.1     $d1   fs       add !    ! $mf file:/f4 link:4)
      (14 5-2.2     $oid4 commit   add !    ! !   group:1 desc:c_f4))
      git_br(master) $add_f5 $sync $_(
      (15 6         $d1   fs       add !    ! $mf file:/f5 link:4)
      (16 7         $oid5 commit   add !    ! !   group:1 desc:c_f5))
      ##seq17={} verify_git`);
    t('db_tag_inc', `${_t_common} s..git(db src:git_test head:master)
      $add_f1 $sync $t $$(
      (1  ! !     git_br   add $bm !)
      (2  ! !     git_head add $bm !)
      (3  ! !     fs       add $m0 dir:/)
      (4  ! $d1   fs       add $mf file:/f1 content:1 f2:d1)
      (5  ! $oid1 commit   add !   group:2 desc:c_f1))
      $add_f2 $sync $_(
      (6  ! $d1   fs       add $mf file:/f2 link:4)
      (7  ! $oid2 commit   add !   group:1 desc:c_f2))
      $add_f3 $sync $_(
      (8  ! $d1   fs       add $mf file:/f3 link:4)
      (9  ! $oid3 commit   add !   group:1 desc:c_f3))
      git_tag(t1 $oid1) $sync $_(
      (10 ! $oid1 tag      add !   tag:t1 link:5))
      git_tag(t1 $oid2) $sync $_(
      (11 ! $oid2 tag      mod !   tag:t1 link:7))
      git_tag(t3 $oid3) $sync $_(
      (12 ! $oid3 tag      add !   tag:t3 link:9))
      git_tag_del(t1) $sync $_(
      (13 ! $oid2 tag      rm  !   tag:t1))
      ##seq14={} verify_git`);
  });
});
