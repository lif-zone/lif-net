// author: derry. coder: arik.
'use strict';
import Scroll from '../storage/scroll.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import assert from 'assert';
import buf_util from '../net/buf_util.js';
import DiffMatchAndPath from 'diff-match-patch';
import Branch_table from '../storage/branch.js';
const {bseq_branch} = Branch_table;
const Diff = new DiffMatchAndPath();
const b2s = buf_util.buf_to_str;

export default class FS extends Scroll {
  constructor(opt){
    super(opt);
    this.buf_hash_to_seq = new Map();
    this.file_to_seq = new Map();
  }
  // XXX: support cfid
  add_dir(dir, opt={}){ return etask({_: this}, function*add_dir(){
    // XXX: throw error if trying to add the dir twice
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    yield _this.decl({cfid, branch, prev}, {op: 'add', dir});
  }); }
  rm_dir(dir, opt={}){ return etask({_: this}, function*rm_dir(){
  }); }
  // XXX: support cfid
  add_file(file, buf, opt={}){ return etask({_: this}, function*add_file(){
    // XXX: throw error if trying to add the same file twice
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    if (!buf){
      let decl = yield _this.decl({cfid, branch, prev}, {op: 'add', file});
      _this._set_file_seq(file, decl.seq, decl.bseq_get(cfid));
      return;
    }
    let h = _this.hash_str(buf);
    let link = _this.buf_hash_to_seq.get(h);
    if (link){
      let decl = yield _this.decl({cfid, branch, prev, link},
        [{op: 'add', file}]);
      _this._set_file_seq(file, decl.seq, decl.bseq_get(cfid));
      return;
    }
    let decl = yield _this.decl({cfid, branch, prev},
      [{op: 'add', file, content: 1}, buf]);
    _this._set_file_seq(file, decl.seq, decl.bseq_get(cfid));
    _this.buf_hash_to_seq.set(h, decl.seq);
    return decl;
  }); }
  // XXX: support cfid
  mod_file(file, buf, opt={}){ return etask({_: this}, function*mod_file(){
    // XXX: handle case of same buf
    let _this = this._, {branch, prev, cfid} = _this.parse_opt(opt);
    assert(buf, 'XXX TODO empty file'); // XXX
    let h = _this.hash_str(buf);
    let link = _this.buf_hash_to_seq.get(h);
    if (link){
      let decl = yield _this.decl({cfid, branch, prev, link},
        [{op: 'mod', file}]);
      _this._set_file_seq(file, decl.seq, decl.bseq_get(cfid));
      return;
    }
    // XXX: we can use branch table without loading decl
    let decl_prev = _this.get_decl(prev>=0 ? prev :
      _this.conflict.get(cfid).top.seq);
    yield decl_prev.load(cfid);
    link = _this._get_file_seq(file, decl_prev.bseq_get(cfid));
    if (!link)
      throw new Error('file not found '+file);
    let _buf = yield _this.resolve_buf(0, link), decl;
    // XXX: need create_patch/apply_patch
    let _s = Buffer.from(_buf).toString();
    let s = Buffer.from(buf).toString();
    let diff = Buffer.from(Diff.patch_toText(Diff.patch_make(_s, s)));
    if (diff.length < 0.5*buf.length){
      decl = yield _this.decl({cfid, branch, prev, link},
        [{op: 'mod', file, diff: 1}, diff]);
    }
    else {
      decl = yield _this.decl({cfid, branch, prev},
        [{op: 'mod', file, content: 1}, buf]);
    }
    _this._set_file_seq(file, decl.seq, decl.bseq_get(cfid));
  }); }
  resolve_buf(cfid, seq){ return etask({_: this}, function*resolve_buf(){
    // XXX: verify we test every part of it
    let _this = this._, decl = _this.get_decl(seq);
    yield decl.load(cfid, {data: true});
    let header = decl.get_header(cfid);
    let body = decl.get_body(cfid);
    // XXX: wrap with resolve_buf_single
    let o = FS.parse_buf_ref(body.diff ? body.diff : body.content), buf;
    if (!o)
      throw new Error('missing conent seq'+decl.seq);
    if (o.buf)
      buf = o.buf;
    else if (o.d)
      buf = yield decl.get_buf(o.d+2);
    else {
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
    return Buffer.from(Diff.patch_apply(Diff.patch_fromText(buf.toString()),
      _buf.toString())[0]);
  }); }
  _set_file_seq(file, seq, bseq){
    let bseqb = bseq_branch(bseq);
    let map = this.file_to_seq.get(bseqb);
    if (!map)
      this.file_to_seq.set(bseqb, map = new Map());
    map.set(file, seq);
  }
  _get_file_seq(file, bseq){
    let bseqb = bseq_branch(bseq);
    let map = this.file_to_seq.get(bseqb);
    if (!map)
      return;
    return map.get(file);
  }
  parse_opt(opt){
    let {cfid, branch} = opt, prev;
    cfid = cfid||0;
    if (branch===undefined)
      return {cfid, branch, prev};
    let top = this.get_branch_top(cfid, branch);
    if (!top)
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
}

FS.create = (opt, d)=>etask(function*scroll_create(){
  let fs = new FS(opt);
  yield fs.init();
  yield fs.decl([{scroll: {crypt: Scroll.supported_crypt[0],
    pub: b2s(opt.pub), ...d}}]);
  return fs;
});

// XXX: need test + improve
function valid_dir(dir){ return dir[dir.length-1]=='/'; }
// XXX: need test + improve
function valid_file(dir){ return dir[dir.length-1]!='/'; }

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

FS.valid_dir = valid_dir;
FS.valid_file = valid_file;
FS.parse_buf_ref = parse_buf_ref;
