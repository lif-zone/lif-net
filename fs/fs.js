// author: derry. coder: arik.
'use strict';
import Scroll from '../storage/scroll.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import buf_util from '../net/buf_util.js';
const b2s = buf_util.buf_to_str;

export default class FS extends Scroll {
  constructor(opt){
    super(opt);
  }
  add_file(file, buf){ return this.decl([{op: 'add', file}, buf]); }
  add_dir(dir){ return this.decl({op: 'add', dir}); }
  test_get_seq(cfid, seq){
    let decl = this.get_decl(seq);
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
