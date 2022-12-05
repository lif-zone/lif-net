// author: derry. coder: arik.
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
import array from '../util/array.js';
import xutil from '../util/util.js';
import Scroll from '../storage/scroll.js';
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

const build_state = (config, dir, oid, mode, state)=>
  etask(function*_put_tree(){
  mode = mode||0;
  let {tree} = yield git_api.readTree({...config, oid});
  let next = {type: 'dir', path: dir, oid, mode};
  state = state||new FS_state(null, {write: true});
  state.set(dir, next);
  for (let i=0; i<tree.length; i++){
    let e = tree[i], path = dir+'/'+e.path;
    switch (e.type){
    case 'blob':
      next = {path, oid: e.oid, mode: e.mode};
      state.set(path, next);
      break;
    case 'tree':
      yield build_state(config, path, e.oid, e.mode, state);
      break;
    default: xerr.xexit('unknown type '+e.type);
    }
  }
  return state;
});

class FS_state {
  constructor(state, opt={}){
    this.path = new Map(state?.path);
    this.oid = new Map(state?.oid);
    this.read_only = !opt.write;
  }
  get(path){ return this.path.get(path); }
  get_oid(oid){ return this.oid.get(oid); }
  set(path, o){
    assert(!this.read_only, 'read only state');
    assert(o.oid && path==o.path, 'invalid state entry');
    this.oid.set(o.oid, o);
    return this.path.set(path, o);
  }
  delete(o){
    assert(!this.read_only, 'read only state');
    this.path.delete(o.oid);
    this.path.delete(o.path);
  }
  delete_path(path){
    assert(!this.read_only, 'read only state');
    return this.path.delete(path);
  }
}

// XXX: how to detect file move (exact move, move+modifications)
// eg commit 17: https://github.com/lif-zone/server/commit/e24039a1b371f9f05ce53829e9c6bc3ad675fa53?diff=split
// XXX: what about directory move. need to optimize and not remove/readd all
const put_diff = (config, scroll, prev, state_next)=>etask(
  function*_put_diff(){
  let state_curr = prev ? yield get_state_seq(config, scroll, prev) :
    new FS_state();
  let state_del = new FS_state(state_curr, {write: true});
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
      let data = curr.type=='dir' ? {op: 'rm', dir: path+'/'} :
        {op: 'rm', file: path};
      yield scroll.decl({prev}, data);
      prev = curr = prev_oid = null;
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
      if (!curr && prev_oid && prev_oid.path!=path &&
        !path.startsWith(prev_oid.path) && !state_next.get(prev_oid.path)){
        move = prev_oid.path+'/';
        move_dir.push(path+'/');
        state_del.delete(prev_oid);
      }
      let op = move ? 'mv' : add ? 'add' : 'mod';
      let data = {op, dir: path+'/'};
      if (move)
        data.src = move;
      data.git = git;
      decl = yield scroll.decl({prev}, data);
      prev = null;
    } else {
      if (!curr && prev_oid && prev_oid.path!=path &&
        !state_next.get(prev_oid.path)){
        move = prev_oid.path;
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
      let op = move ? 'mv' : add ? 'add' : 'mod';
      let data = [{op, file: path}];
      if (move)
        data[0].src = move;
      if (content)
        data[0].content = content;
      if (diff)
        data[0].diff = diff;
      data[0].git = git;
      if (blob)
        data.push(blob);
      decl = yield scroll.decl({prev, link}, data);
      prev = null;
    }
    if (decl){
      if (!oid2seq.get(next.oid))
        oid2seq.set(next.oid, decl.seq);
      path2seq.set(path, decl.seq);
    }
  }
  for (const [path, curr] of state_del.path){
    let data = curr.type=='dir' ? {op: 'rm', dir: path+'/'} :
      {op: 'rm', file: path};
    yield scroll.decl({prev}, data);
    prev = null;
  }
  return prev || scroll.top.seq;
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
  let lif_branch = new Map();
  for (const [seq, decl] of scroll.dmap){
    // XXX: need api to get header/data part of frames
    let header = decl.fbuf_get(0).get_json(1);
    let data = decl.fbuf_get(0).get_json(2), oid = data.git?.oid;
    if (header.branch){
      assert(!lif_branch.get(header.branch),
        'duplicated branch split '+header.branch);
      lif_branch.set(header.branch, {split: seq});
    }
    if (data.op=='rm'){
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
    if (data.op=='commit'){
      assert(!oid2seq.get(data.git.oid), 'multiple same commits seq'+seq);
      oid2seq.set(data.git.oid, seq);
      prev_sync.commit.set(data.git.oid, {seq});
    }
    if (data.branch)
      prev_sync.branch.set(data.branch, {seq});
    if (data.tag)
      prev_sync.tag.set(data.tag, {seq});
    if (data.head)
      prev_sync.head = {seq};
  }
  return {prev_sync, lif_branch};
}

const get_state_seq = (config, scroll, seq)=>etask(function*get_state_seq(){
  let tree = scroll.get_decl(seq).fbuf_get(0).get_json(2).git.tree;
  assert(tree, 'no tree for seq'+seq);
  let state = seq2state.get(seq);
  if (state)
    return state;
  state = yield build_state(config, '', tree);
  seq2state.set(seq, state);
  state.read_only = true;
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

function build_branch_split_map(commits, branch_commit){
  let real_branches = {};
  for (const branch in branch_commit){
    let head = branch_commit[branch].head;
    if (real_branches[head]?.head==head){
      real_branches[head].dup = real_branches[head].dup||{};
      real_branches[head].dup.push(branch);
      continue;
    }
    real_branches[head] = {branch, head, dup: []};
    for (let curr=commits.get(head); curr;
      curr = commits.get(curr.commit.parent[0]))
    {
      curr.branch = curr.branch||[];
      curr.branch.push(branch);
    }
  }
  for (let head in real_branches){
    let branch = real_branches[head].branch;
    for (let curr=commits.get(head), prev; curr;
      prev = curr, curr = commits.get(curr.commit.parent[0]))
    {
      // XXX: need to handle case where default branch is not main any more
      // (in that situation, the parent of main is null and need to split
      // on other branch)
      if (curr.branch[0]!=branch){
        real_branches[head].split = prev.oid;
        break;
      }
    }
  }
  let ret = {real_branches, split: {}};
  for (let head in real_branches){
    let curr = real_branches[head];
    ret.split[curr.split] = curr;
  }
  return ret;
}

function fix_lif_name(lif_branch, branch){
  if (!branch)
    return;
  let name = branch;
  for (let i=1; lif_branch.get(name); i++, name = branch+'_lif'+i);
  return name;
}

// XXX TODO
// initial sync:
// * fix javascript.vim (delete and friends highlight0
//   - send derry patch
// + verify we {add: true} for root directory
// + header: {key_val: ['dir', 'file', 'branch', 'tag'], op_default: 'mod'}
// * change to op: 'add'|'rm'|'mod'|'mv'|'commit'
// - move commit to be before files
// - {branch: 'b'} on the {seq, prev} frame
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
  let {prev_sync, lif_branch} = build_prev_sync_index(scroll);
  array.rm_elm(branches, 'HEAD');
  array.rm_elm(branches, 'main'); // XXX: do it on HEAD branch
  branches.unshift('main');
  let branch_commit = {}, all_commit = new Map;
  for (let b=0; b<branches.length; b++){
    let branch = branches[b];
    assert(!branch_commit[branch], 'branch already exist '+branch);
    yield git_api.checkout({...config, ref: branch, remote: 'origin'});
    yield git_api.pull({...config});
    let head = yield git_api.resolveRef({...config, ref: branch});
    let curr = branch_commit[branch] = {head, commit: new Map()};
    // XXX: optimize, read only from last prev_sync commit
    let commits = yield git_api.log({...config, ref: branch});
    commits.reverse();
    for (let i=0; i<commits.length; i++){
      let oid = commits[i].oid, commit = prev_sync.commit.get(oid);
      if (commit){
        let o = all_commit.get(oid)||{oid, commit: commits[i].commit};
        curr.commit.set(oid, o);
        all_commit.set(oid, o);
        continue;
      }
      commit = commits[i].commit;
      let state = yield build_state(config, '', commit.tree);
      curr.commit.set(oid, {oid, commit, state});
      all_commit.set(oid, {oid, commit});
    }
  }
  let split_map = build_branch_split_map(all_commit, branch_commit);
  for (let branch in branch_commit){
    let curr = branch_commit[branch];
    for (const [oid, o] of curr.commit){
      let commit = o.commit, prev, merge;
      if (!o.state) // ie, prev_sync
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
      let state = o.state;
      assert(state, 'missing state for new commit');
      let seq_start = scroll.top.seq;
      prev = yield put_diff(config, scroll, prev, state);
      let info = pick_rename(commit,
        {message: 'desc', 'author.name': 'author'});
      info.ts = date_utc(commit.author.timestamp,
        commit.author.timezoneOffset);
      let group = scroll.top.seq-seq_start;
      let data = {op: 'commit', ...info};
      data.git = merge ? {oid, merge, ...commit} : {oid, ...commit};
      let lbranch = fix_lif_name(lif_branch, split_map.split[oid]?.branch);
      let decl = yield scroll.decl({prev, group, branch: lbranch}, data);
      if (lbranch && !lif_branch[lbranch])
        lif_branch[lbranch] = {split: decl.seq};
      oid2seq.set(oid, decl.seq);
      seq2state.set(decl.seq, state);
      state.read_only = true;
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
      // XXX: need to properly parse link
      if (prev_d.fbuf_get(0).get_json(1).link==seq){
        if (head==branch)
          head_seq = prev;
        continue;
      }
    }
    let op = add ? 'add' : 'mod';
    let data = {op, branch};
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
      // XXX: need to properly parse link
      if (prev_d.fbuf_get(0).get_json(1).link==seq)
        continue;
    }
    let op = add ? 'add' : 'mod';
    let data = {op, tag};
    yield scroll.decl({prev, link}, data);
  }
  if (head_seq){
    let link = head_seq, same;
    let prev = prev_sync.branch.get('HEAD')?.seq, add = !prev;
    if (prev){
      let prev_d = yield scroll.get_decl(prev);
      // XXX: need to properly parse link
      same = prev_d.fbuf_get(0).get_json(1).link==link;
    }
    if (!same){
      let op = add ? 'add' : 'mod';
      let data = {op, branch: 'HEAD'};
      yield scroll.decl({prev, link}, data);
    }
    branch_curr.HEAD = {seq: head_seq};
  }
  for (const [branch, o] of prev_sync.branch){
    if (branch_curr[branch])
      continue;
    let prev = o.seq;
    yield scroll.decl({prev}, {op: 'rm', branch});
  }
  for (const [tag, o] of prev_sync.tag){
    if (tag_curr[tag])
      continue;
    let prev = o.seq;
    yield scroll.decl({prev}, {op: 'rm', tag});
  }
});

E.new_scroll = function(keypair, src){
  return Scroll.create({...keypair}, {topic: 'git', src,
    key_val: ['dir', 'file', 'branch', 'tag'], op_default: 'mod'});
};

export default E;
