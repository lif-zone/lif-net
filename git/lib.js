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

let oid2seq, path2seq, seq2state; // XXX: make it context-based (not global)

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
    this.path.delete(o.oid);
    this.path.delete(o.path);
  }
  delete_path(path){ return this.path.delete(path); }
}

// XXX: how to detect file move (exact move, move+modifications)
// eg commit 17: https://github.com/lif-zone/server/commit/e24039a1b371f9f05ce53829e9c6bc3ad675fa53?diff=split
// XXX: what about directory move. need to optimize and not remove/readd all
const put_diff = (config, scroll, prev, state_next)=>etask(
  function*_put_diff(){
  let state_curr = prev ? yield get_state_seq(config, scroll, prev) :
    new FS_state();
  let state_del = new FS_state(state_curr);
  // XXX: optimize, if directory is the same, no need to test all sub dir
  let move_dir = [];
  for (const [path, next] of state_next.path){
    let curr = state_curr.get(path), prev_oid = state_curr.get_oid(next.oid);
    if (move_dir.find(p=>path.startsWith(p))){
      state_del.delete(prev_oid);
      continue;
    }
    let decl, blob, seq_blob, link, content, diff, seq_path, move;
    state_del.delete_path(path);
    if (xutil.equal_deep(curr, next))
      continue;
    // XXX: check behavior when dir become file and vice versa
    if (next.type=='dir' && curr?.type=='dir')
      continue;
    if (next && curr && next.type!=curr.type){
      let data = curr.type=='dir' ? {dir: path+'/', rm: true} :
        {file: path, rm: true};
      let decl = yield scroll.decl({prev}, data);
      prev = decl.seq;
      curr = null;
      prev_oid = null;
    }
    // content
    // {seq: 8, link: 6} {file: '/branch1_file1', ...}
    // {seq: 8, link: 6} {file: '/branch1_file1', content: {d: '_'}, ...}
    // {seq: 8} {file: '/branch1_file1', content: {d: 1}, ...}, blob
    // {seq: 8} {file: '/branch1_file1', content: 1, ...}, blob
    // {seq: 8} {file: '/branch1_file1', content: 'abc', ...}
    // diff
    // {seq: 8, link: 6} {file: '/branch1_file1', diff: 1, ...}, blob
    // {seq: 8, link: 6} {file: '/branch1_file1', diff: 'abc', ...}
    // {seq: 8, link: 6} {file: '/branch1_file1', diff: {d: 1}, ...}, blob
    // {seq: 8, link: {_: 6, d: 3}} {file: '/branch1_file1', diff: {d: 'd'}}
    let git = {oid: next.oid, mode: next.mode}, add = !curr;
    if (next.type=='dir'){
      let data = {dir: path+'/'}, move;
      if (!curr && prev_oid && prev_oid.path!=path &&
        !path.startsWith(prev_oid.path) && !state_next.get(prev_oid.path)){
        move = {dir: prev_oid.path+'/'};
        move_dir.push(path+'/');
        state_del.delete(prev_oid);
      }
      if (move)
        data.move = move;
      if (add)
        data.add = true;
      data.git = git;
      decl = yield scroll.decl({prev}, data);
      prev = decl.seq;
    } else {
      if (!curr && prev_oid && prev_oid.path!=path &&
        !state_next.get(prev_oid.path)){
        move = {file: prev_oid.path};
        state_del.delete(prev_oid);
      } else if (seq_blob = oid2seq.get(next.oid))
        link = seq_blob;
      else if (seq_path = curr&&oid2seq.get(curr.oid)||path2seq.get(path)){
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
          let s_diff = Diff.createPatch(path, s_old, s_new, '', '',
            {context: 0});
          blob = Buffer.from(s_diff);
          if (blob.length < 0.5*s_new.length){
            [link, diff] = [seq_path, 1];
          } else
            [content, blob] = [1, buf_new];
        }
      } else {
        content = 1;
        blob = (yield git_api.readBlob({...config, oid: next.oid})).blob;
      }
      let data = [{file: path}];
      if (move)
        data[0].move = move;
      else if (add)
        data[0].add = true;
      if (content)
        data[0].content = content;
      if (diff)
        data[0].diff = diff;
      data[0].git = git;
      if (blob)
        data.push(blob);
      decl = yield scroll.decl({prev, link}, data);
      prev = decl.seq;
    }
    if (decl){
      if (!oid2seq.get(next.oid))
        oid2seq.set(next.oid, decl.seq);
      path2seq.set(path, decl.seq);
    }
  }
  for (const [path, curr] of state_del.path){
    let data = curr.type=='dir' ? {dir: path+'/', rm: true} :
      {file: path, rm: true};
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

function dir2path(dir){
  assert.equal(dir[dir.length-1], '/', 'invalid dir '+dir);
  return dir.substr(0, dir.length-1);
}

function build_prev_sync_index(scroll){
  // XXX: need to have built-in index in scroll
  let prev_sync = {commit: new Map(), branch: new Map(), tag: new Map(),
    head: null};
  for (const [seq, decl] of scroll.dmap){
    let data = decl.fbuf_get(0).get_json(2), oid = data.git?.oid;
    if (data.rm){
      if (data.branch)
        prev_sync.branch.delete(data.branch, {seq});
      if (data.tag)
        prev_sync.tag.delete(data.tag, {seq});
      if (data.head)
        prev_sync.head = null;
      continue;
    }
    if (data.file || data.dir){
      assert(oid, 'missing oid for seq '+seq);
      if (!oid2seq.get(oid))
        oid2seq.set(oid, seq);
    }
    if (data.file)
      path2seq.set(data.file, seq);
    if (data.dir)
      path2seq.set(dir2path(data.dir), seq);
    if (data.commit){
      assert(!oid2seq.get(data.commit), 'multiple same commits seq'+seq);
      oid2seq.set(data.commit, seq);
      prev_sync.commit.set(data.commit, {seq});
    }
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
  if (state)
    return new FS_state(state);
  state = yield get_state(config, '', tree);
  seq2state.set(seq, new FS_state(state));
  return state;
});

const git_get_head = config=>etask(function*git_get_head(){
  // XXX: we call it to force getting origin refs into directory
  yield git_api.listServerRefs({...config, remote: 'origin'});
  let s, m;
  try {
    let file = config.dir+'/.git/refs/remotes/origin/HEAD';
    s = ''+(yield fs.promises.readFile(file));
  } catch(err){ return ''; }
  if (!s || !(m = s.match(/^ref: .*\/([^/]+)$/)))
    return '';
  return m[1].trim();
});

// XXX TODO
// synatx fixup:
// + head -> branch: 'HEAD'
// + file(dir) exact content links are without sub-link (point to first seq)
// + new file/dir/branch/tag: {add: true} // default (but optional)
// + rename del -> rm
// + link: 12 -> link: {_: 12}}
// - fix read from db - need proper api to parse links, content, diff
//
// initial sync:
// * fix javascript.vim (delete and friends highlight0
//   - send derry patch
// verify we {add: true} for root directory
// change to op: 'add'|'rm'|'mod'|'mv'|'commit'
// header: {key_val: ['dir', 'file', 'branch', 'tag'], op_default: 'mod'}
//   o handle dir <-> file (change type)
//     o BUG: isomorphic-git doesn't support it during pull
//   o detect move with changes
// * incermental sync - support update of existing scroll (need to use prev)
//   * pull and update of scroll with new commits
// - BUG - after branch delete, git pull will have an error
//   (coulnd' resolve...)
// - git api to scroll (export to git)
// - cleanup code
//   - add more tests (and move all repositories to lif-rnd from lif-zone)
//   - test diretory delete
//   - fix scroll api:
//     - get_scroll/put_scroll
//     - make api friendly to use (eg. get_json)
//     - make db api object oriented and support on demand loading
// - check how fork works
// - BUG: empty git repository sync will crash
// - private repositories (allow auth)
E.import_git = (config, scroll)=>etask(function*_start(){
  oid2seq = new Map();
  path2seq = new Map();
  seq2state = new Map();
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
      if (prev_sync.commit.get(oid))
        continue;
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
      let state_next = yield get_state(config, '', commit.tree);
      let seq_start = scroll.top.seq;
      prev = yield put_diff(config, scroll, prev, state_next);
      let info = pick_rename(commit,
        {message: 'desc', 'author.name': 'author'});
      info.ts = date_utc(commit.author.timestamp,
        commit.author.timezoneOffset);
      let group = scroll.top.seq-seq_start;
      let data = {commit: oid, ...info};
      data.git = merge ? {merge, ...commit} : {...commit};
      let decl = yield scroll.decl({prev, group}, data);
      oid2seq.set(oid, decl.seq);
      seq2state.set(decl.seq, new FS_state(state_next));
      prev = decl.seq;
    }
  }
  let head = yield git_get_head(config), head_seq;
  let branch_curr = {}, tag_curr = {};
  for (let i=0; i<branches.length; i++){
    let branch = branches[i];
    let oid = yield git_api.resolveRef({...config, ref: branch});
    let seq = oid2seq.get(oid), link = seq;
    branch_curr[branch] = {seq, oid};
    assert(seq, 'branch not found '+branch);
    let prev = prev_sync.branch.get(branch)?.seq, add = !prev;
    if (prev){
      let prev_d = yield scroll.get_decl(prev);
      if (prev_d.fbuf_get(0).get_json(2).git.oid==oid){
        if (head==branch)
          head_seq = prev;
        continue;
      }
    }
    let data = {branch};
    if (add)
      data.add = true;
    data.git = {oid};
    let decl = yield scroll.decl({prev, link}, data);
    if (head==branch)
      head_seq = decl.seq;
  }
  for (let i=0; i<tags.length; i++){
    let tag = tags[i];
    let oid = yield git_api.resolveRef({...config, ref: tag});
    let seq = oid2seq.get(oid), link = seq;
    tag_curr[tag] = {seq, oid};
    assert(seq, 'tag not found '+tag);
    let prev = prev_sync.tag.get(tag)?.seq, add = !prev;
    if (prev){
      let prev_d = yield scroll.get_decl(prev);
      if (prev_d.fbuf_get(0).get_json(2).git.oid==oid)
        continue;
    }
    let data = {tag};
    if (add)
      data.add = true;
    data.git = {oid};
    yield scroll.decl({prev, link}, data);
  }
  if (head_seq){
    let link = head_seq, same;
    let prev = prev_sync.branch.get('HEAD')?.seq, add = !prev;
    if (prev){
      let prev_d = yield scroll.get_decl(prev);
      // XXX: ugly code, need proper api
      same = prev_d.fbuf_get(0).get_json(1).link==link;
    }
    if (!same){
      let data = {branch: 'HEAD'};
      if (add)
        data.add = true;
      yield scroll.decl({prev, link}, data);
    }
    branch_curr.HEAD = {seq: head_seq};
  }
  for (const [branch, o] of prev_sync.branch){
    if (branch_curr[branch])
      continue;
    let prev = o.seq;
    yield scroll.decl({prev}, {branch, rm: true});
  }
  for (const [tag, o] of prev_sync.tag){
    if (tag_curr[tag])
      continue;
    let prev = o.seq;
    yield scroll.decl({prev}, {tag, rm: true});
  }
});

export default E;
