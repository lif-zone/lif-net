// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import Scroll from '../storage/scroll.js';
import etask from '../util/etask.js';
import util from '../util/util.js';
import buf_util from '../net/buf_util.js';
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;

// XXX: need test
export default class Conf extends Scroll {
get(path, opt={}){ return etask({_: this}, function*conf_get(){
  let _this = this._;
  let cfid = opt.cfid||0, type = opt.type||'merge';
  let top = _this.conflict.get(cfid).top.seq;
  if (!['merge', 'merge_deep', 'last'].includes(type))
    throw new Error('invalid type '+type);
  if (type=='last'){
    let curr = _this.get_decl(top);
    let body = yield curr.load_body(cfid);
    return util.get(body, path);
  }
  let merged;
  for (let seq=1; seq<=top; seq++){
    let curr = _this.get_decl(seq);
    let body = yield curr.load_body(cfid);
    if (type=='merge_deep')
      merged = util.extend_deep(merged, body);
    else
      merged = {...merged, ...body};
  }
  // XXX: cache merged by type+top
  return util.get(merged, path);
}); }
}

Conf.create = (opt, d)=>etask(function*scroll_create(){
  let scroll = new Conf(opt);
  yield scroll.init();
  scroll.decl([{scroll: {crypt: Conf.supported_crypt[0],
    pub: b2s(opt.pub||opt.soul.keypair?.pub), ...d}}]);
  return scroll;
});

Conf.open = opt=>etask(function*scroll_open(){
  assert(util.is_mocha()||opt.soul, 'producion must use global soul');
  let seq, h;
  if (typeof opt.M=='string')
    [seq, h] = [0, s2b(opt.M)];
  else // XXX: support Uint8Array
    [seq, h] = Buffer.isBuffer(opt.M) ? [0, opt.M] : [opt.M.seq, opt.M.h];
  assert(seq==0 || !opt.storage, 'open with seq>0 cannot use storage');
  assert(util.is_mocha() || seq==0, 'producion scroll must have M0');
  assert(/^\d+$/.test(seq) && h, 'scroll.open missing M');
  let soul = opt.soul||Scroll.soul, scroll = seq==0 && soul.get(h);
  if (scroll)
    return scroll;
  scroll = new Conf(opt);
  yield scroll.init({M: h, seq});
  return scroll;
});


