// author: derry. coder: arik.
'use strict';
import assert from 'assert';
// XXX import Tree from 'avl';

export default class Index {
  constructor(opt){
    let scroll = this.scroll = opt.scroll;
    let cfid = this.cfid = opt.cfid;
    let branch = this.branch = opt.branch;
// XXX    let index_opt = this.index_opt = Index.normalize_opt(opt.index_opt);
    assert(scroll && cfid!=undefined && branch!=undefined,
      'missing scroll/cfid/branch');
  }
}

Index.normalize_opt = opt=>{
  if (!opt)
    return;
  if (typeof opt=='string')
    return {name: opt, field: opt};
  if (opt.name===undefined)
    return {name: opt.field, ...opt};
  return opt;
};
