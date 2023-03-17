// author: derry. coder: arik.
import assert from 'assert';
import fs from 'fs';
import http from 'isomorphic-git/http/node/index.cjs';
import array from '../util/array.js';
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
    let config = {fs, http, cache: _this.cache, url};
    // XXX: decide how to create valid dir
    config.dir = opt.dir||'/tmp/lif_git_'+escape_fs(url);
    if (opt.gitdir){
      config.gitdir = opt.gitdir;
      yield git_api.init({...config});
    } else
      yield git_api.clone({...config});
    let git_branches = yield git_api.listBranches({...config,
      remote: 'origin'});
    if (git_branches.includes('HEAD'))
      array.rm_elm(git_branches, 'HEAD');
    if (git_branches.includes('main')){
      array.rm_elm(git_branches, 'main'); // XXX: do it on HEAD git_br
      git_branches.unshift('main');
    }
    // XXX: we assume main is the main branch. need to get it from HEAD
    for (let b=0; b<git_branches.length; b++){
      let git_br = git_branches[b];
      yield git_api.checkout({...config, ref: git_br, remote: 'origin'});
      yield git_api.fetch({...config});
      let head = yield git_api.resolveRef({...config, ref: git_br});
      // XXX: use since from last sync
      let log = yield git_api.log({...config, ref: git_br});
      let commits = [];
      for (let i=0, parent; i<log.length; i++){
        let curr = log[i];
        if (parent && curr.oid!=parent)
          continue;
        commits.unshift(curr);
        parent = curr.commit.parent[0];
        // XXX: save missing info
        // autohr, ts, tree, timestamp, timezoneOffset,
        // commit, gpgsig
      }
      let cfid = 0; // XXX: support conflict
      for (let i=0; i<commits.length; i++){
        let {oid, commit} = commits[i], prev, [parent, merge] = commit.parent;
        // XXX: review find_one_all_branches with derry
        let seq = yield _this.find_one_all_branches(oid,
          {name: 'git.oid', cfid});
        if (seq)
          continue;
        if (parent){
          // XXX: need smarter logic, current logic depends on order of
          // branches
          prev = yield _this.find_one_all_branches(parent,
            {name: 'git.oid', cfid});
          if (!prev)
            throw new Error('parent commit was not found '+parent);
        }
        let branch = git_br=='main' ? null : git_br; // XXX HACK
        // XXX: we might need to use new branch name in some cases (test it)
        let group = yield _this._sync_dir(config, cfid, branch, prev,
          '/', commit.tree, '0');
        let body = {op: 'commit', desc: commit.message, git: {oid}};
        if (merge)
          body.git.merge = merge;
        yield _this.decl({cfid, group}, body);
      }
    }
  }); }
  _sync_dir(config, cfid, branch, prev, dir, oid, mode){
    return etask({_: this}, function*_sync_dir()
  {
    let _this = this._, n = 0;
    let top = _this.get_branch_top(cfid, branch);
    if (top)
      prev = undefined;
    // XXX: eraly return if if dir oid did not changed
    // XXX: if no top, use prev top bseq
    if (!(yield _this.dir_exists(dir, {cfid, branch, prev}))){
      yield _this.add_dir(dir, {cfid, branch, prev, body: {git: {mode}}});
      n++;
      prev = undefined;
    }
    let {tree} = yield git_api.readTree({...config, oid});
    let dir_list = {};
    for (let i=0, e; e = tree[i]; i++)
      dir_list[e.type=='blob' ? dir+e.path : dir+e.path+'/'] = true;
    // XXX: need to get current branch
    top = _this.get_branch_top(cfid, branch);
    if (!top && prev)
      top = {seq: prev, bseq: _this.bseq_get(cfid, prev)};
    if (top){
      let iter = yield _this.ls_iter(cfid, top.bseq, top.seq, dir);
      for (; iter.curr; yield iter.next()){
        if (dir_list[iter.curr])
          continue;
        // XXX: fix rm so prev is used only once
        n += yield _this.rm(iter.curr, {cfid, branch, prev});
        prev = undefined;
      }
    }
    for (let i=0, e; e = tree[i]; i++){
      let file, _dir, body, top, prev_seq, blob, link;
      switch (e.type){
      case 'blob':
        file = dir+e.path;
        dir_list[file] = true;
        // XXX: need to get current branch
        top = _this.get_branch_top(cfid, branch);
        if (top)
          prev_seq = yield _this.get_file_seq(cfid, top.bseq, top.seq, file);
        else if (prev){
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
        link = yield _this.find_one_all_branches(e.oid,
          {dir: 'up', name: 'git.oid', cfid});
        if (yield _this.file_exists(file, {cfid, branch, prev}))
          yield _this.mod_file(file, blob, {cfid, branch, prev, link, body});
        else
          yield _this.add_file(file, blob, {cfid, branch, prev, link, body});
        n++;
        prev = undefined;
        break;
      case 'tree':
        _dir = dir+e.path+'/',
        dir_list[_dir] = true;
        n += yield _this._sync_dir(config, cfid, branch, prev, _dir, e.oid,
          e.mode);
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
}

GIT.create = (opt, d)=>etask(function*scroll_create(){
  assert(d.src, 'missing git src');
  let git = new GIT(opt);
  yield git.init();
  // XXX: reuse code from FS.create and call FS.create
  let s = {crypt: Scroll.supported_crypt[0], pub: b2s(opt.pub), ...d,
    csum_sha1: true, index: ['file', 'dir', {name: 'dir_list',
    transform: 'decl_get_dir', filter: {op: ['add', 'rm']}}, 'git.oid']};
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

