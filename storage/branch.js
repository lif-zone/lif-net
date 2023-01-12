// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import xerr from '../util/xerr.js';

/* design:
branch format: s-b.s-b.s-b.s
branches:
br:null seq:0 bseq:0
br:b seq:2 bseq:1.0
br:null seq:4 bseq:2
*/

export default class Branch_table {
  constructor(){
    this.branch = new Map();
    this.add_branch({branch: null, seq: 0, bseq: '0'});
  }
  get_branch(branch){ return this.branch.get(branch); }
  get_last(seq){ // XXX: need test
    // XXX HACK: need sorted array
    let last;
    for (const [, co] of this.branch){
      if (!last && co.seq <= seq)
        last = co;
      else if (co.seq <= seq && last.seq < co.seq)
        last = co;
    }
    return last;
  }
  find_avail_branch(bseq){ // XXX: need test
    // XXX: HACK: need sorted array
    while (true){
      let exists;
      for (const [, co] of this.branch){
        if (co.bseq==bseq)
          exists = true;
      }
      if (!exists)
        return bseq;
      bseq = br_branch_inc(bseq);
    }
  }
  to_bseq(seq){
    let last = this.get_last(seq);
    if (!last) // XXX: can this happen?
      return br_enc(seq);
    return br_seq_inc(last.bseq, seq-last.seq);
  }
  to_branch(seq){
    let last = this.get_last(seq);
    return last?.branch;
  }
  add_branch(opt){
    let {branch, seq, bseq} = opt;
    assert(Number.isInteger(seq) && seq>=0, 'invalid seq '+seq);
    assert(typeof bseq=='string', 'invalid bseq '+bseq); // XXX: need is_valid
    let bo = {branch, seq, bseq};
    this.branch.set(branch, bo);
    xerr.notice('XXX branch %s seq %s bseq %s', branch, seq, bseq);
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
