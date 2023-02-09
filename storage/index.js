// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import Tree from 'avl';

export default class Index {
  constructor(opt){
    let scroll = this.scroll = opt.scroll;
    let cfid = this.cfid = opt.cfid;
    let branch = this.branch = opt.branch;
    assert(scroll && cfid!=undefined && branch!=undefined,
      'missing scroll/cfid/branch');
  }
}
