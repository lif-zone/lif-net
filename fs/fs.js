// author: derry. coder: arik.
'use strict';
import Scroll from '../storage/scroll.js';
import etask from '../util/etask.js';
import assert from 'assert';
import util from '../util/util.js';
import buf_util from '../net/buf_util.js';
import DiffMatchAndPath from 'diff-match-patch';
const Diff = new DiffMatchAndPath();
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;

export default class FS extends Scroll {
  constructor(opt){
    super(opt);
    this.buf_hash_to_seq = new Map(); // XXX: do we need it?
  }
  // XXX: throw error on invalid file/dir
  add_dir(dir, opt={}){ return etask({_: this}, function*add_dir(){
    // XXX: throw error if trying to add the dir twice
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    yield _this.decl({cfid, branch, prev}, {op: 'add', dir});
  }); }
  rm_dir(dir, opt={}){ return etask({_: this}, function*rm_dir(){
    // XXX: need to lock scroll
    // XXX: do we need to load something (see bseq_get)?
    let _this = this._, {prev, cfid} = _this.parse_opt(opt);
    let top = _this.conflict.get(cfid).top;
    let seq_prev = prev>0 && prev!=top.seq ? prev : top.seq;
    let bseq_prev = _this.bseq_get(cfid, seq_prev);
    let branch_prev = _this.bseq_to_branch(cfid, bseq_prev);
    let top_prev = _this.get_branch_top(cfid, branch_prev);
    let first = true;
    const cb = opath=>etask(function*rm_dir_cb(){
      if (first)
        first = false;
      if (!valid_dir(opath.path))
        return _this.rm_file(opath.path, first ? opt : {});
      yield _this.ls_foreach(cfid, top_prev.bseq, seq_prev, opath.path, cb);
      yield _this._rm_dir(opath.path, first ? opt : {});
    });
    yield _this.ls_foreach(cfid, top_prev.bseq, seq_prev, dir, cb);
    yield _this._rm_dir(dir, first ? opt : {});
  }); }
  _rm_dir(dir, opt={}){ return etask({_: this}, function*_rm_dir(){
    // XXX: throw error if dir does not exist
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    yield _this.decl({cfid, branch, prev}, {op: 'rm', dir});
  }); }
  rm_file(file, opt={}){ return etask({_: this}, function*rm_file(){
    // XXX: throw error if file doesn't exist
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    yield _this.decl({cfid, branch, prev}, {op: 'rm', file});
  }); }
  add_file(file, buf, opt={}){ return etask({_: this}, function*add_file(){
    // XXX: throw error if trying to add the same file twice
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    if (!buf)
      return _this.decl({cfid, branch, prev}, {op: 'add', file});
    let h = _this.hash_str(buf);
    let link = _this.buf_hash_to_seq.get(h);
    if (link)
      return yield _this.decl({cfid, branch, prev, link}, [{op: 'add', file}]);
    let decl = yield _this.decl({cfid, branch, prev},
      [{op: 'add', file, content: 1}, buf]);
    _this.buf_hash_to_seq.set(h, decl.seq); // XXX: support cfid
    return decl;
  }); }
  // XXX: support cfid
  mod_file(file, buf, opt={}){ return etask({_: this}, function*mod_file(){
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    let h = buf && _this.hash_str(buf);
    let link = _this.buf_hash_to_seq.get(h);
    if (link)
      return yield _this.decl({cfid, branch, prev, link}, [{op: 'mod', file}]);
    let bseq_prev = _this.bseq_get(cfid, prev>=0 ? prev :
      _this.conflict.get(cfid).top.seq);
    link = yield _this.find_one(file, {name: 'file', cfid, bseq: bseq_prev});
    if (!link)
      throw new Error('file not found '+file);
   if (!buf)
      return yield _this.decl({cfid, branch, prev}, [{op: 'mod', file}]);
    let _buf = yield _this.resolve_buf(0, link);
    if (_buf){
      let diff = create_diff(_buf, buf);
      if (diff.length < 0.5*buf.length){
        return _this.decl({cfid, branch, prev, link},
          [{op: 'mod', file, diff: 1}, diff]);
      }
    }
    return _this.decl({cfid, branch, prev}, [{op: 'mod', file, content: 1},
      buf]);
  }); }
  get_file(cfid, file, branch){ return etask({_: this}, function*get_file(){
    let _this = this._, top = _this.get_branch_top(cfid, branch||null);
    if (!top)
      return;
    let seq = yield _this.get_file_seq(cfid, top.bseq, top.seq, file);
    if (seq)
      return yield _this.resolve_buf(cfid, seq);
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
    let {cfid, prev, branch} = opt;
    cfid = cfid||0;
    if (branch===undefined)
      return {cfid, branch, prev};
    let top = this.get_branch_top(cfid, branch);
    if (!top || prev!==undefined)
      return {cfid, branch, prev};
    prev = top.seq;
    branch = undefined;
    return {cfid, branch, prev};
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
    if (body.op)
      ret.op = body.op;
    if (body.dir)
      ret.dir = body.dir;
    if (body.file)
      ret.file = body.file;
    if (body.diff)
      ret.diff = body.diff;
    if (body.content)
      ret.content = body.content;
    if (header.link)
      ret.link = header.link;
    if (f2)
      ret.f2 = f2;
    return ret;
  }
  get_file_seq(cfid, bseq_top, seq, file){
    return this.find_one(file, {name: 'file', cfid, bseq: bseq_top, max: seq});
  }
  // XXX: need iterator
  ls_foreach(cfid, bseq_top, seq, dir, cb){
    return etask({_: this}, function*ls_foreach()
  {
    let _this = this._, done = {};
    let iter = yield _this.find_iter(dir, {name: 'dir_list', cfid,
      bseq: bseq_top, max: seq});
    for (; iter.curr; yield iter.next()){
      let decl = _this.get_decl(iter.curr.seq);
      yield decl.load(cfid);
      let body = decl.get_body(cfid), path = body.file||body.dir;
      assert(['add', 'rm'].includes(body.op), 'invalid op '+body.op);
      if (done[path])
        continue;
      done[path] = true;
      if (body.op!='rm')
        yield cb({parent: dir, path});
    }
  }); }
  test_ls(cfid, bseq_top, seq, dir){ return etask({_: this},
    function*test_ls()
  {
    let _this = this._, ret = [];
    assert(dir=='' || valid_dir(dir), 'invalid dir '+dir);
    let cb = opath=>{
      ret.push(opath.path);
      if (valid_dir(opath.path))
        return _this.ls_foreach(cfid, bseq_top, seq, opath.path, cb);
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
}

FS.create = (opt, d)=>etask(function*scroll_create(){
  let fs = new FS(opt);
  yield fs.init();
  yield fs.decl([{scroll: {crypt: Scroll.supported_crypt[0],
    pub: b2s(opt.pub), ...d, index: ['file', {name: 'dir_list',
      transform: 'decl_get_dir', filter: {op: ['add', 'rm']}}]}}]);
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
function valid_file(dir){ return dir[0]=='/' && dir[dir.length-1]!='/'; }
// XXX: need test + improve
function split(path){
  if (path=='/')
    return {path, parent: '', name: '/'};
  let i = path.lastIndexOf('/', path.length - (valid_dir(path) ? 2 : 1));
  return {path, parent: path.substr(0, i+1), name: path.substr(i+1)};
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

// XXX: change all branch api to be async
// XXX: index for ls of directory
// XXX: checkout by date
// XXX: test fs+db
