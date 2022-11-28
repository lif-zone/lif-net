// author: derry. coder: arik.
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import array from '../util/array.js';
import xutil from '../util/util.js';
import Scroll from '../storage/scroll.js';
import Soul from '../storage/soul.js';
import git_api from 'isomorphic-git';
import http from 'isomorphic-git/http/node/index.cjs';
import fs from 'fs';
import assert from 'assert';
import buf_util from '../peer-relay/buf_util.js';
import * as Diff from 'diff';
const s2b = buf_util.buf_from_str;
const work_dir = '/tmp/lif_test_merge_simple';

// XXX: move to other place
xerr.set_exception_catch_all(true);
process.on('uncaughtException', err_handler);
process.on('unhandledRejection', err_handler);
xerr.set_exception_handler('test', (prefix, o, err)=>err_handler(err));

function err_handler(err){
  console.error('err handler:');
  console.error(err);
  let err2 = new Error('err_handler');
  err2.err_orig = err;
  debugger; // eslint-disable-line no-debugger
  throw err2;
}

// XXX derry: mv to util (and is there better way)
function is_bin(blob){
  for (let i=0; i<blob.length; i++){
    if (blob[i]==0)
      return true;
  }
  return false;
}

function pick_rename(o, fields){
  let ret = {};
  for (let src in fields){
    let dst = fields[src];
    ret[dst] = xutil.get(o, src);
    xutil.unset(o, src); // XXX: xutil
  }
  return ret;
}

function date_utc(ts, tz){ return +new Date(ts+tz*60000); }

let oid2seq = new Map(), path2seq = new Map(), tree2state = new Map();
let seq2state = new Map();

const get_next_state = (dir, oid, mode, state_curr, state_next)=>etask(
  function*_put_tree(){
  let {tree} = yield git_api.readTree({fs, dir: work_dir, oid});
  let next = {type: 'dir', path: dir, oid, mode};
  state_next = state_next||{};
  state_next[dir] = next;
  for (let i=0; i<tree.length; i++){
    let e = tree[i], path = dir+'/'+e.path;
    switch (e.type){
    case 'blob':
      next = {path, oid: e.oid, mode: e.mode};
      state_next[path] = next;
      break;
    case 'tree':
      yield get_next_state(path, e.oid, e.mode, state_curr, state_next);
      break;
    default: xerr.xexit('unknown type '+e.type);
    }
  }
  return state_next;
});

// XXX: how to detect file move (exact move, move+modifications)
// eg commit 17: https://github.com/lif-zone/server/commit/e24039a1b371f9f05ce53829e9c6bc3ad675fa53?diff=split
// XXX: what about directory move. need to optimize and not remove/readd all
const put_diff = (scroll, prev, state_curr, state_next)=>etask(
  function*_put_diff(){
  // XXX: optimize, if directory is the same, no need to test all sub dir
  for (let path in state_next){
    let curr = state_curr[path], next = state_next[path], decl, fbuf;
    let blob, seq_blob, content, seq_path;
    delete state_curr[path];
    if (xutil.equal_deep(curr, next))
      continue;
    // XXX: check behavior when dir become file and vice versa
    if (next.type=='dir' && curr?.type=='dir')
      continue;
    let git = {oid: next.oid, mode: next.mode};
    if (next.type=='dir'){
      let data = {dir: path};
      data.git = git;
      decl = yield scroll.decl({prev}, data);
      prev = decl.seq;
    } else {
      if (seq_blob = oid2seq.get(next.oid))
        content = {seq: seq_blob};
      else if (seq_path = path2seq.get(path)){
        let decl_old = yield scroll.get_decl(seq_path);
        // XXX: find better way
        let oid_old = JSON.parse(
          decl_old.fbuf_get(0).frames[2].buf.toString()).git.oid;
        let buf_old = (yield git_api.readBlob({fs, dir: work_dir,
          oid: oid_old})).blob;
        let buf_new = (yield git_api.readBlob({fs, dir: work_dir,
          oid: next.oid})).blob;
        if (is_bin(buf_old) || is_bin(buf_new)){
          let s_old = Buffer.from(buf_old).toString();
          let s_new = Buffer.from(buf_new).toString();
          let diff = Diff.createPatch(path, s_old, s_new, '', '',
            {context: 0});
          blob = Buffer.from(diff);
          if (blob.length < 0.5*s_new.length)
            content = {diff: {seq: seq_path}};
          else
            blob = buf_new;
        } else
          blob = buf_new;
      } else {
        blob = (yield git_api.readBlob({fs, dir: work_dir, oid: next.oid}))
        .blob;
      }
      let data = content ? [{file: path, content}] : [{file: path}];
      data[0].git = git;
      if (blob)
        data.push(blob);
      decl = yield scroll.decl({prev}, data);
      prev = decl.seq;
    }
    if (decl){
      oid2seq.set(next.oid, decl.seq);
      path2seq.set(path, decl.seq);
    }
  }
  for (let path in state_curr){
    let curr = state_curr[path];
    let data = curr.type=='dir' ? {dir: path, del: true} :
      {file: path, del: true};
    let decl = yield scroll.decl({prev}, data);
    prev = decl.seq;
  }
  return prev;
});

// XXX: ugly hack
function json_str(o){
  let s = JSON.stringify(o);
  s = s.replace(/":/g, ': ');
  s = s.replace(/,"/g, ', ');
  s = s.replace(/{"/g, '{');
  s = s.replace(/"/g, '\'');
  return s;
}

function dump_scroll(scroll){
  for (let i=0; i<=scroll.top.seq; i++){
    let decl = scroll.get_decl(i), fbuf = decl.fbuf_get(0);
    // XXX: need nice api
    let h = JSON.parse(fbuf.get_frames()[1].buf.toString());
    let o = JSON.parse(fbuf.get_frames()[2].buf.toString());
    delete h.ts;
    console.log('%s %s', json_str(h), json_str(o));
  }
}

// XXX TODO
// XXX: move prev to decl header part {seq, prev, link}
// XXX: {seq: 57, link: {"l": 37}}, data-frame (and also for prev/merge
// seq57 {"file":"/package-lock.json","content":{"diff":{_l: "l"},
// initial sync:
// + handle merges
// + diff files (text/binary)
//   + binary - no diff
//   + text - diff, if diff_sz<0.5*blob_sz
//   + test binary files
// - detect file/dir move
//   a.js -> b.js
//   {"file_src":"/a.js", file_dst: '/b.js', content: 'hello'|{diff},
//     mv: '/a.js' seq3}
//   {"file":"/a.js", del: true, mv: '/b.js'}
//   - handle dir <-> file (change type)
// + pgp for commits (gpgsig)
// + support branch
// - support tags (annotate, pgpsig)
// - support notes
// - export to git
// - cleanup code
// - incermental sync - support update of existing scroll (need to use prev)
//   - save persistent data to indexdeddb
//   - pull and update of scroll with new commits
// private repositories
const start = ()=>etask(function*_start(){
  let keypair = {pub: s2b('44659cb51dec397ea66085679442505345e159940762c15ef7'+
    '5ad279ecf05033'),
    key: s2b('46f45a62f4c5971228747aa2d8ee66bd669ebd805c725286ee385b1d4a06dd'+
    'bc44659cb51dec397ea66085679442505345e159940762c15ef75ad279ecf05033')};
  let url = 'https://github.com/lif-zone/test_merge_simple';
  console.log('git2lif %s %s', url, work_dir);
  yield git_api.clone({fs, http, dir: work_dir, url});
  let branches = yield git_api.listBranches({fs, dir: work_dir,
    remote: 'origin'});
  // XXX: need to add HEAD to scroll
  array.rm_elm(branches, 'HEAD');
  array.rm_elm(branches, 'main');
  branches.unshift('main');
  let scroll = yield Scroll.create({key: keypair.key, pub: keypair.pub},
    {topic: 'git', src: url});
  for (let b=0; b<branches.length; b++){
    let branch = branches[b];
    yield git_api.checkout({fs, http, dir: work_dir, ref: branch,
      remote: 'origin'});
    yield git_api.pull({fs, http, dir: work_dir, url,
      author: {name: 'XXX', email: 'xxx@xxx.com'}});
    let commits = yield git_api.log({fs, dir: work_dir, ref: branch});
    commits.reverse();
    let state_curr={}; // XXX: move in
    for (let i=0; i<Math.min(18, commits.length); i++){
      let oid = commits[i].oid, commit = commits[i].commit, prev, merge;
      if (oid2seq.get(oid)){
//        state_curr = xutil.clone_deep(tree2state.get(commit.tree));
//        prev = oid2seq.get(oid);
        continue;
      }
      commit.parent.forEach(p=>{
        let seq_p = oid2seq.get(p);
        assert(!merge, 'merge already defined '+p);
        assert(seq_p, 'parent not found '+p);
        if (prev)
          merge = seq_p;
        else
          prev = seq_p;
      });
      state_curr = prev ? xutil.clone_deep(seq2state.get(prev)) : {};
      let state_next = yield get_next_state('', commit.tree, 0, state_curr);
      let seq_start = scroll.top.seq;
      prev = yield put_diff(scroll, prev, state_curr, state_next);
      let info = pick_rename(commit,
        {message: 'desc', 'author.name': 'author'});
      info.ts = date_utc(commit.author.timestamp,
        commit.author.timezoneOffset);
      // XXX commit_ops
      let commit_ops = scroll.top.seq-seq_start;
      let data = {commit: oid, commit_ops, ...info};
      data.git = merge ? {merge, ...commit} : {...commit};
      let decl = yield scroll.decl({prev}, data);
      oid2seq.set(oid, decl.seq);
      tree2state.set(commit.tree, xutil.clone_deep(state_next)); // XXX: rm
      seq2state.set(decl.seq, xutil.clone_deep(state_next));
      state_curr = state_next;
      prev = decl.seq;
    }
  }
  for (let b=0; b<branches.length; b++){
    let branch = branches[b];
    let oid = yield git_api.resolveRef({fs, dir: work_dir, ref: branch});
    let seq = oid2seq.get(oid);
    assert(seq, 'branch not found '+branch);
    // XXX: set prev as pointer to previous branch
    scroll.decl({branch, seq, git: {oid}});
  }
  dump_scroll(scroll);
});

(async()=>await start())();

