// author: derry. coder: arik.
'use strict';
import Scroll from '../storage/scroll.js';
import etask from '../util/etask.js';
import buf_util from '../net/buf_util.js';
const b2s = buf_util.buf_to_str;

export default class FS extends Scroll {
  constructor(opt){
    super(opt);
  }
  add_dir(dir){ return this.decl({op: 'add', dir}); }
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

FS.valid_dir = valid_dir;
