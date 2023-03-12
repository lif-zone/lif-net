// author: derry. coder: arik.
import assert from 'assert';
import FS from './fs.js';
import util from '../util/util.js';
import etask from '../util/etask.js';
import Scroll from '../storage/scroll.js';
import buf_util from '../net/buf_util.js';
const b2s = buf_util.buf_to_str, s2b = buf_util.buf_from_str;

export default class GIT extends FS {
}

GIT.create = (opt, d)=>etask(function*scroll_create(){
  let git = new GIT(opt);
  yield git.init();
  // XXX: add type/topic: 'git'
  // XXX: add option for csum_sha256/len
  let s = {crypt: Scroll.supported_crypt[0], pub: b2s(opt.pub), ...d,
    index: ['file', 'dir', {name: 'dir_list',
    transform: 'decl_get_dir', filter: {op: ['add', 'rm']}}]};
  if (d?.csum_sha256)
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

