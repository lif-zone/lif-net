// author: derry. coder: arik.
import assert from 'assert';
import fs from 'fs';
import http from 'isomorphic-git/http/node/index.cjs';
import FS from './fs.js';
import util from '../util/util.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
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
  sync(){ return etask({_: this}, function*sync(){
    // XXX: need lock
    let _this = this._;
    let body = _this.get_decl(0).get_body(0);
    if (!body)
      throw new Error('missing seq0 body');
    let url = body.scroll?.src;
    if (!url)
      throw new Error('missing git src');
    // XXX: decide how to create valid dir
    let dir = '/tmp/lif_git_'+escape_fs(url);
    let config = {dir, url, fs, http, cache: _this.cache};
    // XXX HACK: decide how to get it
    config.author = {name: 'XXX', email: 'xxx@xxx.com'};
    yield git_api.clone({...config});
    yield git_api.checkout({...config, ref: 'main', remote: 'origin'});
    yield git_api.pull({...config});
    let head = yield git_api.resolveRef({...config, ref: 'main'});
    let commits = yield git_api.log({...config, ref: 'main'});
    commits.reverse();
    xerr.notice('XXX head %O', head);
    let cfid = 0; // XXX: support conflict
    for (let i=0; i<commits.length; i++){
      let commit = commits[i].commit;
      xerr.notice('XXX notice commit #%s %O', i, commit.tree);
      let group = yield _this._sync_dir(config, cfid, '/', commit.tree, '0');
      xerr.notice('XXX group %s', group);
      yield _this.decl({cfid, group}, {op: 'commit', desc: commit.message});
    }
  }); }
  _sync_dir(config, cfid, dir, oid, mode){
    return etask({_: this}, function*_sync_dir()
  {
    let _this = this._, n = 0;
    // XXX: eraly return if if dir oid did not changed
    if (!(yield _this.dir_exists(dir, {cfid}))){
      yield _this.add_dir(dir, {body: {git: {oid, mode}}});
      n++;
    }
    let {tree} = yield git_api.readTree({...config, oid});
    for (let i=0; i<tree.length; i++){
      let e = tree[i], path = dir+e.path, body, top, prev_seq, blob, link;
      switch (e.type){
      case 'blob':
        // XXX: need to get current branch
        top = _this.get_branch_top(cfid, null);
        prev_seq = yield _this.get_file_seq(cfid, top.bseq, top.seq, path);
        if (prev_seq){
          let prev_decl = _this.get_decl(prev_seq);
          yield prev_decl.load(cfid);
          if (prev_decl.get_body(cfid)?.git?.oid==e.oid)
            break;
        }
        body = {git: {oid: e.oid, mode: e.mode}};
        blob = (yield git_api.readBlob({...config, oid: e.oid})).blob;
        blob = blob ? Buffer.from(blob) : null;
        xerr.notice('XXX blob %s %s', path, e.oid);
        // XXX: rm bseq from find_one call
        link = yield _this.find_one(e.oid, {name: 'git.oid', cfid,
          bseq: _this.bseq_get(cfid, _this.conflict.get(cfid).top.seq)});
        if (yield _this.file_exists(path, {cfid}))
          yield _this.mod_file(path, blob, {cfid, link, body});
        else
          yield _this.add_file(path, blob, {cfid, link, body});
        n++;
        // next = {path, oid: e.oid, mode: e.mode};
        break;
      case 'tree':
        n += yield _this._sync_dir(config, cfid, path, e.oid, e.mode);
        break;
      default: throw new Error('unknown type '+e.type);
      }
    }
    xerr.notice('XXX dir %s tree %O', dir, tree);
    return n;
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

