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
import Branch_table from '../storage/branch.js';
import buf_util from '../net/buf_util.js';
import git_api from 'isomorphic-git';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;
const {bseq_0} = Branch_table;

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
    let git_branches = yield git_api.listBranches(opt.gitdir ? config :
      {...config, remote: 'origin'});
    if (git_branches.includes('HEAD'))
      array.rm_elm(git_branches, 'HEAD');
    let main_br = yield _this._get_head_git_br(config);
    if (!main_br){
      main_br = git_branches.includes('main') ? 'main' :
        git_branches.includes('master') ? 'master' : '';
    }
    if (git_branches.includes(main_br)){
      array.rm_elm(git_branches, main_br);
      git_branches.unshift(main_br);
    }
    let cfid = 0; // XXX: support conflict
    let git_branches_map = {};
    for (let b=0; b<git_branches.length; b++){
      let git_br = git_branches[b];
      git_branches_map[git_br] = true;
    }
    let git_branches_curr = yield _this.get_git_branches(cfid);
    xerr.notice('XXX git_branches_curr %O', git_branches_curr);
    xerr.notice('XXX git_branches %O', git_branches);
    // delete branches
    for (let i=0; i<git_branches_curr.length; i++){
      let curr = git_branches_curr[i];
      if (git_branches_map[curr])
        continue;
      let prev = yield _this.get_git_br_top_seq(cfid, curr);
      yield _this.decl({cfid, prev}, {op: 'branch_del', git: {branch: curr}});
    }
    let logs = yield _this._get_git_log(config, git_branches);
    // add new commits to scroll
    for (let git_br in logs){
      let commits = logs[git_br];
      for (let i=0; i<commits.length; i++){
        // XXX: support multiple merge info and test it
        // XXX: save missing info
        // autohr, ts, tree, timestamp, timezoneOffset,
        // commit, gpgsig
        let {oid, commit} = commits[i], prev, [parent, merge] = commit.parent;
        let seq = yield _this.find_one(oid, {dir: 'up', name: 'git_oid',
          cfid});
        if (seq)
          continue;
        if (parent){
          // XXX: need smarter logic, current logic depends on order of
          // branches
          prev = yield _this.find_one(parent, {dir: 'up',
            name: 'git_oid', cfid});
          if (!prev)
            throw new Error('parent commit was not found '+parent);
        }
        // XXX: we might need to use new branch name in some cases (test it)
        // XXX: review logic for main_br
        if (git_br!=main_br && !(yield _this.git_br_exists(cfid, git_br)))
          prev = yield _this._new_set_branch(cfid, prev, git_br, parent);
        else if (git_br!=main_br) // XXX: check logic for main_br
          prev = yield _this.get_git_br_top_seq(cfid, git_br);
        let prev_top_oid = yield _this.get_git_br_top_oid(cfid, git_br);
        if (prev_top_oid && prev_top_oid!=parent)
          throw new Error('git corruption '+git_br);
        let group = yield _this._sync_dir(config, cfid, prev,
          '/', commit.tree, '0'); // XXX: can root mode be different?
        // XXX: check behavir with empty commits (need to use prev)
        let body = {op: 'commit', desc: commit.message, git: {oid}};
        if (merge)
          body.git.merge = merge;
        yield _this.decl({cfid, group}, body);
      }
      // add branches that were not added before (no commit after branch oid)
      if (git_br!=main_br && commits.length){
        let top_oid = yield _this.get_git_br_top_oid(cfid, git_br);
        let oid = commits[commits.length-1].oid;
        if (top_oid){
          if (top_oid!=oid)
            throw new Error('XXX TODO '+git_br); // XXX TODO
          continue;
        }
        let prev = yield _this.find_one(oid, {dir: 'up', name: 'git_oid',
          cfid});
        if (!prev)
          throw new Error('top commit not found '+oid);
        yield _this._new_set_branch(cfid, prev, git_br, oid);
      }
    }
  }); }
  _get_git_log(config, git_branches){
    return etask({_: this}, function*_get_git_log()
  {
    let ret = {};
    // add new commits to scroll
    for (let b=0; b<git_branches.length; b++){
      let git_br = git_branches[b];
      yield git_api.checkout(config.gitdir ? {...config, ref: git_br} :
        {...config, ref: git_br, remote: 'origin'});
      if (config.url)
        yield git_api.fetch({...config});
      // XXX: use since from last sync
      let log = yield git_api.log({...config, ref: git_br});
      let commits = [];
      for (let i=0, parent; i<log.length; i++){
        let curr = log[i];
        if (parent && curr.oid!=parent) // skip merge side branch
          continue;
        commits.unshift(curr);
        parent = curr.commit.parent[0];
      }
      ret[git_br] = commits;
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
    // XXX: need to get current branch
    let top_seq = _this.conflict.get(cfid).top.seq;
    let top_bseq = _this.bseq_get(cfid, top_seq);
    if (prev)
      [top_seq, top_bseq] = [prev, _this.bseq_get(cfid, prev)];
    let iter = yield _this.ls_iter(cfid, top_bseq, top_seq, dir);
    for (; iter.curr; yield iter.next()){
      if (dir_list[iter.curr])
        continue;
      // XXX: fix rm so prev is used only once
      n += yield _this.rm(iter.curr, {cfid, prev});
      prev = undefined;
    }
    for (let i=0, e; e = tree[i]; i++){
      let file, _dir, body, top, prev_seq, blob, link;
      switch (e.type){
      case 'blob':
        file = dir+e.path;
        dir_list[file] = true;
        // XXX: need to get current branch
        top = _this.conflict.get(cfid).top.seq;
        if (top){
          prev_seq = yield _this.get_file_seq(cfid,
            _this.bseq_get(cfid, top), top, file);
        } else if (prev){
          prev_seq = yield _this.get_file_seq(cfid, _this.bseq_get(cfid, prev),
            prev, file);
        }
        if (prev_seq){
          let prev_decl = _this.get_decl(prev_seq);
          yield prev_decl.load(cfid);
          if (prev_decl.get_body(cfid)?.git?.oid==e.oid)
            break;
        }
        body = {git: {oid: e.oid, mode: e.mode}};
        blob = (yield git_api.readBlob({...config, oid: e.oid})).blob;
        blob = blob ? Buffer.from(blob) : null;
        link = yield _this.find_one(e.oid, {dir: 'up', name: 'git_oid',
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
  get_git_branch(cfid, seq){ return etask({_: this}, function*get_git_branch(){
    let _this = this._;
    let bseq = _this.bseq_get(cfid, seq), bseqb0 = bseq_0(bseq);
    if (bseqb0=='0')
      return null;
    let seq_b = _this.bseq_to_seq(cfid, bseqb0);
    let decl = _this.get_decl(seq_b);
    yield decl.load(cfid);
    let header = decl.get_header(cfid);
    assert(header.branch, 'missing branch for '+bseqb0);
    return header.branch;
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
  get_git_branches(cfid){ return etask({_: this}, function*get_git_branches(){
    let _this = this._;
    let index = _this.index_table?.get_index(cfid, null, 'git_br_all');
    if (!index)
      return [];
    // XXX HACK: need to find a proper way to do it
    let a = [...index.avl.keys()].reverse(), done = {}, ret = [];
    for (let i=0; i<a.length; i++){
      let git_br = a[i].key, seq = yield _this.get_git_br_seq(cfid, git_br);
      done[git_br] = true;
      if (!seq)
        continue;
      ret.push(git_br);
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
      decl = yield _this.decl({cfid, branch: git_br, prev}, {op: 'branch_new',
        git: {oid}});
    }
    return decl.seq;
  }); }
}

GIT.create = (opt, d)=>etask(function*scroll_create(){
  assert(d.src, 'missing git src');
  let git = new GIT(opt);
  yield git.init();
  // XXX: reuse code from FS.create and call FS.create
  let s = {crypt: Scroll.supported_crypt[0], pub: b2s(opt.pub), ...d,
    csum_sha1: true, index: ['file', 'dir', {name: 'dir_list',
    transform: 'decl_get_dir', filter: {op: ['add', 'rm']}},
    {name: 'git_oid', field: 'git.oid', all_branches: true},
    // XXX: review git_br_curr with derry - better way?
    {name: 'git_br_curr', transform: 'git_br_curr'},
    {name: 'git_br_all', transform: 'git_br', all_branches: true}]};
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

