// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import Tree from 'avl';

function bo_cmp(a, b){ return a.seq - b.seq; }

export default class Branch_table {
  constructor(opt){
    let scroll = this.scroll = opt.scroll;
    let cfid = this.cfid = opt.cfid;
    assert(scroll && cfid!=undefined, 'missing scroll or cfid');
    this.reset();
    if (!cfid)
      this.add({seq: 0, bseq: '0'});
  }
  reset(){
    this.avl = new Tree(bo_cmp, true);
    this.branch_name = new Map();
    this.branch_bseq = new Map();
    this.bseqb_top = new Map();
    this.reset_schedule();
  }
  reset_schedule(){ this.storage_queue = {mod: {}, rm: {}}; }
  bseq_to_branch(bseq){
    let bseqb = bseq_branch(bseq);
    if (!bseq)
      return null;
    let bo = this.branch_bseq.get(bseqb+'.0');
    return bo?.branch;
  }
  get_branch(branch){ // XXX: need test
    let bo = this.branch_name.get(branch||null);
    if (bo)
      return bo;
    let {scroll, cfid} = this, {parent} = scroll.conflict.get(cfid);
    if (!parent)
      return;
    return scroll.get_branch_table(parent.cfid).get_branch(branch);
  }
  get_branches(seq, ret){ // XXX: optimize + test
    ret = ret||[];
    this.avl.range({seq: 0}, {seq}, node=>{
      let bo = node.key;
      if (bo.branch)
        ret.push(bo.branch);
    });
    let {scroll, cfid} = this, {parent} = scroll.conflict.get(cfid);
    if (!parent)
      return ret;
    scroll.get_branch_table(parent.cfid).get_branches(seq, ret);
    return ret;
  }
  get_branch_top(branch){ // XXX: need test
    let bo = this.get_branch(branch);
    if (!bo)
      return;
    return this.get_bseq_top(bo.bseq);
  }
  get_bseq_top(bseq){ // XXX: need test
    let top = this.bseqb_top.get(bseq_branch(bseq));
    if (top)
      return top;
    let {scroll, cfid} = this, {parent} = scroll.conflict.get(cfid);
    if (!parent)
      return;
    return scroll.get_branch_table(parent.cfid).get_bseq_top(bseq);
  }
  get_bo(seq){
    for (let n = this.avl._root; n; n = seq < n.key.seq ? n.left : n.right){
      let bo = n.key;
      if (bo.seq<=seq && seq<bo.seq+bo.size)
        return bo;
    }
  }
  get_bseq(seq){
    let bo = this.get_bo(seq);
    if (!bo)
      return null;
    return bseq_inc(bo.bseq, bo.size-(bo.seq-seq)-1);
  }
  find_avail_branch(bseq){
    let {scroll, cfid} = this, {parent} = scroll.conflict.get(cfid);
    if (parent){ // XXX: test this case
      bseq = scroll.get_branch_table(parent.cfid).find_avail_branch(bseq,
        parent.seq);
    }
    for (; this.branch_bseq.get(bseq); bseq = bseq_branch_inc(bseq));
    return bseq;
  }
  add(opt){
    let {branch, seq, bseq} = opt, bo, bo_next;
    branch = branch||null;
    assert(Number.isInteger(seq) && seq>=0, 'invalid seq '+seq);
    assert(bseq_valid(bseq), 'invalid bseq '+bseq);
    bo = this.get_bo(seq);
    if (bo){
      assert(bseq_cmp(bseq, bseq_inc(bo.bseq, bo.size))<0, 'bseq mismatch');
      assert(bo.seq+bo.size-seq>0, 'bo mismatch');
      return;
    }
    // try to merge with prev bo
    bo = this.get_bo(seq-1);
    if (bo && bseq_branch_eq(bseq, bo.bseq)){
      if (bo.seq<=seq && seq<bo.seq+bo.size)
        return;
      assert.equal(bo.seq+bo.size, seq, 'branch corruption');
      bo.size++;
      this._update_top(bseq, seq); // XXX: need test
      this._schedule_mod(bo.seq);
      bo_next = this.get_bo(seq+1);
      this._merge(bo, bo_next);
      return;
    }
    // try to merge with next bo
    bo_next = this.get_bo(seq+1);
    if (bo_next && bseq_branch_eq(bseq, bo_next.bseq)){
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
    if ((branch || this.cfid==0) && !this.branch_name.get(branch))
      this.branch_name.set(branch, bo);
    this._insert(bo);
    this._update_top(bseq, seq); // XXX: need test
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
    if (!bo_next || !bseq_branch_eq(bo.bseq, bo_next.bseq))
      return;
    assert.equal(bseq_inc(bo.bseq, bo.size), bo_next.bseq,
      'branch merge mismatch');
    bo.size += bo_next.size;
    this._remove(bo_next);
    this._schedule_mod(bo.seq);
    this._schedule_rm(bo_next.seq);
  }
  _update_top(bseq, seq){ // XXX: need test
    let bseqb = bseq_branch(bseq);
    let top = this.bseqb_top.get(bseqb);
    if (top?.seq>=seq)
      return;
    this.bseqb_top.set(bseqb, {seq, bseq});
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
    branch = branch||null;
    let bo = branch ? {branch, seq, bseq, size} : {seq, bseq, size};
    this._insert(bo);
    if (branch || this.cfid==0)
      this.branch_name.set(branch, bo);
  }
}

function bint(num){
  assert(Number.isInteger(num) && num>=0, 'invalid num '+num);
  let s = '';
  for (let i=10; i<=num; i*=10, s += '_');
  return s+num;
}

function bint2int(s){
  assert(bint_valid(s), 'invalid bint '+s);
  let num, i;
  for (i=0; s[i]=='_'; i++);
  num = +s.substr(i);
  return i<s.length && Number.isInteger(num) ? num : undefined;
}

function bint_valid(s){
  if (s=='0')
    return true;
  let m = s.match(/^(_*)([1-9]\d*)$/);
  if (!m)
    return false;
  return m[2] && m[1].length==m[2].length-1;
}

function bseq_inc(a, n=1){
  let m = a.match(/^([\d.\-_]*\.)?([_]*[\d]+)$/);
  assert(m[2], 'invalid br '+a);
  let num = bint2int(m[2]);
  return (m[1]||'')+bint(num+n);
}

function bseq_cmp(a, b){ return a==b ? 0 : a<b ? -1 : 1; }

function bseq_branch_new(a){ return a+'-1.0'; }

function bseq_branch_inc(a){
  let m = a.match(/^([\d.\-_]+)-([_]*[\d]+)\.0$/);
  assert(m?.[1] && m?.[2], 'invalid br '+a);
  return m[1]+'-'+bseq_inc(m[2])+'.0';
}

function bseq_branch(bseq){
  assert(bseq_valid(bseq), 'invalid bseq '+bseq);
  return bseq.match(/^([\d.\-_]+)\.[_]*\d+$/)?.[1]||null;
}

function bseq_branch_belongs(bseq, bseq2){
  let bseqb = bseq_branch(bseq), bseqb2 = bseq_branch(bseq2);
  if (bseqb==bseqb2 && bseq<=bseq2)
    return true;
  if (!bseqb2)
    return false;
  let i = bseqb2.lastIndexOf('-');
  return bseq_branch_belongs(bseq, bseqb2.substr(0, i));
}

function bseq_branch_eq(a, b){
  let ba = bseq_branch(a);
  let bb = bseq_branch(b);
  return ba==bb;
}

function bseq_valid(s){
  let m = s.split('.');
  for (let i=0; i<m.length-1; i++){
    let mm = m[i].match(/^([_\d]*)-([_\d]*)/);
    if (!mm || !bint_valid(mm[1]) || !bint_valid(mm[2]))
      return false;
  }
  return bint_valid(m[m.length-1]);
}

Branch_table.bint = bint;
Branch_table.bint2int = bint2int;
Branch_table.bint_valid = bint_valid;
Branch_table.bseq_inc = bseq_inc;
Branch_table.bseq_cmp = bseq_cmp;
Branch_table.bseq_branch = bseq_branch;
Branch_table.bseq_branch_belongs = bseq_branch_belongs;
Branch_table.bseq_branch_new = bseq_branch_new;
Branch_table.bseq_branch_inc = bseq_branch_inc;
Branch_table.bseq_branch_eq = bseq_branch_eq;
Branch_table.bseq_valid = bseq_valid;

// XXX derry:
// XXX: change default hash to sha256 instead of blake
// XXX: check with derry etask.ps() of decl->sign
