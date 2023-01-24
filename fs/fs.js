// author: derry. coder: arik.
'use strict';
import Scroll from '../storage/scroll.js';
import crypto from '../util/crypto.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import buf_util from '../net/buf_util.js';
const b2s = buf_util.buf_to_str;

export default class FS extends Scroll {
  constructor(opt){
    super(opt);
    this.buf_hash_to_seq = new Map();
  }
  add_file(file, buf){ return etask({_: this}, function*add_file(){
    // XXX: throw error if trying to add the same file twice
    let _this = this._;
    if (!buf)
      return _this.decl({op: 'add', file});
    let h = b2s(crypto.hash(_this.crypt, buf)); // XXX _this.hash
    let link = _this.buf_hash_to_seq.get(h);
    if (link)
      return _this.decl({link}, [{op: 'add', file}]);
    let decl = yield _this.decl([{op: 'add', file}, buf]);
    _this.buf_hash_to_seq.set(h, decl.seq);
    return decl;
  }); }
  add_dir(dir){ return this.decl({op: 'add', dir}); }
  test_get_seq(cfid, seq){
    let decl = this.get_decl(seq);
    let header = decl.get_header(cfid);
    let body = decl.get_body(cfid);
    let f2 = decl.data_get().get(cfid).get(3); // XXX: need api
    let ret = {};
    if (body.op)
      ret.op = body.op;
    if (body.dir)
      ret.dir = body.dir;
    if (body.file)
      ret.file = body.file;
    if (f2)
      ret.f2 = f2;
    if (header.link)
      ret.link = header.link;
    return ret;
  }
}

FS.create = (opt, d)=>etask(function*scroll_create(){
  let fs = new FS(opt);
  yield fs.init();
  fs.decl([{scroll: {crypt: Scroll.supported_crypt[0],
    pub: b2s(opt.pub), ...d}}]);
  return fs;
});

// XXX: need test + improve
function valid_dir(dir){ return dir[dir.length-1]=='/'; }
// XXX: need test + improve
function valid_file(dir){ return dir[dir.length-1]!='/'; }

FS.valid_dir = valid_dir;
FS.valid_file = valid_file;
