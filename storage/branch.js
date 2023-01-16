// author: derry. coder: arik.
'use strict';
import assert from 'assert';

/* design:
branch format: s-b.s-b.s-b.s
branches:
br:null seq:0 bseq:0
br:b seq:2 bseq:1.0
br:null seq:4 bseq:2

db:
branch table key: [scfid, seq]
// XXX: rm {branch: null}
{scfid: 1, branch: null, seq: 0 bseq: 0, size: 10}
{scfid: 1, branch: b, seq: 10 bseq: 1-1.0}
// XXX: where to save full_seq/complete_data

// s
btable:
{seq: 0 bseq: 0} // size: 2
{seq: 4 bseq: 2} // size: 1}
scroll:
0           #bseq:0
1           #bseq:1
2_3
4 prev:1    #bseq:2

// s1
btable:
{seq: 0 bseq: 0} // size: 2
{seq: 2 bseq: 1-1.0} // size: 2
{seq: 4 bseq: 2} // size: 1
scroll:
0           #bseq:0
1           #bseq:1
2 branch:b  #bseq:1-1.0
3           #bseq:1-1.1
4 prev:1    #bseq:2

// s2
btable:
{seq: 0 bseq: 0} // size: 2
{seq: 2 bseq: 1-1.0} // size: 1
{seq: 3 bseq: 1-1.0-1.0} // size: 1
{seq: 4 bseq: 2} // size: 1
scroll:
0           #bseq:0
1           #bseq:1
2 branch:b  #bseq:1-1.0
3 branch:b2 #bseq:1-1.0-1.0
4 prev:1    #bseq:2



*/

// XXX: add bseq each time branch changes

export default class Branch_table {
  constructor(opt){
    this.scroll = opt.scroll;
    this.cfid = opt.cfid;
    assert(this.scroll && this.cfid!=undefined, 'missing scroll or cfid');
    this.max_seq = -1;
    this.branch = new Map();
    this.a = [];
    this.storage_queue = [];
    if (!this.scroll.conflict.get(this.cfid).parent)
      this.add_branch({branch: null, seq: 0, bseq: '0'});
  }
  set_max_seq(max){ this.max_seq = max; }
  get_branch(branch){ return this.branch.get(branch); }
  get_last(seq, max){ // XXX: need test
    // XXX HACK: need sorted array & optimize conflict
    let {scroll, cfid} = this, {parent} = scroll.conflict.get(cfid), last;
    if (parent)
      last = scroll.get_branch_table(parent.cfid).get_last(seq, parent.seq);
    let a = this.a;
    for (let i=0; i<a.length; i++){
      let bo = a[i];
      if (bo.seq > max)
        continue;
      if (!last && bo.seq <= seq)
        last = bo;
      else if (bo.seq <= seq && last.seq < bo.seq)
        last = bo;
    }
    return last;
  }
  find_avail_branch(bseq, max){ // XXX: need test
    let {scroll, cfid} = this, {parent} = scroll.conflict.get(cfid);
    if (parent){
      bseq = scroll.get_branch_table(parent.cfid).find_avail_branch(bseq,
        parent.seq);
    }
    // XXX HACK: need sorted array & optimize conflict
    while (true){
      let a = this.a, exists;
      for (let i=0; i<a.length; i++){
        let bo = a[i];
        if (bo.seq > max)
          continue;
        if (bo.bseq==bseq)
          exists = true;
      }
      if (!exists)
        return bseq;
      bseq = br_branch_inc(bseq);
    }
  }
  to_bseq(seq){
    if (this.max_seq < seq)
      return;
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
    if (this.branch.get(branch))
      this.branch.set(branch, bo);
    this.a.push(bo);
    this.storage_queue.push(bo);
  }
  to_static(){
    let a = this.a, ret = [];
    for (let i=0; i<a.length; i++){
      let bo = a[i];
      ret.push({...bo});
    }
    return ret;
  }
  row_to_static(bo){
    let {branch, seq, bseq} = bo;
    let cfid = this.cfid, scfid = this.scroll.to_scfid(cfid);
    assert(scfid>=0, 'missing scfid for cfid '+cfid);
    return {scfid, cfid, branch, seq, bseq};
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

function br_branch_new(a){ return a+'-1.0'; }

function br_branch_inc(a){
  let m = a.match(/^([\d.\-_]+)-([_]*[\d]+)\.0$/);
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
