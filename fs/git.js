// author: derry. coder: arik.
import assert from 'assert';
import fs from 'fs';
import http from 'isomorphic-git/http/node/index.cjs';
import array from '../util/array.js';
import date from '../util/date.js';
import string from '../util/string.js';
import xerr from '../util/xerr.js';
import FS from './fs.js';
import util from '../util/util.js';
import git_util from './git_util.js';
import etask from '../util/etask.js';
import Scroll from '../storage/scroll.js';
import buf_util from '../net/buf_util.js';
import git_api from 'isomorphic-git';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;

// XXX: need test + mv to generic place + need proper escape
function escape_fs(s){ return s.replaceAll('/', '_').replaceAll(':', '_'); }

const copy_commit_data_safe = (config, body, oid, commit)=>etask(
  function*copy_commit_data_safe()
{
  copy_commit_data(body, commit);
  let _oid = calc_sha_commit(body);
  if (oid==_oid)
    return _oid;
  let commit_o = yield git_api.readObject({...config, oid, format: 'content'});
  let raw_commit = commit_o.object.toString();
  let desc = raw_commit.slice(raw_commit.indexOf('\n\n') + 2);
  body.desc = desc;
  _oid = calc_sha_commit(body);
  if (oid==_oid)
    return _oid;
  body.git.raw_commit = raw_commit;
  return calc_sha_commit(body);
});

function copy_commit_data(body, commit){
  body.desc = commit.message;
  body.git.tree = commit.tree;
  body.git.author = commit.author;
  body.git.committer = commit.committer;
  if (commit.gpgsig)
    body.git.gpgsig = commit.gpgsig;
}

function calc_sha_commit(body){
  return git_util.hash('commit', get_commit_raw(body)); }

function get_commit_raw(body){
  let git = body.git, s='';
  if (git.raw_commit)
    return git.raw_commit;
  let line = git_util.render_header;
  s+=line('tree', git.tree);
  if (git.parent)
    s+=line('parent', git.parent);
  if (git.merge){
    (Array.isArray(git.merge) ? git.merge : [git.merge])
    .forEach(m=>s+=line('parent', m));
  }
  s+=line('author', git.author?.name+' <'+git.author?.email+'> '+
    git.author?.timestamp+' '+date.format_tz(git.author?.timezoneOffset));
  s+=line('committer', git.committer?.name+' <'+git.committer?.email+'> '+
    git.committer?.timestamp+' '+
    date.format_tz(git.committer?.timezoneOffset));
  if (git.gpgsig)
    s+=line('gpgsig', git.gpgsig);
  s += '\n'+body.desc;
  return Buffer.from(s);
}

export default class GIT extends FS {
  constructor(opt){
    super(opt);
    this.cache = {};
  }
  sync(opt={}){ return etask({_: this}, function*sync(){
    let _this = this._, {flip_protect} = opt;
    if (flip_protect===undefined)
      flip_protect = 'warn';
    let body = _this.get_decl(0).get_body(0);
    if (!body)
      throw new Error('missing seq0 body');
    let url = opt.url||body.scroll?.git?.src;
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
    let cfid = opt.cfid||0;
    let git_data = yield _this._get_git(config, opt);
    let curr_git_branches = yield _this.get_git_branches(cfid);
    // delete branches
    for (let i=0; i<curr_git_branches.length; i++){
      let curr = curr_git_branches[i], top;
      if (git_data.branch[curr]){
        let prev_top_oid = yield _this.get_git_br_top_oid(cfid, curr);
        if (!prev_top_oid || git_data.branch[curr].map[prev_top_oid])
          continue;
        top = git_data.branch[curr].top;
      } else {
        if (!git_data.root && !(yield _this.get_git_br_top_oid(cfid, curr)))
          continue;
      }
      if (top && flip_protect &&
        (yield _this.git_br_had_value(cfid, curr, top)))
      {
        if (flip_protect===true){
          git_data.branch[curr].ignore = true;
          continue;
        }
      }
      yield _this._rm_branch(cfid, curr);
    }
    // add new commits
    let merge_queue = {};
    for (let git_br in git_data.branch){
      let {ignore, commits} = git_data.branch[git_br];
      if (ignore)
        continue;
      yield _this._sync_commits(config, cfid, git_br, commits, merge_queue);
      // add branches that were not added before (no commit after branch oid)
      if (commits.length){
        let top_oid = yield _this.get_git_br_top_oid(cfid, git_br);
        let oid = commits[commits.length-1].oid;
        if (top_oid){
          if (top_oid!=oid)
            throw new Error('XXX TODO '+git_br); // XXX TODO
          continue;
        }
        let prev = yield _this.find_one(oid, {dir: 'up',
          name: 'commit_git_oid_all', cfid});
        if (!prev)
          throw new Error('top commit not found '+oid);
        if (flip_protect && (yield _this.git_br_had_value(cfid, git_br, oid))){
          if (flip_protect===true)
            continue;
          xerr('git: adding branch %s with a previous oid %s', git_br, oid);
        }
        yield _this._new_set_branch(cfid, prev, git_br, oid);
      }
    }
    // add oids that were merge but belong to a delete branch
    for (let oid in merge_queue){
      let git_br = merge_queue[oid];
      let seq = yield _this.find_one(oid, {dir: 'up',
        name: 'commit_git_oid_all', cfid});
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
      let branch = _this.get_avail_branch(cfid, '_null');
      yield _this._sync_commits(config, cfid, branch, commits,
        merge_queue);
    }
    yield _this._sync_tags(config, cfid, git_data.tag, flip_protect);
    let head = yield _this.get_head(cfid);
    if (head && head.branch!=git_data.main){ // XXX: rename main to head
      let top = _this.get_bseq_top(cfid, _this.bseq_get(cfid, head.seq));
      yield _this.decl({cfid, prev: top.seq}, {type: 'git_head', op: 'rm',
        git: {branch: head.branch}});
      head = null;
    }
    if (!head && git_data.main){
      let br_seq = yield _this.get_git_br_top_seq(cfid, git_data.main);
      if (!br_seq)
        return xerr('cannot find head '+git_data.main);
      yield _this.decl({cfid, prev: br_seq}, {type: 'git_head', op: 'add',
        git: {branch: git_data.main}});
    }
  }); }
  _sync_commits(config, cfid, git_br, commits, merge_queue){
    return etask({_: this}, function*_sync_commits()
  {
    let _this = this._;
    for (let i=0; i<commits.length; i++){
      let {oid, commit} = commits[i], prev, parent = commit.parent[0];
      let merge = commit.parent.slice(1);
      if (yield _this.git_br_exists(cfid, git_br)){
        let br_seq = yield _this.get_git_br_top_seq(cfid, git_br);
        let seq = yield _this.find_one(oid, {cfid, name: 'commit_git_oid',
          bseq: _this.bseq_get(cfid, br_seq)});
        let seq2 = yield _this.find_one(oid, {dir: 'up',
          name: 'commit_git_oid_all', cfid});
        if (!parent && !seq && seq2)
          yield _this._rm_branch(cfid, git_br);
      }
      if (yield _this.git_br_exists(cfid, git_br)){
        let br_seq = yield _this.get_git_br_top_seq(cfid, git_br);
        let seq = yield _this.find_one(oid, {cfid, name: 'commit_git_oid',
          bseq: _this.bseq_get(cfid, br_seq)});
        if (seq)
          continue;
        if (parent){
          prev = yield _this.find_one(parent, {cfid, name: 'commit_git_oid',
            bseq: _this.bseq_get(cfid, br_seq)});
          if (!prev)
            throw new Error('parent commit was not found '+parent);
        }
      } else {
        let seq = yield _this.find_one(oid, {dir: 'up',
          name: 'commit_git_oid_all', cfid});
        if (seq)
          continue;
        if (parent){
          prev = yield _this.find_one(parent, {dir: 'up',
            name: 'commit_git_oid_all', cfid});
          if (!prev)
            throw new Error('parent commit was not found '+parent);
        }
      }
      if (!parent && (yield _this.get_root_seq(cfid)))
        throw new Error('adding 2nd git root '+oid);
      if (!Number.isInteger(prev))
        prev = _this.conflict.get(cfid).top.seq;
      if (!(yield _this.git_br_exists(cfid, git_br)))
        prev = yield _this._new_set_branch(cfid, prev, git_br, parent);
      else
        prev = yield _this.get_git_br_top_seq(cfid, git_br);
      let prev_top_oid = yield _this.get_git_br_top_oid(cfid, git_br);
      if (prev_top_oid && prev_top_oid!=parent)
        throw new Error('git corruption '+git_br);
      let body = {type: 'commit', op: 'add', git: {oid}};
      if (parent)
        body.git.parent = parent;
      if (merge.length){
        body.git.merge = merge.length==1 ? merge[0] : merge;
        merge.forEach(moid=>merge_queue[moid] = git_br);
      }
      let _oid = yield copy_commit_data_safe(config, body, oid, commit);
      if (oid!=_oid)
        throw new Error('failed commmit verify '+oid+'!='+_oid);
      let group = yield _this._sync_dir(config, cfid, prev,
        '/', commit.tree, '0');
      delete merge_queue[oid];
      yield _this.decl(group ? {cfid, group} : {cfid, prev}, body);
    }
  }); }
  _sync_tags(config, cfid, tags, flip_protect){
    return etask({_: this}, function*_sync_tags()
  {
    let _this = this._;
    let curr_tags = yield _this.get_git_tags(cfid);
    // delete tag
    for (let i=0; i<curr_tags.length; i++){
      let curr = curr_tags[i];
      let {tag, oid} = curr;
      if (tags[tag])
        continue;
      yield _this.decl({cfid, branch: null}, {type: 'tag', op: 'rm', tag,
        git: {oid}});
    }
    for (let tag in tags){
      let o = tags[tag], {oid} = o, link, op;
      let oid2 = yield _this.get_git_tag_oid(cfid, tag);
      if (oid2===oid)
        continue;
      if (flip_protect && (yield _this.git_tag_had_value(cfid, tag, oid))){
        if (flip_protect===true)
          continue;
        xerr('git: adding tag %s with a previous oid %s', tag, oid);
      }
      op = (yield _this.git_tag_exists(cfid, tag)) ? 'mod' : 'add';
      if (o.type=='commit'){
        link = yield _this.find_one(oid, {dir: 'up',
          name: 'commit_git_oid_all', cfid});
        yield _this.decl({cfid, branch: null, link}, {type: 'tag', op, tag,
          git: {oid}});
      } else if (o.type=='tag'){
        let commit_oid = o.tag.object;
        link = yield _this.find_one(commit_oid, {dir: 'up',
          name: 'commit_git_oid_all', cfid});
        link = (yield _this.decl({cfid, branch: null, link}, {type: 'tag_o',
          op: 'add', tag, desc: o.tag.message, git: {oid, commit_oid}})).seq;
        yield _this.decl({cfid, branch: null, link}, {type: 'tag', op, tag,
          git: {oid}});
      } else
        assert.fail('invalid tag type '+o.type);
    }
  }); }
  _get_git(config, opt){ return etask({_: this}, function*_get_git()
  {
    // XXX: detect branch didn't change and make sure we don't work on it
    let _this = this._, main;
    let git_branches = yield git_api.listBranches(config.gitdir ? config :
      {...config, remote: 'origin'});
    if (git_branches.includes('HEAD'))
      array.rm_elm(git_branches, 'HEAD');
    if (config.gitdir)
      main = opt.main;
    else
      main = yield _this._get_main_git_br(config);
    if (main && git_branches[0]!=main && git_branches.includes(main))
      git_branches.unshift(array.rm_elm(git_branches, main));
    let ret = {root: undefined, main: main, branch: {}, tag: {}}, root;
    // add new commits to scroll
    for (let i=0; i<git_branches.length; i++){
      let git_br = git_branches[i];
      yield git_api.checkout(config.gitdir ? {...config, ref: git_br} :
        {...config, ref: git_br, remote: 'origin'});
      if (config.url)
        yield git_api.fetch({...config});
      // XXX: use since from last sync
      let log = yield git_api.log({...config, ref: git_br});
      let commits = [], map = {}, top = log[0].oid;
      for (let j=0, parent; j<log.length && (!j||parent); j++){
        let curr = log[j];
        if (parent && curr.oid!=parent) // skip merge side branch
          continue;
        commits.unshift(curr);
        parent = curr.commit.parent[0];
      }
      for (let j=0; j<log.length; j++){
        let curr = log[j];
        map[curr.oid] = curr;
      }
      let r = commits[0]?.oid;
      if (!root)
        root = r;
      if (root && r && root!=r)
        throw new Error('multiple root not supported '+r);
      ret.branch[git_br] = {commits, map, log, top};
    }
    ret.root = root;
    let tags = yield git_api.listTags(config.gitdir ? config :
      {...config, remote: 'origin'});
    for (let i=0; i<tags.length; i++){
      let tag = tags[i], type, _tag;
      let oid = yield git_api.resolveRef({...config, ref: tag});
      if (!oid){
        xerr('failed to resolve ref %s', tag);
        continue;
      }
      let o = yield git_api.readObject({...config, oid,
        format: 'content'});
      switch (type = o?.type){
      case 'commit': break;
      case 'tag': _tag = (yield git_api.readTag({...config, oid})).tag; break;
      default: // XXX: TODO
        xerr('XXX TODO: ignore unsupported ref type %s', type);
        continue;
      }
      ret.tag[tag] = {type, oid, tag: _tag};
    }
    return ret;
  }); }
  _sync_dir(config, cfid, prev, dir, oid, mode){
    return etask({_: this}, function*_sync_dir()
  {
    let _this = this._, n = 0;
    // XXX: early return if if dir oid did not changed
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
      let file, _dir, body, prev_o, blob, link;
      switch (e.type){
      case 'blob':
        file = dir+e.path;
        dir_list[file] = true;
        top = prev ? prev : _this.conflict.get(cfid).top.seq;
        prev_o = yield _this.get_file_seq_data(cfid,
          _this.bseq_get(cfid, top), top, file);
        if (prev_o?.data?.git?.oid==e.oid)
          break;
        body = {git: {oid: e.oid, mode: e.mode}};
        blob = (yield git_api.readBlob({...config, oid: e.oid})).blob;
        blob = blob ? Buffer.from(blob) : null;
        link = yield _this.find_one(e.oid, {dir: 'up', name: 'fs_git_oid_all',
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
  _get_main_git_br(config){ return etask(function*_get_main_git_br(){
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
    let top_seq = yield _this.get_git_br_top_seq(cfid, git_br, 'commit');
    if (!top_seq)
      return;
    return (yield _this.load_body(cfid, top_seq))?.git?.oid;
  }); }
  get_git_br_top_seq(cfid, git_br, type){ return etask({_: this},
    function*get_git_br_top_seq()
  {
    let _this = this._, seq = yield _this.get_git_br_seq(cfid, git_br);
    if (!Number.isInteger(seq))
      return;
    let bseq_top = _this.get_bseq_top(cfid, _this.bseq_get(cfid, seq));
    if (type===undefined)
      return bseq_top.seq;
    let bseq = bseq_top.bseq;
    while (true){
      let decl = _this.get_decl(_this.bseq_to_seq(cfid, bseq));
      yield decl.load(cfid);
      if (decl.get_body(cfid)?.type==type)
        return decl.seq;
      let prev = yield decl.get_prev();
      if (!prev)
        return;
      bseq = prev.bseq_get(cfid);
    }
  }); }
  git_br_exists(cfid, git_br){ return etask({_: this}, function*git_br_exists()
  {
    return Number.isInteger(yield this._.get_git_br_seq(cfid, git_br));
  }); }
  get_git_br_seq(cfid, git_br){ return etask({_: this},
    function*get_git_br_seq()
  {
    let _this = this._;
    let o = yield _this.find_one_data(git_br, {cfid, name: 'git_br_all'});
    return o && o.data?.op!='rm' ? o.seq : false;
  }); }
  git_tag_exists(cfid, tag){ return etask({_: this}, function*git_tag_exists(){
    return Number.isInteger(yield this._.get_git_tag_seq(cfid, tag));
  }); }
  get_git_tag_seq(cfid, tag){ return etask({_: this},
    function*get_git_tag_seq()
  {
    let _this = this._;
    let o = yield _this.find_one_data(tag, {cfid, name: 'git_tag_all'});
    return o && o.data?.op!='rm' ? o.seq : false;
  }); }
  get_git_tag_oid(cfid, tag){ return etask({_: this},
      function*get_git_tag_oid()
  {
    let _this = this._;
    let o = yield _this.find_one_data(tag, {cfid, name: 'git_tag_all'});
    return o && o.data?.op!='rm' ? o.data.git?.oid : false;
  }); }
  git_tag_had_value(cfid, tag, oid){ return etask({_: this},
    function*git_tag_had_value()
  {
    let _this = this._;
    let iter = yield _this.find_iter(tag, {cfid, name: 'git_tag_all'});
    for (; iter.curr && iter.curr.data?.git?.oid!=oid; yield iter.next());
    return !!iter.curr;
  }); }
  get_root_seq(cfid){ return etask({_: this}, function*get_root_seq(){
    let _this = this._, top = _this.conflict.get(cfid).top.seq;
    for (let i=0; i<=top; i++){
      let body = yield _this.load_body(cfid, i);
      if (body.type=='commit')
        return i;
    }
  }); }
  git_br_had_value(cfid, br, oid){ return etask({_: this},
    function*git_tag_had_value()
  {
    let _this = this._;
    let iter = yield _this.find_iter(br, {cfid, name: 'git_br_all'});
    for (; iter.curr && iter.curr.data?.git?.oid!=oid; yield iter.next());
    return !!iter.curr;
  }); }
  get_git_branches(cfid){ return etask({_: this}, function*get_git_branches(){
    let _this = this._;
    let iter = yield _this.find_iter({cfid, name: 'git_br_all'});
    let done = {}, ret = [];
    for (; iter.curr; yield iter.next()){
      let git_br = iter.curr.key;
      if (done[git_br])
        continue;
      done[git_br] = true;
      if (iter.curr.data?.op!='rm')
        ret.push(git_br);
    }
    return ret;
  }); }
  get_git_tags(cfid){ return etask({_: this}, function*get_git_tags(){
    let _this = this._;
    let iter = yield _this.find_iter({cfid, name: 'git_tag_all'});
    let done = {}, ret = [];
    for (; iter.curr; yield iter.next()){
      let tag = iter.curr.key;
      if (done[tag])
        continue;
      done[tag] = true;
      if (iter.curr.data?.op!='rm')
        ret.push({tag, oid: iter.curr.data?.git?.oid});
    }
    return ret;
  }); }
  _new_set_branch(cfid, prev, git_br, oid){ return etask({_: this},
    function*_new_set_branch()
  {
    let _this = this._;
    let prev_bseq_top = _this.get_bseq_top(cfid, _this.bseq_get(cfid, prev));
    let op, decl, o = yield _this.find_one_data('git_br', {cfid,
      bseq: prev_bseq_top.bseq, name: 'git_br_curr'});
    if (o){
      op = o.data?.op;
      if (op=='rm')
        prev = prev_bseq_top.seq;
    }
    if (op=='rm'){
      decl = yield _this.decl({cfid, prev}, {type: 'git_br', op: 'add',
        git: {oid, branch: git_br}});
    } else {
      let branch = _this.get_avail_branch(cfid, git_br);
      decl = yield _this.decl({cfid, branch, prev}, {type: 'git_br',
        op: 'add', git: branch==git_br ? oid ? {oid} : undefined :
          {oid, branch: git_br}});
    }
    return decl.seq;
  }); }
  _rm_branch(cfid, git_br){ return etask({_: this}, function*_rm_branch(){
    let _this = this._;
    let prev = yield _this.get_git_br_top_seq(cfid, git_br);
    let head = yield _this.get_head(cfid);
    if (head?.branch==git_br){
      let decl = yield _this.decl({cfid, prev}, {type: 'git_head', op: 'rm',
        git: {branch: head.branch}});
      prev = decl.seq;
    }
    yield _this.decl({cfid, prev}, {type: 'git_br', op: 'rm',
      git: {branch: git_br}});
  }); }
  get_avail_branch(cfid, br){
    let b=br;
    for (let i=2; this.branch_exists(cfid, b); b = br+' '+i, i++);
    return b;
  }
  calc_sha_file(opt){ return etask({_: this}, function*calc_sha_file(){
    let _this = this._, {file, cfid, seq} = opt;
    let buf = yield _this.get_file(file, {cfid: cfid, seq});
    if (!buf)
      return;
    return git_util.hash('blob', buf);
  }); }
  calc_sha_dir(opt){ return etask({_: this}, function*_calc_sha_dir(){
    let _this = this._, {dir, cfid, seq} = opt;
    let bseq = _this.bseq_get(cfid, seq);
    let a = [];
    let iter = yield _this.ls_iter(cfid, bseq, seq, dir);
    for (; iter.curr; yield iter.next()){
      let f = iter.curr;
      if (FS.valid_file(f)){
        // XXX: improve ls_iter to avoid call get_file_seq
        let fseq = yield _this.get_file_seq(cfid, bseq, seq, f);
        let body = yield _this.load_body(cfid, fseq);
        let sha = yield _this.calc_sha_file({cfid, seq, file: f});
        if (sha!=body?.git.oid)
          throw new Error('file sha mismatch '+f+' seq'+seq);
        a.push({file: f, mode: body?.git?.mode,
          name: FS.split(f).name, type: 'blob', sha});
      } else if (FS.valid_dir(f)){
        // XXX: improve ls_iter to avoid call get_dir_seq
        let fseq = yield _this.get_dir_seq(cfid, bseq, seq, f);
        let body = yield _this.load_body(cfid, fseq);
        a.push({dir: f, mode: body?.git?.mode,
          name: FS.split(f).name, type: 'tree',
          sha: yield _this.calc_sha_dir({cfid, seq, dir: f})});
      } else
        assert.fail('unknown type for '+f);
    }
    // XXX: support sort by abc in ls_iter
    // XXX: review isomorphic git compareTreeEntryPath
    a.sort((x, y)=>string.cmp(x.file||x.dir, y.file||y.dir));
    let o = Buffer.concat(a.map(o=>{
      const mode = Buffer.from(o.mode.replace(/^0/, ''));
      const space = Buffer.from(' ');
      const path = Buffer.from(o.name, 'utf8');
      const nullchar = Buffer.from([0]);
      const oid = Buffer.from(o.sha, 'hex');
      return Buffer.concat([mode, space, path, nullchar, oid]);
    }));
    return git_util.hash('tree', o);
  }); }
  get_head(cfid){ return etask({_: this}, function*get_head(){
    let _this = this._;
    let o = yield _this.find_one_data('git_head', {cfid,
      name: 'git_head_curr_all'});
    return o && o.data?.op!='rm' && {branch: o.data?.git?.branch, seq: o.seq};
  }); }
  verify_git(opt){ return etask({_: this}, function*(){
    let _this = this._, {cfid} = opt, top = _this.conflict.get(cfid).top;
    for (let i=0; i<=top.seq; i++){
      let body = yield _this.load_body(cfid, i);
      if (body.type!='commit')
        continue;
      let oid = calc_sha_commit(body);
      assert.equal(body.git.oid, oid, 'commit oid mismatch seq'+i);
      let tree_sha = yield _this.calc_sha_dir({dir: '/', cfid, seq: i});
      assert.equal(body.git.tree, tree_sha, 'tree sha mismatch seq'+i);
    }
  }); }
}

GIT.create = (opt, d)=>etask(function*scroll_create(){
  assert(d.git?.src, 'missing git src');
  let git = new GIT(opt);
  yield git.init();
  // XXX: reuse code from FS.create and call FS.create
  let s = {crypt: Scroll.supported_crypt[0], pub: b2s(opt.pub), ...d,
    csum_sha1: true, index: [{name: 'file', field: 'file', data: 'git.oid'},
    'dir',
    {name: 'dir_list', transform: 'decl_get_dir', filter: {op: ['add', 'rm']}},
    {name: 'commit_git_oid', field: 'git.oid',
      filter: {type: 'commit'}},
    {name: 'commit_git_oid_all', field: 'git.oid', all_branches: true,
      filter: {type: 'commit'}},
    {name: 'fs_git_oid_all', field: 'git.oid', all_branches: true,
      filter: {type: 'fs'}},
    // XXX: unite trasnform git_br_curr & git_head_curr -> git_br
    {name: 'git_br_curr', transform: 'git_br_curr', filter: {type: 'git_br'},
      data: 'op'},
    {name: 'git_br_all', transform: 'git_br', all_branches: true,
      filter: {type: 'git_br'}, data: ['op', 'git.oid']},
    {name: 'git_tag_all', field: 'tag', all_branches: true,
      filter: {type: 'tag'}, data: ['op', 'git.oid']},
    {name: 'git_head_curr_all', transform: 'git_head_curr',
      filter: {type: 'git_head'}, data: ['op', 'git.branch'],
      all_branches: true},
    ]};
  if (d?.csum_sha256) // XXX: needed?
    s.index.push('csum_sha256');
  let main = s.git?.main||'main';
  yield git.decl({scroll: s});
  yield git.decl({type: 'git_br', op: 'add', git: {branch: main}});
  yield git.decl({type: 'git_head', op: 'add', git: {branch: main}});
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

