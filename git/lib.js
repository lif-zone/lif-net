// author: derry. coder: arik.
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import array from '../util/array.js';
import xutil from '../util/util.js';
import git_api from 'isomorphic-git';
import http from 'isomorphic-git/http/node/index.cjs';
import fs from 'fs';
import assert from 'assert';
import * as Diff from 'diff';
const E = {};

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

let oid2seq = new Map(), path2seq = new Map(), seq2state = new Map();

const get_state = (config, dir, oid, mode, state)=>
  etask(function*_put_tree(){
  mode = mode||0;
  let {tree} = yield git_api.readTree({...config, oid});
  let next = {type: 'dir', path: dir, oid, mode};
  state = state||new FS_state();
  state.set(dir, next);
  for (let i=0; i<tree.length; i++){
    let e = tree[i], path = dir+'/'+e.path;
    switch (e.type){
    case 'blob':
      next = {path, oid: e.oid, mode: e.mode};
      state.set(path, next);
      break;
    case 'tree':
      yield get_state(config, path, e.oid, e.mode, state);
      break;
    default: xerr.xexit('unknown type '+e.type);
    }
  }
  return state;
});

class FS_state {
  constructor(state){
    this.path = new Map(state?.path);
    this.oid = new Map(state?.oid);
  }
  get(path){ return this.path.get(path); }
  get_oid(oid){ return this.oid.get(oid); }
  set(path, o){
    assert(o.oid && path==o.path, 'invalid state entry');
    this.oid.set(o.oid, o);
    return this.path.set(path, o);
  }
  delete(o){
    this.path.delete(o.path);
    this.path.delete(o.path);
  }
  delete_path(path){ return this.path.delete(path); }
}

// XXX: how to detect file move (exact move, move+modifications)
// eg commit 17: https://github.com/lif-zone/server/commit/e24039a1b371f9f05ce53829e9c6bc3ad675fa53?diff=split
// XXX: what about directory move. need to optimize and not remove/readd all
const put_diff = (config, scroll, prev, state_curr, state_next)=>etask(
  function*_put_diff(){
  // XXX: optimize, if directory is the same, no need to test all sub dir
  let move_dir = [];
  for (const [path, next] of state_next.path){
    let curr = state_curr.get(path), prev_oid = state_curr.get_oid(next.oid);
    if (move_dir.find(p=>path.startsWith(p))){
      state_curr.delete(prev_oid);
      continue;
    }
    let decl, blob, seq_blob, link, content, seq_path, move;
    state_curr.delete_path(path);
    if (xutil.equal_deep(curr, next))
      continue;
    // XXX: check behavior when dir become file and vice versa
    if (next.type=='dir' && curr?.type=='dir')
      continue;
    if (next && curr && next.type!=curr.type){
      let data = curr.type=='dir' ? {dir: path+'/', del: true} :
        {file: path, del: true};
      let decl = yield scroll.decl({prev}, data);
      prev = decl.seq;
      curr = null;
      prev_oid = null;
    }
    let git = {oid: next.oid, mode: next.mode};
    if (next.type=='dir'){
      let data = {dir: path+'/'}, move;
      if (!curr && prev_oid && prev_oid.path!=path &&
        !path.startsWith(prev_oid.path)){
        move = {dir: prev_oid.path+'/'};
        move_dir.push(path+'/');
        state_curr.delete(prev_oid);
      }
      if (move)
        data.move = move;
      data.git = git;
      decl = yield scroll.decl({prev}, data);
      prev = decl.seq;
    } else {
      if (!curr && prev_oid && prev_oid.path!=path){
        move = {file: prev_oid.path};
        state_curr.delete(prev_oid);
      } else if (seq_blob = oid2seq.get(next.oid)){
        link = {l: seq_blob};
        content = 'l';
      } else if (seq_path = curr&&oid2seq.get(curr.oid)||path2seq.get(path)){
        let decl_old = yield scroll.get_decl(seq_path);
        let d_old = decl_old.fbuf_get(0).get_json(2);
        let oid_old = d_old.git.oid;
        let buf_old = d_old.file && (yield git_api.readBlob({...config,
          oid: oid_old})).blob;
        let buf_new = (yield git_api.readBlob({...config, oid: next.oid}))
        .blob;
        if (!buf_old || is_bin(buf_old) || is_bin(buf_new))
          blob = buf_new;
        else {
          let s_old = Buffer.from(buf_old).toString();
          let s_new = Buffer.from(buf_new).toString();
          let diff = Diff.createPatch(path, s_old, s_new, '', '',
            {context: 0});
          blob = Buffer.from(diff);
          if (blob.length < 0.5*s_new.length){
            link = {l: seq_path};
            content = {diff: 'l'};
          } else
            blob = buf_new;
        }
      } else {
        blob = (yield git_api.readBlob({...config, oid: next.oid})).blob;
      }
      let data = [{file: path}];
      if (move)
        data[0].move = move;
      if (content)
        data[0].content = content;
      data[0].git = git;
      if (blob)
        data.push(blob);
      decl = yield scroll.decl({prev, link}, data);
      prev = decl.seq;
    }
    if (decl){
      oid2seq.set(next.oid, decl.seq);
      path2seq.set(path, decl.seq);
    }
  }
  for (const [path, curr] of state_curr.path){
    let data = curr.type=='dir' ? {dir: path+'/', del: true} :
      {file: path, del: true};
    let decl = yield scroll.decl({prev}, data);
    prev = decl.seq;
  }
  return prev;
});

// XXX: ugly hack
E.json_str = function(o){
  let s = JSON.stringify(o);
  s = s.replace(/":/g, ': ');
  s = s.replace(/,"/g, ', ');
  s = s.replace(/{"/g, '{');
  s = s.replace(/"/g, '\'');
  return s;
};

E.scroll_to_lines = function(scroll){
  let a = [];
  for (let i=0; i<=scroll.top.seq; i++){
    let decl = scroll.get_decl(i), fbuf = decl.fbuf_get(0);
    let h = fbuf.get_json(1);
    let o = fbuf.get_json(2);
    let blob = fbuf.get_frames()[3];
    delete h.ts;
    a.push([h, o, blob ? blob?.buf.length : '']);
  }
  return a;
};

E.dump_scroll = function(scroll){
  for (let i=0; i<=scroll.top.seq; i++){
    let decl = scroll.get_decl(i), fbuf = decl.fbuf_get(0);
    // XXX: need nice api
    let h = {...fbuf.get_json(1)};
    let o = fbuf.get_json(2);
    let blob = fbuf.get_frames()[3];
    delete h.ts;
    console.log('%s %s%s', E.json_str(h), E.json_str(o),
      blob?.buf ? ' blob '+blob.buf.length : '');
  }
};

function build_prev_sync_index(scroll){
  // XXX: need to have built-in index in scroll
  let prev_sync = {commit: new Map(), branch: new Map(), tag: new Map(),
    head: null};
  if (true)
    return prev_sync;
  for (const [seq, decl] of scroll.dmap){
    let data = decl.fbuf_get(0).get_json(2);
    if (data.commit)
      prev_sync.commit.set(data.commit, {seq});
    if (data.branch)
      prev_sync.branch.set(data.branch, {seq});
    if (data.tag)
      prev_sync.tag.set(data.tag, {seq});
    if (data.head)
      prev_sync.head = {seq};
  }
  return prev_sync;
}

const get_state_seq = (config, scroll, seq)=>etask(function*get_state_seq(){
  let tree = scroll.get_decl(seq).fbuf_get(0).get_json(2).git.tree;
  assert(tree, 'no tree for seq'+seq);
  let state = seq2state.get(seq);
  assert(state, 'XXX state not found seq'+seq); // XXX: rm
  if (state)
    return state;
  state = yield get_state(config, '', tree);
  seq2state.set(seq, state);
  return state;
});

// XXX TODO
// initial sync:
// * fix javascript.vim (delete and friends highlight0
//   - send derry patch
// + move prev to decl header part {seq, prev, link}
// + links {seq: 57, link: {"l": 37}}, data-frame (and also for prev/merge
//   seq57 {"file":"/package-lock.json","content":{"diff":{_l: "l"}
// + handle merges
// + diff files (text/binary)
//   + fix diff with merges
//   + binary - no diff
//   + text - diff, if diff_sz<0.5*blob_sz
//   + test binary files
// + detect file/dir move
//   + a.js -> b.js
//     {"file_src":"/a.js", file_dst: '/b.js', content: 'hello'|{diff},
//     mv: '/a.js' seq3}
//    {"file":"/a.js", del: true, mv: '/b.js'}
//   + /a - > /b
//   o handle dir <-> file (change type)
//     o BUG: isomorphic-git doesn't support it during pull
//   o detect move with changes
// - test diretory delete
// + pgp for commits (gpgsig)
// + support branch
// o support tags
//   + simple tag
//   o anotatedTag/git releases
// o support notes
// + default branch/HEAD
// - save persistent data to indexdeddb
// - cleanup code
// - incermental sync - support update of existing scroll (need to use prev)
//   - pull and update of scroll with new commits
// - export to git
// - fix scroll api:
//   - get_scroll/put_scroll
//   - make api friendly to use (eg. get_json)
//   - make db api object oriented and support on demand loading
// private repositories
E.import_git = (config, scroll)=>etask(function*_start(){
  config = {...config};
  config.fs = config.fs||fs;
  config.http = config.http||http;
  yield git_api.clone({...config});
  let branches = yield git_api.listBranches({...config, remote: 'origin'});
  let tags = yield git_api.listTags({...config, remote: 'origin'});
  let prev_sync = build_prev_sync_index(scroll);
  array.rm_elm(branches, 'HEAD');
  array.rm_elm(branches, 'main');
  branches.unshift('main');
  for (let b=0; b<branches.length; b++){
    let branch = branches[b];
    yield git_api.checkout({...config, ref: branch, remote: 'origin'});
    yield git_api.pull({...config});
    let commits = yield git_api.log({...config, ref: branch});
    commits.reverse();
    for (let i=0; i<Math.min(18, commits.length); i++){
      let oid = commits[i].oid, commit = commits[i].commit, prev, merge;
      if (prev_sync.commit.get(oid)){
        console.log('XXX skip prev sync %s', oid);
        continue;
      }
      if (oid2seq.get(oid))
        continue;
      commit.parent.forEach(p=>{
        let seq_p = oid2seq.get(p);
        assert(!merge, 'merge already defined '+p);
        assert(seq_p, 'parent not found '+p);
        if (prev)
          merge = seq_p;
        else
          prev = seq_p;
      });
      let state_curr = !prev ? new FS_state() :
        new FS_state(yield get_state_seq(config, scroll, prev));
      let state_next = yield get_state(config, '', commit.tree);
      let seq_start = scroll.top.seq;
      prev = yield put_diff(config, scroll, prev, state_curr, state_next);
      let info = pick_rename(commit,
        {message: 'desc', 'author.name': 'author'});
      info.ts = date_utc(commit.author.timestamp,
        commit.author.timezoneOffset);
      let group = scroll.top.seq-seq_start;
      let data = {commit: oid, ...info};
      data.git = merge ? {merge, ...commit} : {...commit};
      let decl = yield scroll.decl({prev, group}, data);
      oid2seq.set(oid, decl.seq);
      seq2state.set(decl.seq, state_next);
      prev = decl.seq;
    }
  }
  let refs = yield git_api.listServerRefs({...config, remote: 'origin'});
  let head_oid = refs.find(o=>o.ref=='HEAD')?.oid, head_seq;
  for (let i=0; i<branches.length; i++){
    let branch = branches[i];
    let oid = yield git_api.resolveRef({...config, ref: branch});
    let seq = oid2seq.get(oid), link = {l: seq}, dst = 'l';
    assert(seq, 'branch not found '+branch);
    // XXX: set prev as pointer to previous branch
    let decl = yield scroll.decl({link}, {branch, dst, git: {oid}});
    if (oid==head_oid)
      head_seq = decl.seq;
  }
  for (let i=0; i<tags.length; i++){
    let tag = tags[i];
    let oid = yield git_api.resolveRef({...config, ref: tag});
    let seq = oid2seq.get(oid), link = {l: seq}, dst = 'l';
    assert(seq, 'tag not found '+tag);
    // XXX: set prev as pointer to previous branch
    yield scroll.decl({link}, {tag, dst, git: {oid}});
  }
  if (head_oid){
    head_seq = head_seq || oid2seq(head_oid);
    assert(head_seq, 'head seq not found '+head_oid);
    let link = {l: head_seq};
    yield scroll.decl({link}, {head: 'l', git: {oid: head_oid}});
  }
});

export default E;
