// author: derry. coder: arik.
import assert from 'assert';
import fs from 'fs';
import http from 'isomorphic-git/http/node/index.cjs';
import array from '../util/array.js';
import xerr from '../util/xerr.js';
import FS from './fs.js';
import util from '../util/util.js';
import etask from '../util/etask.js';
import Scroll from '../storage/scroll.js';
import buf_util from '../net/buf_util.js';
import git_api from 'isomorphic-git';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;

// XXX: need test + mv to generic place + need proper escape
function escape_fs(s){ return s.replaceAll('/', '_').replaceAll(':', '_'); }

export default class GIT extends FS {
  constructor(opt){
    super(opt);
    this.cache = {};
  }
  sync(opt={}){ return etask({_: this}, function*sync(){
    // XXX: need lock
    let _this = this._;
    let body = _this.get_decl(0).get_body(0);
    if (!body)
      throw new Error('missing seq0 body');
    let url = opt.url||body.scroll?.src;
    if (!url)
      throw new Error('missing git src');
    let config = {fs, http, cache: _this.cache};
    // XXX: decide how to create valid dir
    config.dir = opt.dir||'/tmp/lif_git_'+escape_fs(url);
    if (opt.gitdir){
      config.gitdir = opt.gitdir;
      yield git_api.init({...config});
    } else {
      config.url = url;
      yield git_api.clone({...config});
    }
    let cfid = 0; // XXX: support conflict
    let git_data = yield _this._get_git(config);
    let main = git_data.main;
    let curr_git_branches = yield _this.get_git_branches(cfid);
    // delete branches
    for (let i=0; i<curr_git_branches.length; i++){
      let curr = curr_git_branches[i];
      if (git_data.branch[curr]){
        let prev_top_oid = yield _this.get_git_br_top_oid(cfid, curr);
        if (!prev_top_oid || git_data.branch[curr].map[prev_top_oid])
          continue;
      }
      let prev = yield _this.get_git_br_top_seq(cfid, curr);
      yield _this.decl({cfid, prev}, {op: 'branch_del', git: {branch: curr}});
    }
    // add new commits
    let merge_queue = {};
    for (let git_br in git_data.branch){
      let commits = git_data.branch[git_br].commits;
      yield _this._sync_commits(config, cfid, main, git_br, commits,
        merge_queue);
      // add branches that were not added before (no commit after branch oid)
      if (git_br!=main && commits.length){
        let top_oid = yield _this.get_git_br_top_oid(cfid, git_br);
        let oid = commits[commits.length-1].oid;
        if (top_oid){
          if (top_oid!=oid)
            throw new Error('XXX TODO '+git_br); // XXX TODO
          continue;
        }
        let prev = yield _this.find_one(oid, {dir: 'up', name: 'git_oid_all',
          cfid});
        if (!prev)
          throw new Error('top commit not found '+oid);
        yield _this._new_set_branch(cfid, prev, git_br, oid);
      }
    }
    // add oids that were merge but belong to a delete branch
    for (let oid in merge_queue){
      let git_br = merge_queue[oid];
      let seq = yield _this.find_one(oid, {dir: 'up', name: 'git_oid_all',
          cfid});
      if (seq)
        continue;
      let commits = [];
      while (oid){
        let commit = git_data.branch[git_br].map[oid];
        if (!commit)
          throw new Error('commit not found for '+oid);
        commits.unshift(commit);
        // XXX: copy logic of parent from _get_git
        oid = commit.commit.parent[0];
      }
      // XXX TODO: support branch without name
      let branch = _this.get_avail_branch(cfid, '_null');
      yield _this._sync_commits(config, cfid, main, branch, commits,
        merge_queue);
    }
    yield _this._sync_tags(config, cfid, git_data.tag);
  }); }
  _sync_commits(config, cfid, main, git_br, commits, merge_queue){
    return etask({_: this}, function*_sync_commits()
  {
    let _this = this._;
    for (let i=0; i<commits.length; i++){
      // XXX: support multiple merge info and test it
      // XXX: save missing info
      // autohr, ts, tree, timestamp, timezoneOffset,
      // commit, gpgsig
      let {oid, commit} = commits[i], prev, [parent, merge] = commit.parent;
      // XXX: check logic for main
      if (git_br==main || (yield _this.git_br_exists(cfid, git_br))){
        // XXX: support get_git_br_top_seq for main and fix all code
        let br_seq = git_br==main ? _this.get_branch_top(cfid, null).seq :
          yield _this.get_git_br_top_seq(cfid, git_br);
        let seq = yield _this.find_one(oid, {cfid, name: 'git_oid',
          bseq: _this.bseq_get(cfid, br_seq)});
        if (seq)
          continue;
        if (parent){
          prev = yield _this.find_one(parent, {cfid, name: 'git_oid',
            bseq: _this.bseq_get(cfid, br_seq)});
          if (!prev)
            throw new Error('parent commit was not found '+parent);
        }
      } else {
        let seq = yield _this.find_one(oid, {dir: 'up', name: 'git_oid_all',
          cfid});
        if (seq)
          continue;
        if (parent){
          prev = yield _this.find_one(parent, {dir: 'up',
            name: 'git_oid_all', cfid});
          if (!prev)
            throw new Error('parent commit was not found '+parent);
        }
      }
      // XXX: review logic for main
      if (git_br!=main && !(yield _this.git_br_exists(cfid, git_br)))
        prev = yield _this._new_set_branch(cfid, prev, git_br, parent);
      else if (git_br!=main) // XXX: check logic for main
        prev = yield _this.get_git_br_top_seq(cfid, git_br);
      let prev_top_oid = yield _this.get_git_br_top_oid(cfid, git_br);
      if (prev_top_oid && prev_top_oid!=parent)
        throw new Error('git corruption '+git_br);
      let group = yield _this._sync_dir(config, cfid, prev,
        '/', commit.tree, '0'); // XXX: can root mode be different?
      // XXX: check behavir with empty commits (need to use prev)
      let body = {op: 'commit', desc: commit.message, git: {oid}};
      if (merge){
        merge_queue[merge] = git_br;
        body.git.merge = merge;
      }
      delete merge_queue[oid];
      yield _this.decl(group ? {cfid, group} : {cfid, prev}, body);
    }
  }); }
  _sync_tags(config, cfid, tags){ return etask({_: this}, function*_sync_tags()
  {
    let _this = this._;
    let curr_tags = yield _this.get_git_tags(cfid);
    // delete tag
    for (let i=0; i<curr_tags.length; i++){
      let tag = curr_tags[i];
      if (tags[tag])
        continue;
      yield _this.decl({cfid, branch: null}, {op: 'tag_del', name: tag});
    }
    for (let tag in tags){
      let oid = tags[tag], link;
      let oid2 = yield _this.get_git_tag_oid(cfid, tag);
      if (oid2===oid)
        continue;
      link = yield _this.find_one(oid, {dir: 'up', name: 'git_oid_all', cfid});
      yield _this.decl({cfid, branch: null, link}, {op: 'tag_set', name: tag,
        git: {oid}});
    }
  }); }
  _get_git(config){ return etask({_: this}, function*_get_git()
  {
    // XXX: detect branch didn't change and make sure we don't work on it
    let _this = this._;
    let git_branches = yield git_api.listBranches(config.gitdir ? config :
      {...config, remote: 'origin'});
    if (git_branches.includes('HEAD'))
      array.rm_elm(git_branches, 'HEAD');
    let main = yield _this._get_head_git_br(config);
    if (!main){
      main = git_branches.includes('main') ? 'main' :
        git_branches.includes('master') ? 'master' : '';
    }
    if (git_branches.includes(main)){
      array.rm_elm(git_branches, main);
      git_branches.unshift(main);
    }
    let ret = {main: main, branch: {}, tag: {}};
    // add new commits to scroll
    for (let b=0; b<git_branches.length; b++){
      let git_br = git_branches[b];
      yield git_api.checkout(config.gitdir ? {...config, ref: git_br} :
        {...config, ref: git_br, remote: 'origin'});
      if (config.url)
        yield git_api.fetch({...config});
      // XXX: use since from last sync
      let log = yield git_api.log({...config, ref: git_br});
      let commits = [], map = {};
      for (let i=0, parent; i<log.length && (!i||parent); i++){
        let curr = log[i];
        if (parent && curr.oid!=parent) // skip merge side branch
          continue;
        commits.unshift(curr);
        parent = curr.commit.parent[0];
      }
      for (let i=0; i<log.length; i++){
        let curr = log[i];
        map[curr.oid] = curr;
      }
      ret.branch[git_br] = {commits, map, log};
    }
    let tags = yield git_api.listTags(config.gitdir ? config :
      {...config, remote: 'origin'});
    for (let i=0; i<tags.length; i++){
      let tag = tags[i];
      let oid = yield git_api.resolveRef({...config, ref: tag});
      ret.tag[tag] = oid;
    }
    return ret;
  }); }
  _sync_dir(config, cfid, prev, dir, oid, mode){
    return etask({_: this}, function*_sync_dir()
  {
    let _this = this._, n = 0;
    // XXX: eraly return if if dir oid did not changed
    if (!(yield _this.dir_exists(dir, {cfid, prev}))){
      yield _this.add_dir(dir, {cfid, prev, body: {git: {mode}}});
      n++;
      prev = undefined;
    }
    let {tree} = yield git_api.readTree({...config, oid});
    let dir_list = {};
    for (let i=0, e; e = tree[i]; i++)
      dir_list[e.type=='blob' ? dir+e.path : dir+e.path+'/'] = true;
    let top = prev ? prev : _this.conflict.get(cfid).top.seq;
    let iter = yield _this.ls_iter(cfid, _this.bseq_get(cfid, top), top, dir);
    for (; iter.curr; yield iter.next()){
      if (dir_list[iter.curr])
        continue;
      // XXX: fix rm so prev is used only once
      n += yield _this.rm(iter.curr, {cfid, prev});
      prev = undefined;
    }
    for (let i=0, e; e = tree[i]; i++){
      let file, _dir, body, prev_seq, blob, link;
      switch (e.type){
      case 'blob':
        file = dir+e.path;
        dir_list[file] = true;
        top = prev ? prev : _this.conflict.get(cfid).top.seq;
        prev_seq = yield _this.get_file_seq(cfid, _this.bseq_get(cfid, top),
          top, file);
        if (prev_seq){
          let prev_decl = _this.get_decl(prev_seq);
          yield prev_decl.load(cfid);
          if (prev_decl.get_body(cfid)?.git?.oid==e.oid)
            break;
        }
        body = {git: {oid: e.oid, mode: e.mode}};
        blob = (yield git_api.readBlob({...config, oid: e.oid})).blob;
        blob = blob ? Buffer.from(blob) : null;
        link = yield _this.find_one(e.oid, {dir: 'up', name: 'git_oid_all',
          cfid});
        if (yield _this.file_exists(file, {cfid, prev}))
          yield _this.mod_file(file, blob, {cfid, prev, link, body});
        else
          yield _this.add_file(file, blob, {cfid, prev, link, body});
        n++;
        prev = undefined;
        break;
      case 'tree':
        _dir = dir+e.path+'/',
        dir_list[_dir] = true;
        n += yield _this._sync_dir(config, cfid, prev, _dir, e.oid, e.mode);
        prev = undefined;
        break;
      default: throw new Error('unknown type '+e.type);
      }
    }
    return n;
  }); }
  _get_head_git_br(config){ return etask(function*_get_head_git_br(){
  // XXX: we call it to force getting origin refs into directory
  if (!config.gitdir)
    yield git_api.listServerRefs({...config, remote: 'origin'});
  let s, m;
  try {
    let file = config.dir+'/.git/refs/remotes/origin/HEAD';
    s = ''+(yield fs.promises.readFile(file));
  } catch(err){ return ''; }
  if (!s || !(m = s.match(/^ref: .*\/([^/]+)$/)))
    return '';
  return m[1].trim();
  }); }
  get_git_br_top_oid(cfid, git_br){ return etask({_: this},
    function*get_git_br_top_oid()
  {
    let _this = this._;
    let top_seq = yield _this.get_git_br_top_seq(cfid, git_br);
    if (!top_seq)
      return;
    let decl = _this.get_decl(top_seq);
    yield decl.load(cfid); // XXX: review all load, try to mv t index data
    return decl.get_body(cfid)?.git?.oid;
  }); }
  get_git_br_top_seq(cfid, git_br){ return etask({_: this},
    function*get_git_br_top_seq()
  {
    let _this = this._, seq = yield _this.get_git_br_seq(cfid, git_br);
    if (!seq)
      return;
    let bseq_top = _this.get_bseq_top(cfid, _this.bseq_get(cfid, seq));
    return bseq_top.seq;
  }); }
  git_br_exists(cfid, git_br){ return etask({_: this}, function*git_br_exists()
  {
    return !!(yield this._.get_git_br_seq(cfid, git_br));
  }); }
  get_git_br_seq(cfid, git_br){ return etask({_: this},
    function*get_git_br_seq()
  {
    let _this = this._;
    let seq = yield _this.find_one(git_br, {cfid, name: 'git_br_all'});
    if (!seq)
      return false;
    let decl = _this.get_decl(seq);
    yield decl.load(cfid); // XXX: avoid load and just use index extra data
    let body = decl.get_body(cfid);
    return body.op!='branch_del' ? seq : false;
  }); }
  git_tag_exists(cfid, tag){ return etask({_: this}, function*git_tag_exists(){
    return !!(yield this._.get_git_tag_seq(cfid, tag));
  }); }
  get_git_tag_seq(cfid, tag){ return etask({_: this},
    function*get_git_tag_seq()
  {
    let _this = this._;
    let seq = yield _this.find_one(tag, {cfid, name: 'git_tag_all'});
    if (!seq)
      return false;
    let decl = _this.get_decl(seq);
    yield decl.load(cfid); // XXX: avoid load and just use index extra data
    let body = decl.get_body(cfid);
    return body.op!='tag_del' ? seq : undefined;
  }); }
  get_git_tag_oid(cfid, tag){ return etask({_: this},
      function*get_git_tag_oid()
  {
    let _this = this._;
    let seq = yield _this.find_one(tag, {cfid, name: 'git_tag_all'});
    if (!seq)
      return false;
    let decl = _this.get_decl(seq);
    yield decl.load(cfid); // XXX: avoid load and just use index extra data
    let body = decl.get_body(cfid);
    return body.op!='tag_del' ? body.git?.oid : undefined;
  }); }
  get_git_branches(cfid){ return etask({_: this}, function*get_git_branches(){
    let _this = this._;
    let index = _this.index_table?.get_index(cfid, null, 'git_br_all');
    if (!index)
      return [];
    // XXX HACK: need to find a proper way to do it
    let a = [...index.avl.keys()].reverse(), done = {}, ret = [];
    for (let i=0; i<a.length; i++){
      let git_br = a[i].key;
      if (done[git_br])
        continue;
      let seq = yield _this.get_git_br_seq(cfid, git_br);
      done[git_br] = true;
      if (!seq)
        continue;
      ret.push(git_br);
    }
    return ret;
  }); }
  get_git_tags(cfid){ return etask({_: this}, function*get_git_tags(){
    let _this = this._;
    let index = _this.index_table?.get_index(cfid, null, 'git_tag_all');
    if (!index)
      return [];
    // XXX HACK: need to find a proper way to do it
    let a = [...index.avl.keys()].reverse(), done = {}, ret = [];
    for (let i=0; i<a.length; i++){
      let tag = a[i].key;
      if (done[tag])
        continue;
      let seq = yield _this.get_git_tag_seq(cfid, tag);
      done[tag] = true;
      if (!seq)
        continue;
      ret.push(tag);
    }
    return ret;
  }); }
  _new_set_branch(cfid, prev, git_br, oid){ return etask({_: this},
    function*_new_set_branch()
  {
    let _this = this._;
    let prev_bseq_top = _this.get_bseq_top(cfid, _this.bseq_get(cfid, prev));
    let op, decl, br_seq = yield _this.find_one('git_br', {cfid,
      bseq: prev_bseq_top.bseq, name: 'git_br_curr'});
    if (br_seq){
      decl = _this.get_decl(br_seq);
      yield decl.load(cfid); // XXX: avoid load. get it from index data
      op = decl.get_body(cfid)?.op;
      if (op=='branch_del')
        prev = prev_bseq_top.seq;
    }
    if (op=='branch_del'){
      decl = yield _this.decl({cfid, prev}, {op: 'branch_set',
        git: {oid, branch: git_br}});
    } else {
      // XXX: need to make sure banch is unique
      let branch = _this.get_avail_branch(cfid, git_br);
      decl = yield _this.decl({cfid, branch, prev}, {op: 'branch_new',
        git: branch==git_br ? {oid} : {oid, branch: git_br}});
    }
    return decl.seq;
  }); }
  get_avail_branch(cfid, br){
    let b=br;
    for (let i=2; this.branch_exists(cfid, b); b = br+' '+i, i++);
    return b;
  }
}

GIT.create = (opt, d)=>etask(function*scroll_create(){
  assert(d.src, 'missing git src');
  let git = new GIT(opt);
  yield git.init();
  // XXX: reuse code from FS.create and call FS.create
  let s = {crypt: Scroll.supported_crypt[0], pub: b2s(opt.pub), ...d,
    csum_sha1: true, index: ['file', 'dir', {name: 'dir_list',
    transform: 'decl_get_dir', filter: {op: ['add', 'rm']}},
    {name: 'git_oid', field: 'git.oid',
      filter: {op: ['commit', 'add', 'mod']}},
    {name: 'git_oid_all', field: 'git.oid', all_branches: true,
      filter: {op: ['commit', 'add', 'mod']}},
    // XXX: review git_br_curr with derry - better way?
    {name: 'git_br_curr', transform: 'git_br_curr'},
    {name: 'git_br_all', transform: 'git_br', all_branches: true},
    {name: 'git_tag_all', field: 'name', all_branches: true,
      filter: {op: ['tag_set', 'tag_del']}},
    ]};
  if (d?.csum_sha256) // XXX: needed?
    s.index.push('csum_sha256');
  yield git.decl({scroll: s});
  return git;
});

GIT.open = opt=>etask(function*scroll_open(){
  assert(util.is_mocha()||!opt.soul, 'producion must use global soul');
  let seq, h;
  if (typeof opt.M=='string')
    [seq, h] = [0, s2b(opt.M)];
  else // XXX: support Uint8Array
    [seq, h] = Buffer.isBuffer(opt.M) ? [0, opt.M] : [opt.M.seq, opt.M.h];
  assert.strictEqual(seq, 0, 'must provide M0');
  assert(/^\d+$/.test(seq) && h, 'scroll.open missing M');
  let soul = opt.soul||Scroll.soul, git = seq==0 && soul.get(h);
  if (git)
    return git;
  git = new GIT(opt);
  yield git.init({M: h, seq});
  return git;
});

