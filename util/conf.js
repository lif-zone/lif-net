// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import fs from 'fs';
import util from './util.js';
import etask from './etask.js';
import xerr from './xerr.js';

// XXX: need test
export default class Conf {
constructor(file){ this.file = file; }

init(opt={}){ return etask({_: this}, function*conf_init(){
  let _this = this._, file = _this.file;
  let verbose = opt.verbose===undefined ? true : !!opt.verbose;
  assert(!_this.inited, 'conf already inited '+file);
  _this.inited = true;
  try { yield fs.promises.access(file, fs.R_OK|fs.W_OK);
  } catch(err){
    if (!opt.create)
      throw err;
    if (verbose)
      xerr.notice('conf: create new %s', file);
    _this.conf = {};
    yield fs.promises.writeFile(file, _this.str(_this.conf), 'utf8');
  }
  if (verbose)
    xerr.notice('conf: loading %s', file);
  let s = yield fs.promises.readFile(file, 'utf8');
  return _this.conf = JSON.parse(s);
}); }

save(){ return etask({_: this}, function*conf_save(){
  let _this = this._;
  // XXX: need to copy existing version and make this operation safe
  yield fs.promises.writeFile(_this.file, _this.str(_this.conf), 'utf8');
}); }

get(path, val){ return util.get(this.conf, path); }

set(path, val){ return etask({_: this}, function*conf_set(){
  let _this = this._;
  util.set(_this.conf, path, val);
  yield _this.save(); // XXX: need automatic flush
}); }

str(){ return JSON.stringify(this.conf, null, '  '); }
}


