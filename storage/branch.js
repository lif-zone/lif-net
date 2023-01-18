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

// example:
0           #bseq:0
1           #bseq:1
2_3
4           #bseq:1-1.0

{seq:0 bseq:0} // size: 2
{seq:4 bseq:1-1.0} // size:1

// option-1
2                     #bseq:2
3                     #bseq:3
4 branch:b prev:1     #bseq:1-1.0

{seq:0 bseq:0} // size:4
{seq:4 bseq:1-1.0} // size:1

// option-2
2                     #bseq:2
3 branch:b            #bseq:2-1.0
4 branch:b2 prev:1    #bseq:1-1.0

{seq:0 bseq:0} // size:3
{seq:3 bseq:2-1.0} // size:1
{seq:4 bseq:1-1.0} // size:1

without size?
- bseq1? bseq2?
- top of branch

1. save size in branch table
2. save bseq on any decl with prev/branch
3. save bseq on any decl

{seq: 0 bseq: 0} // size: 2
{seq: 2 bseq: 1-1.0} // size: 1
{seq: 3 bseq: 2} // size: 2


// example 2:
0 #bseq:0
1 #bseq:1
2 #bseq:2
3 #bseq:3
4-7
8
{seq:0 bseq:0} // size 4

option1:
4 branch:b #bseq:3-1.0
5          #bseq:3-1.1
6 prev:3   #bseq:4
7                          #bseq:5
8 branch:b2 prev 1         #bseq:6
{seq:0 bseq:0} // size 4
{seq:4 bseq:3-1.0} // size 2
{seq:6 bseq: 4} // size 3

option2:
4          #bseq:4
5 branch:b #4-1.0
6          #4-1.1
7 prev:4   #bseq:5
8          #bseq:6


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
    // XXX: rm null from branch name
    if (!this.scroll.conflict.get(this.cfid).parent)
      this.add({branch: null, seq: 0, bseq: '0'});
  }
  get_branch(branch){ return this.branch.get(branch); }
  _get_bo(seq){ // XXX: optimize
    let a = this.a;
    for (let i=0; i<a.length; i++){
      let bo = a[i];
      if (bo.seq<=seq && seq<bo.seq+bo.size)
        return bo;
    }
  }
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
  add(opt){
    let {branch, seq, bseq} = opt, bo, bo_next;
    if (!branch) // XXX: get branch from bseq
      branch = null;
    assert(Number.isInteger(seq) && seq>=0, 'invalid seq '+seq);
    assert(typeof bseq=='string', 'invalid bseq '+bseq); // XXX: need is_valid
    if (seq==0 && this._get_bo(seq))
      return;
    if (seq>0){
      bo = this._get_bo(seq-1);
      if (bo && br_branch_eq(bseq, bo.bseq)){
        if (bo.seq<=seq && seq<bo.seq+bo.size)
          return;
        assert.equal(bo.seq+bo.size, seq, 'XXX0');
        bo.size++; // XXX: this._inc_size
        bo_next = this._get_bo(seq+1);
        this._merge(bo, bo_next);
        // XXX: need to schedule storage_queue
        return;
      }
      bo_next = this._get_bo(seq+1);
      if (bo_next && br_branch_eq(bseq, bo_next.bseq)){
        assert.equal(bo_next.seq, seq+1, 'XXX1');
        bo_next.size++; // XXX: this._inc_size
        bo_next.seq = seq;
        bo_next.bseq = bseq;
        bo_next.branch = branch;
        // XXX: need to schedule storage_queue
        return;
      }
    }
    bo = {branch, seq, bseq, size: 1};
    if (!this.branch.get(branch))
      this.branch.set(branch, bo);
    this.a.push(bo);
    this.storage_queue.push(bo);
  }
  _merge(bo, bo_next){
    if (!bo_next || !br_branch_eq(bo.bseq, bo_next.bseq))
      return;
    assert.equal(br_seq_inc(bo.bseq, bo.size), bo_next.bseq,
      'branch merge mismatch');
    bo.size += bo_next.size;
    let i = this.a.indexOf(bo_next);
    assert(i>=0, 'bo_next not found');
    this.a.splice(i, 1);
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
    let {branch, seq, bseq, size} = bo;
    let cfid = this.cfid, scfid = this.scroll.to_scfid(cfid);
    assert(scfid>=0, 'missing scfid for cfid '+cfid);
    return {scfid, cfid, branch, seq, bseq, size};
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
  return i<a.length && Number.isInteger(num) ? num : undefined;
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

function br_branch_eq(a, b){
  let ma = a.match(/^([\d.\-_]+)\.[_]*\d+$/);
  let mb = b.match(/^([\d.\-_]+)\.[_]*\d+$/);
  return ma?.[1]==mb?.[1];
}

function br_seq_inc(a, n=1){
  let m = a.match(/^(([\d.-]+)\.)?_*([\d]+)$/);
  assert(m, 'invalid br '+a);
  return (m[1]||'')+br_inc(m[3], n);
}

Branch_table.br_enc = br_enc;
Branch_table.br_int = br_int;
Branch_table.br_inc = br_inc;
Branch_table.br_cmp = br_cmp;
Branch_table.br_branch_new = br_branch_new;
Branch_table.br_branch_inc = br_branch_inc;
Branch_table.br_branch_eq = br_branch_eq;
Branch_table.br_seq_inc = br_seq_inc;

// XXX derry:
// XXX: what if no bseq_prev (scroll.js:decl)
// XXX: if decl branch, we need to have complete branch table up to seq
// XXX: verify btable is correct during conflict merge/delete and that we
// remove old entries
// XXX: change default hash to sha256 instead of blake
// XXX: check with derry etask.ps() of decl->sign
// XXX: rm null from branch name
// XXX: cleanup br_* api naming
// XXX: review bseq_get api (we can use branch table to calc it)
// XXX: verify all tests are testing btable&bseq together
