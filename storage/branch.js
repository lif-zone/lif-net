// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import Tree from 'avl';

function bo_cmp(a, b){ return a.seq - b.seq; }

export default class Branch_table {
  constructor(opt){
    this.scroll = opt.scroll;
    this.cfid = opt.cfid;
    assert(this.scroll && this.cfid!=undefined, 'missing scroll or cfid');
    this.reset();
    if (this.cfid==0)
      this.add({seq: 0, bseq: '0'});
  }
  reset(){
    this.avl = new Tree(bo_cmp, true);
    this.branch_name = new Map();
    this.branch_bseq = new Map();
    this.reset_schedule();
  }
  reset_schedule(){ this.storage_queue = {mod: {}, rm: {}}; }
  get_branch(branch){ return this.branch_name.get(branch); }
  get_bo(seq){
    for (let node = this.avl._root; node;
      node = seq < node.key.seq ? node.left : node.right)
    {
      let bo = node.key;
      if (bo.seq<=seq && seq<bo.seq+bo.size)
        return bo;
    }
  }
  find_avail_branch(bseq){
    let {scroll, cfid} = this, {parent} = scroll.conflict.get(cfid);
    if (parent){ // XXX: test this case
      bseq = scroll.get_branch_table(parent.cfid).find_avail_branch(bseq,
        parent.seq);
    }
    for (; this.branch_bseq.get(bseq); bseq = br_branch_inc(bseq));
    return bseq;
  }
  add(opt){
    let {branch, seq, bseq} = opt, bo, bo_next;
    branch = branch||null;
    assert(Number.isInteger(seq) && seq>=0, 'invalid seq '+seq);
    assert(typeof bseq=='string', 'invalid bseq '+bseq); // XXX: need is_valid
    bo = this.get_bo(seq);
    if (bo){
      assert(br_cmp(bseq, br_inc(bo.bseq, bo.size))<0, 'bseq mismatch');
      assert(bo.seq+bo.size-seq>0, 'bo mismatch');
      return;
    }
    // try to merge with prev
    bo = this.get_bo(seq-1);
    if (bo && br_branch_eq(bseq, bo.bseq)){
      if (bo.seq<=seq && seq<bo.seq+bo.size)
        return;
      assert.equal(bo.seq+bo.size, seq, 'branch corruption');
      bo.size++;
      this._schedule_mod(bo.seq);
      bo_next = this.get_bo(seq+1);
      this._merge(bo, bo_next);
      return;
    }
    // try to merge with next
    bo_next = this.get_bo(seq+1);
    if (bo_next && br_branch_eq(bseq, bo_next.bseq)){
      assert.equal(bo_next.seq, seq+1, 'branch corruption');
      this._remove(bo_next);
      this._schedule_rm(bo_next.seq);
      bo_next.seq = seq;
      bo_next.size++;
      bo_next.bseq = bseq;
      if (branch)
        bo_next.branch = branch;
      this._insert(bo_next);
      this._schedule_mod(bo_next.seq);
      return;
    }
    // new entry
    bo = {...branch&&{branch}, seq, bseq, size: 1};
    if (!this.branch_name.get(branch))
      this.branch_name.set(branch, bo);
    this._insert(bo);
    this._schedule_mod(bo.seq);
  }
  _insert(bo){
    this.avl.insert(bo);
    if (/.*\.0/.test(bo.bseq))
      this.branch_bseq.set(bo.bseq, bo);
  }
  _remove(bo){
    this.avl.remove(bo);
    this.branch_bseq.delete(bo.bseq);
  }
  _merge(bo, bo_next){
    if (!bo_next || !br_branch_eq(bo.bseq, bo_next.bseq))
      return;
    assert.equal(br_inc(bo.bseq, bo.size), bo_next.bseq,
      'branch merge mismatch');
    bo.size += bo_next.size;
    this._remove(bo_next);
    this._schedule_mod(bo.seq);
    this._schedule_rm(bo_next.seq);
  }
  _schedule_mod(seq){
    this.storage_queue.mod[seq] = true;
    delete this.storage_queue.rm[seq];
  }
  _schedule_rm(seq){
    this.storage_queue.rm[seq] = true;
    delete this.storage_queue.mod[seq];
  }
  to_static(){
    let a = this.avl.keys(), ret = [];
    for (let i=0; i<a.length; i++){
      let o = {...a[i]};
      delete o.db;
      ret.push({...o});
    }
    return ret;
  }
  row_to_static(bo){
    let {branch, seq, bseq, size} = bo;
    let cfid = this.cfid, scfid = this.scroll.to_scfid(cfid);
    assert(scfid>=0, 'missing scfid for cfid '+cfid);
    let ret = {scfid, cfid, branch, seq, bseq, size};
    if (!ret.branch)
      delete ret.branch;
    return ret;
  }
  row_from_static(data){
    let {branch, seq, bseq, size} = data;
    let bo = branch ? {branch, seq, bseq, size} : {seq, bseq, size};
    this._insert(bo);
    if (branch)
      this.branch_name.set(branch, bo);
  }
}

function bint(num){
  assert(Number.isInteger(num) && num>=0, 'invalid num '+num);
  let s = '';
  for (let i=10; i<=num; i*=10, s += '_');
  return s+num;
}

function bint2int(a){
  let num, i;
  for (i=0; a[i]=='_'; i++);
  num = +a.substr(i);
  return i<a.length && Number.isInteger(num) ? num : undefined;
}

function br_inc(a, n=1){
  let m = a.match(/^([\d.\-_]*\.)?([_]*[\d]+)$/);
  assert(m[2], 'invalid br '+a);
  let num = bint2int(m[2]);
  return (m[1]||'')+bint(num+n);
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

Branch_table.bint = bint;
Branch_table.bint2int = bint2int;
Branch_table.br_inc = br_inc;
Branch_table.br_cmp = br_cmp;
Branch_table.br_branch_new = br_branch_new;
Branch_table.br_branch_inc = br_branch_inc;
Branch_table.br_branch_eq = br_branch_eq;

// XXX derry:
// XXX: verify btable is correct during conflict merge/delete and that we
// remove old entries
// XXX: change default hash to sha256 instead of blake
// XXX: check with derry etask.ps() of decl->sign
// XXX: test btable.branch_name
