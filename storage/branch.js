// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import xerr from '../util/xerr.js';

/* design:
branches:
br:null seq:0 bseq:0
br:b seq:2 bseq:1.0
br:null seq:4 bseq:2
*/

export default class Branch_table {
  constructor(){
    this.branch = new Map();
  }
  get_branch(branch){
  }
  to_bseq(seq){
    // XXX HACK: need sorted array
    let last;
    for (const [, co] of this.branch){
      if (!last && co.seq <= seq)
        last = co;
      if (co.seq <= seq && last.seq < co.seq)
        last = co;
    }
    if (!last)
      return br_enc(seq);
    return br_seq_inc(last.bseq, seq-last.seq);
  }
  add_branch(opt){
    let {branch, seq, bseq} = opt;
    assert(branch && seq && bseq, 'missing opt');
    let bseq2 = br_branch_new(bseq);
    // XXX: need to call br_branch_inc if bseq2 already exists
    assert(!this.branch.get(branch), 'branch already exists '+branch);
    let bo = {branch, seq, bseq: bseq2};
    this.branch.set(branch, bo);
    xerr.notice('XXX branch %s seq %s bseq %s', branch, seq, bseq2);
  }
}

function br_enc(num){
  assert(Number.isInteger(num) && num>=0, 'invalid num '+num);
  let s = '';
  for (let i=10; i<=num; i*=10, s += '_');
  return s+num;
}

function br_int(a){
  let num, i;
  for (i=0; a[i]=='_'; i++);
  num = +a.substr(i);
  assert(i<a.length && Number.isInteger(num), 'invalid br_int '+a);
  return num;
}

function br_inc(a, n=1){
  let num = br_int(a);
  return br_enc(num+n);
}

function br_cmp(a, b){ return a==b ? 0 : a<b ? -1 : 1; }

function br_branch_new(a){ return a+'-0.0'; }

function br_branch_inc(a){
  let m = a.match(/^([\d.-]+)-([\d])+\.0$/);
  assert(m?.[1] && m?.[2], 'invalid br '+a);
  return m[1]+'-'+br_inc(m[2])+'.0';
}

function br_seq_inc(a, n){
  let m = a.match(/^(([\d.-]+)\.)?([\d]+)$/);
  assert(m, 'invalid br '+a);
  return (m[1]||'')+br_inc(m[3], n);
}

Branch_table.br_enc = br_enc;
Branch_table.br_int = br_int;
Branch_table.br_inc = br_inc;
Branch_table.br_cmp = br_cmp;
Branch_table.br_branch_new = br_branch_new;
Branch_table.br_branch_inc = br_branch_inc;
Branch_table.br_seq_inc = br_seq_inc;
