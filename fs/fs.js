// author: derry. coder: arik.
'use strict';
import Scroll from '../storage/scroll.js';
import crypto from '../util/crypto.js';
import etask from '../util/etask.js';
import assert from 'assert';
import util from '../util/util.js';
import buf_util from '../net/buf_util.js';
import DiffMatchAndPath from 'diff-match-patch';
const Diff = new DiffMatchAndPath();
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;

export default class FS extends Scroll {
  add_dir(dir, opt={}){ return etask({_: this}, function*add_dir(){
    assert(valid_dir(dir), 'invalid dir '+dir);
    let _this = this._, {branch, prev, cfid, body} = _this.parse_opt(opt);
    if (yield _this.dir_exists(dir, opt))
      throw new Error('dir exists '+dir);
    yield _this.decl({cfid, branch, prev}, {type: 'fs', op: 'add',
      dir, ...body});
  }); }
  rm_dir(dir, opt={}){ return etask({_: this}, function*rm_dir(){
    assert(valid_dir(dir), 'invalid dir '+dir);
    // XXX: need to lock scroll
    // XXX: why branch is missing?
    let _this = this._, {prev, cfid} = _this.parse_opt(opt), n=0;
    if (!(yield _this.dir_exists(dir, opt)))
      throw new Error('dir not found '+dir);
    let top = _this.conflict.get(cfid).top;
    let seq_prev = prev>0 && prev!=top.seq ? prev : top.seq;
    let bseq_prev = _this.bseq_get(cfid, seq_prev);
    let branch_prev = _this.bseq_to_branch(cfid, bseq_prev);
    let top_prev = _this.get_branch_top(cfid, branch_prev);
    let first = true;
    const cb = o=>etask(function*rm_dir_cb(){
      let path = o.path;
      if (first)
        first = false;
      n++;
      if (!valid_dir(path))
        return _this.rm_file(path, first ? opt : {});
      yield _this.ls_foreach(cfid, top_prev.bseq, seq_prev, path, cb);
      yield _this._rm_dir(path, first ? opt : {});
    });
    yield _this.ls_foreach(cfid, top_prev.bseq, seq_prev, dir, cb);
    yield _this._rm_dir(dir, first ? opt : {});
    return n+1;
  }); }
  _rm_dir(dir, opt={}){ return etask({_: this}, function*_rm_dir(){
    let _this = this._, {branch, prev, cfid, body} = _this.parse_opt(opt);
    yield _this.decl({cfid, branch, prev}, {type: 'fs', op: 'rm',
      dir, ...body});
    return 1;
  }); }
  rm_file(file, opt={}){ return etask({_: this}, function*rm_file(){
    assert(valid_file(file), 'invalid file '+file);
    let _this = this._, {branch, prev, cfid, body} = _this.parse_opt(opt);
    if (!(yield _this.file_exists(file, opt)))
      throw new Error('file not found '+file);
    yield _this.decl({cfid, branch, prev}, {type: 'fs', op: 'rm',
      file, ...body});
    return 1;
  }); }
  rm(path, opt){
    return valid_file(path) ? this.rm_file(path, opt) :
      this.rm_dir(path, opt);
  }
  add_file(file, buf, opt={}){ return etask({_: this}, function*add_file(){
    assert(valid_file(file), 'invalid file '+file);
    let _this = this._;
    let {branch, prev, cfid, link, body} = _this.parse_opt(opt);
    if (yield _this.file_exists(file, opt))
      throw new Error('file exists '+file);
    body = {type: 'fs', op: 'add', file, ...body};
    if (_this.support_len())
      body.len = buf?.length||0;
    if (!buf)
      return _this.decl({cfid, branch, prev}, body);
    if (_this.support_csum_sha256())
      body.csum_sha256 = crypto.sha256_str(buf);
    if (!link && body.csum_sha256){
      // XXX: rm bseq from find_one call
      // XXX: need to find in all branches
      link = yield _this.find_one(body.csum_sha256, {dir: 'up',
        name: 'csum_sha256', cfid,
        bseq: _this.bseq_get(cfid, _this.conflict.get(cfid).top.seq)});
    }
    if (link)
      return yield _this.decl({cfid, branch, prev, link}, body);
    body.content = 1;
    return yield _this.decl({cfid, branch, prev}, [body, buf]);
  }); }
  mod_file(file, buf, opt={}){ return etask({_: this}, function*mod_file(){
    assert(valid_file(file), 'invalid file '+file);
    let _this = this._;
    let {branch, prev, cfid, link, body} = _this.parse_opt(opt);
    if (!(yield _this.file_exists(file, opt)))
      throw new Error('file not found '+file);
    body = {type: 'fs', op: 'mod', file, ...body};
    if (_this.support_len())
      body.len = buf?.length||0;
    if (buf && _this.support_csum_sha256())
      body.csum_sha256 = crypto.sha256_str(buf);
    if (!link && body.csum_sha256){
      // XXX: rm bseq from find_one call
      // XXX: do we need to find in all branches?
      link = yield _this.find_one(body.csum_sha256, {dir: 'up',
        name: 'csum_sha256', cfid,
        bseq: _this.bseq_get(cfid, _this.conflict.get(cfid).top.seq)});
    }
    if (link)
      return yield _this.decl({cfid, branch, prev, link}, body);
    let bseq_prev = _this.bseq_get(cfid, prev>=0 ? prev :
      _this.conflict.get(cfid).top.seq);
    link = yield _this.find_one(file, {name: 'file', cfid, bseq: bseq_prev});
    if (!link)
      throw new Error('file not found '+file);
   if (!buf)
      return yield _this.decl({cfid, branch, prev}, body);
    let _buf = yield _this.resolve_buf(0, link);
    if (_buf && !buf.compare(_buf))
      return yield _this.decl({cfid, branch, prev, link}, body);
    if (_buf){
      let diff = create_diff(_buf, buf);
      if (diff.length < 0.5*buf.length){
        body.diff = 1;
        return _this.decl({cfid, branch, prev, link}, [body, diff]);
      }
    }
    body.content = 1;
    return _this.decl({cfid, branch, prev}, [body, buf]);
  }); }
  file_exists(file, opt){ return etask({_: this}, function*file_exists(){
    assert(valid_file(file), 'invalid file '+file);
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt), o;
    if (prev!==undefined)
      o = yield _this.get_file_seq_data(cfid, null, prev, file);
    else {
      let top = _this.get_branch_top(cfid, branch||null);
      if (!top){
        o = yield _this.get_file_seq_data(cfid, null,
          _this.conflict.get(cfid).top.seq, file);
      } else
        o = yield _this.get_file_seq_data(cfid, top.bseq, top.seq, file);
    }
    return ['add', 'mod'].includes(o?.data?.op);
  }); }
  dir_exists(dir, opt){ return etask({_: this}, function*dir_exists(){
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt), o;
    if (prev!==undefined)
      o = yield _this.get_dir_seq_data(cfid, null, prev, dir);
    else {
      let top = _this.get_branch_top(cfid, branch||null);
      if (!top){
        o = yield _this.get_dir_seq_data(cfid, null,
          _this.conflict.get(cfid).top.seq, dir);
      } else
        o = yield _this.get_dir_seq_data(cfid, top.bseq, top.seq, dir);
    }
    return ['add', 'mod'].includes(o?.data?.op);
  }); }
  get_file(file, opt){ return etask({_: this}, function*get_file(){
    let _this = this._;
    let {cfid, branch, seq} = opt;
    if (branch!==undefined){
      let top = _this.get_branch_top(cfid, branch||null);
      if (!top)
        return;
      seq = Math.max(top.seq, seq||0);
    }
    let seqf = yield _this.get_file_seq(cfid, _this.bseq_get(cfid, seq),
      seq, file);
    if (seqf)
      return yield _this.resolve_buf(cfid, seqf);
  }); }
  resolve_buf(cfid, seq){ return etask({_: this}, function*resolve_buf(){
    // XXX: verify we test every part of it
    let _this = this._, decl = _this.get_decl(seq);
    yield decl.load(cfid, {data: true});
    let header = decl.get_header(cfid);
    let body = decl.get_body(cfid);
    let o = FS.parse_buf_ref(body.diff ? body.diff : body.content), buf;
    if (!o)
      throw new Error('missing conent seq'+decl.seq);
    if (o.buf)
      buf = o.buf;
    else if (o.d)
      buf = yield decl.get_buf({cfid, d: o.d+2});
    else if (header.link){
      if (!o.l)
        throw new Error('missing conent link seq'+decl.seq);
      let seq2 = Scroll.resolve_link(header.link, o.l);
      if (seq2>=seq, 'link can only point backwards seq'+seq);
      buf = yield _this.resolve_buf(cfid, seq2);
    }
    if (!body.diff)
      return buf;
    let _seq = Scroll.resolve_link(header.link, '_');
    let _buf = yield _this.resolve_buf(cfid, _seq);
    return apply_diff(buf, _buf);
  }); }
  parse_opt(opt){ // XXX: need test
    let {cfid, prev, branch, link, body} = opt;
    cfid = cfid||0;
    if (branch===undefined)
      return {cfid, branch, prev, link, body};
    let top = this.get_branch_top(cfid, branch);
    if (!top || prev!==undefined)
      return {cfid, branch, prev, link, body};
    prev = top.seq;
    branch = undefined;
    return {cfid, branch, prev, link, body};
  }
  test_get_seq(cfid, seq){
    let decl = this.get_decl(seq);
    let header = decl.get_header(cfid);
    let body = decl.get_body(cfid);
    let f2 = decl.data_get().get(cfid).get(3); // XXX: need api
    let ret = {};
    if (!header)
      return ret;
    if (header.bseq)
      ret.bseq = header.bseq;
    if (header.branch)
      ret.branch = header.branch;
    if (header.group)
      ret.group = header.group;
    if (seq!=0) // XXX: rm special handling
      ret = {...ret, ...body};
    if (header.link)
      ret.link = header.link;
    if (f2)
      ret.f2 = f2;
    if (ret.git){ // XXX HACK: rm this code
      ret.git = {...ret.git};
      delete ret.git.tree;
      delete ret.git.author;
      delete ret.git.committer;
      delete ret.git.tagger;
      delete ret.git.parent;
    }
    return ret;
  }
  get_file_seq(cfid, bseq_top, seq, file){
    // XXX: mv this logic to find_one
    if (bseq_top===undefined || bseq_top===null)
      bseq_top = this.bseq_get(cfid, seq);
    return this.find_one(file, {name: 'file', cfid, bseq: bseq_top, max: seq});
  }
  get_file_seq_data(cfid, bseq_top, seq, file){
    // XXX: mv this logic to find_one
    if (bseq_top===undefined || bseq_top===null)
      bseq_top = this.bseq_get(cfid, seq);
    return this.find_one_data(file, {name: 'file',
      cfid, bseq: bseq_top, max: seq});
  }
  get_dir_seq(cfid, bseq_top, seq, dir){
    // XXX: mv this logic to find_one
    if (bseq_top===undefined || bseq_top===null)
      bseq_top = this.bseq_get(cfid, seq);
    return this.find_one(dir, {name: 'dir', cfid, bseq: bseq_top, max: seq});
  }
  get_dir_seq_data(cfid, bseq_top, seq, dir){
    // XXX: mv this logic to find_one
    if (bseq_top===undefined || bseq_top===null)
      bseq_top = this.bseq_get(cfid, seq);
    return this.find_one_data(dir, {name: 'dir', cfid, bseq: bseq_top,
      max: seq});
  }
   ls_iter(cfid, bseq_top, seq, dir){
    return etask({_: this}, function*ls_iter()
  {
    let _this = this._, done = {}, iter = {};
    let diter = yield _this.find_iter(dir, {name: 'dir_list', cfid,
      bseq: bseq_top, max: seq});
    iter.next = ()=> etask({_: this}, function*ls_iter(){
      iter.curr = null;
      for (; diter.curr; yield diter.next()){
        let {seq, data} = diter.curr;
        let path = data?.file||data?.dir;
        assert(['add', 'rm'].includes(data?.op), 'invalid op '+data?.op);
        if (done[path])
          continue;
        done[path] = true;
        if (data?.op=='rm')
          continue;
        iter.curr = {seq, path, data};
        break;
      }
      if (diter.curr)
        yield diter.next();
      return iter;
    });
    if (diter.curr)
      yield iter.next();
    return iter;
  }); }

  ls_foreach(cfid, bseq_top, seq, dir, cb){
    return etask({_: this}, function*ls_foreach()
  {
    let _this = this._;
    let iter = yield _this.ls_iter(cfid, bseq_top, seq, dir);
    for (; iter.curr; yield iter.next())
      yield cb(iter.curr);
  }); }
  test_ls(cfid, bseq_top, seq, dir){ return etask({_: this},
    function*test_ls()
  {
    let _this = this._, ret = [];
    assert(dir=='' || valid_dir(dir), 'invalid dir '+dir);
    let cb = o=>{
      let path = o.path;
      ret.push(path);
      if (valid_dir(path))
        return _this.ls_foreach(cfid, bseq_top, seq, path, cb);
    };
    yield _this.ls_foreach(cfid, bseq_top, seq, dir, cb);
    ret.sort((a, b)=>a<b ? -1 : a>b ? 1 : 0);
    return ret;
  }); }
  test_dump_fs(cfid, seq){ return etask({_: this}, function*test_dump_fs(){
    let _this = this._, ret = {}, top = _this.get_branch_top(0, null);
    ret.main = yield _this.test_ls(cfid, top.bseq, Math.min(top.seq, seq), '');
    let branches = _this.get_branches(cfid, seq);
    for (let i=0; i<branches.length; i++){
      let branch = branches[i];
      top = _this.get_branch_top(cfid, branch);
      ret[branch] = yield _this.test_ls(cfid, top.bseq,
        Math.min(top.seq, seq), '');
    }
    return ret;
  }); }
  support_len(){ return !!this.get_decl(0).get_body(0)?.scroll?.len; }
  support_csum_sha256(){
    return !!this.get_decl(0).get_body(0)?.scroll?.csum_sha256;
  }
  support_csum_sha1(){
    return !!this.get_decl(0).get_body(0)?.scroll?.csum_sha1;
  }
}

FS.create = (opt, d)=>etask(function*scroll_create(){
  let fs = new FS(opt);
  yield fs.init();
  // XXX: add type/topic: 'fs'
  // XXX: add option for csum_sha256/len
  let s = {crypt: Scroll.supported_crypt[0], pub: b2s(opt.pub), ...d,
    index: [{name: 'file', field: 'file', data: 'op'},
    {name: 'dir', field: 'dir', data: 'op'},
    {name: 'dir_list', transform: 'decl_get_dir', filter: {op: ['add', 'rm']},
    data: ['file', 'dir', 'op']}]};
  if (d?.csum_sha256)
    s.index.push('csum_sha256');
  if (d?.csum_sha1)
    s.index.push('csum_sha1');
  yield fs.decl({scroll: s});
  return fs;
});

FS.open = opt=>etask(function*scroll_open(){
  assert(util.is_mocha()||!opt.soul, 'producion must use global soul');
  let seq, h;
  if (typeof opt.M=='string')
    [seq, h] = [0, s2b(opt.M)];
  else // XXX: support Uint8Array
    [seq, h] = Buffer.isBuffer(opt.M) ? [0, opt.M] : [opt.M.seq, opt.M.h];
  assert.strictEqual(seq, 0, 'must provide M0');
  assert(/^\d+$/.test(seq) && h, 'scroll.open missing M');
  let soul = opt.soul||Scroll.soul, fs = seq==0 && soul.get(h);
  if (fs)
    return fs;
  fs = new FS(opt);
  yield fs.init({M: h, seq});
  return fs;
});

// XXX: need test + improve
function valid_dir(dir){ return dir[0]=='/' && dir[dir.length-1]=='/'; }
// XXX: need test + improve
function valid_file(file){ return file[0]=='/' && file[file.length-1]!='/'; }
// XXX: need test + improve
function split(path){
  if (path=='/')
    return {path, parent: '', name: '/'};
  let i = path.lastIndexOf('/', path.length - (valid_dir(path) ? 2 : 1));
  let name = path.substr(i+1);
  let parent = path.substr(0, i+1);
  if (name.slice(-1)=='/')
    name = name.substr(0, name.length-1);
  return {path, parent, name};
}

function parse_buf_ref(ref){
  if (ref===undefined || ref===null)
    return {l: '_'};
  if (Number.isInteger(ref))
    return {d: ref};
  if (typeof ref=='string')
    return {buf: Buffer.from(ref)};
  if (Number.isInteger(ref.d))
    return {d: ref.d};
  if (typeof ref.d=='string')
    return {l: ref.d};
  assert.fail('invalid ref %o', ref);
}

// XXX: need test
function create_diff(src, dst){
  let _s = Buffer.from(src).toString();
  let s = Buffer.from(dst).toString();
  return Buffer.from(Diff.patch_toText(Diff.patch_make(_s, s)));
}

// XXX: need test
function apply_diff(diff, base){
  return Buffer.from(Diff.patch_apply(Diff.patch_fromText(diff.toString()),
    base.toString())[0]);
}

FS.valid_dir = valid_dir;
FS.valid_file = valid_file;
FS.split = split;
FS.parse_buf_ref = parse_buf_ref;
