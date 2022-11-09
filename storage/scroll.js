// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import {EventEmitter} from 'events';
import crypto from '../util/crypto.js';
import xerr from '../util/xerr.js';
import enc from 'compact-encoding';
import {Buffer} from 'buffer';
import buf_util from '../peer-relay/buf_util.js';
import {r_fix, r_parent, r_eq, r_includes, r_str, r_split} from './range.js';
const b2s = buf_util.buf_to_str, beq = buf_util.buf_eq;
const stringify = JSON.stringify.bind(JSON);
// https://en.wikipedia.org/wiki/Merkle_tree#Second_preimage_attack
const LEAF_TYPE = enc_u64(0), PARENT_TYPE = enc_u64(1), ROOT_TYPE = enc_u64(2);
function enc_u64(v){ return enc.encode(enc.uint64, v); }

function to_frame(o){
  if (Buffer.isBuffer(o))
    return {buf: o};
  if (typeof o=='object')
    return {buf: Buffer.from(stringify(o))};
  if (typeof o=='string')
    return {buf: Buffer.from(o)};
  assert.fail('invalid frame data '+o);
}

class Data extends EventEmitter {
  constructor(opt={}){
    super();
    this.bmap = new Map();
    let fbuf = new Frame_buffer(opt);
    fbuf.on('hash', this.on_hash);
    fbuf.map_info = {_: this, b: 0};
    this.bmap.set(0, fbuf);
  }
  on_hash(){ this.map_info._.emit('hash', {b: this.map_info.b}); }
  get(b){
    assert(b>=0, 'invalid b'+b);
    let fbuf = this.bmap.get(b);
    if (fbuf)
      return fbuf;
    fbuf = new Frame_buffer();
    fbuf.map_info = {_: this, b};
    fbuf.on('hash', this.on_hash);
    this.bmap.set(b, fbuf);
    return fbuf;
  }
  copy(bdst, bsrc){
    let fsrc = this.get(bsrc);
    let fdst = this.get(bdst);
    assert.equal(fsrc.map_info.b, bsrc);
    assert.equal(fdst.map_info.b, bdst);
    // XXX: support merge of data (and add test)
    assert(!fdst.h && !fdst.frames.length, 'XXX TODO');
    fdst.h = fsrc.h;
    fdst.frames = fsrc.frames;
    this.bmap.delete(bsrc);
  }
}

class Frame_buffer extends EventEmitter {
  constructor(opt={}){
    super();
    let {frames} = opt;
    this.frames = [];
    for (let i=0; i<frames?.length; i++)
      this.frames.push(to_frame(frames[i]));
  }
  unshift(o){ this.frames.unshift(to_frame(o)); }
  get_hash(opt={}){
    if (this.h)
      return this.h;
    return this.set_hash(Frame_buffer.calc_hash(this.frames,
      {safe: true, skip: opt.skip}));
  }
  get_frames(){ return Array.from(this.frames); }
  set_frames(frames){
    let offset=0;
    if (this.frames[0]?.sig)
      offset = 1;
    for (let i=0; i<frames.length; i++){
      let f = frames[i];
      let ii = i+offset;
      if (!this.frames[ii]){
        this.frames.push(f);
        continue;
      }
      if (this.frames[ii]?.buf && frames[i]?.buf &&
        this.frames[ii].buf.equals(frames[i].buf)){
        continue;
      }
      assert.fail('XXX TODO - support partial update of frames');
    }
    this.get_hash();
  }
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    if (this.h = h)
      this.emit('hash');
    return h;
  }
}

Frame_buffer.calc_hash = function(frames, opt={}){
  let buf;
  if (!frames.length)
    return null;
  let {safe, skip} = opt;
  // XXX: we assume first frame is sig (need way to verify it)
  for (let i=skip===undefined ? 1 : skip; i<frames.length; i++){
    let f = frames[i];
    if (safe){
      if (!f.h && !f.buf)
        return null;
    } else if (!f.buf)
        return null;
    if (!f.h)
      f.h = crypto.blake2b(f.buf);
    buf = buf ? Buffer.concat([buf, f.h]) : f.h;
  }
  if (!buf)
    return null;
  return crypto.blake2b(buf);
};

function hconcat(a){ return crypto.blake2b(Buffer.concat(a)); }
function hconcat_safe(a){
  if (a.findIndex(o=>!o)!=-1)
    return null;
  return hconcat(a);
}
function hparent(size, left, right){
  return hconcat([PARENT_TYPE, enc_u64(size), left, right]); }
function hparent_safe(size, left, right){
  return left && right ? hparent(size, left, right) : null; }
function hleaf(h, sig){ return hconcat([LEAF_TYPE, h, sig]); }


function get_d_hash(data, seq){ return data[seq]?.d; }
function get_D(data, seq){ return data[seq]?.D; }
function set_d(data, seq, d, D){
  let o = data[seq] = data[seq]||{};
  assert(!o.d || o.d.equals(d), 'set d'+seq+' diffent vals');
  if (d)
    o.d = d;
  if (D)
    o.D = D;
  return data;
}
function calc_D_hash(D){
  if (!D)
    return;
  return Frame_buffer.calc_hash(D);
}

// XXX: sig need to be part of data
function get_sig(data, seq){ return data[seq]?.sig; }
function set_sig(data, seq, val){
  let o = data[seq] = data[seq]||{};
  assert(!o.sig || o.sig.equals(val), 'set sig'+seq+' diffent vals');
  return o.sig = val;
}

function get_m_hash(data, r, use_d_sig){
  r = r_fix(r);
  let m = data[r[1]]?.m;
  m = m && m[r[0]] || null;
  if (m || !use_d_sig || r[0]!=r[1])
    return m;
  let D, d = get_d_hash(data, r[1]);
  let sig = get_sig(data, r[1]);
  if (!d && (D=get_D(data, r[1])))
    d = calc_D_hash(D);
  return d && sig ? hleaf(d, sig) : null;
}

function set_m_hash(data, r, val){
  r = r_fix(r);
  let o = data[r[1]] = data[r[1]]||{};
  o.m = o.m||{};
  assert(!o.m[r[0]] || o.m[r[0]].equals(val), 'set m'+r_str(r)+
    ' differnt vals');
  return o.m[r[0]] = val;
}

function check_set_sig(sketch, errors, seq, m, d, D, sig){
  if (!d && !sig)
    return;
  if (!d)
    return push_error(errors, 'missing d'+seq);
  if (!sig)
    return push_error(errors, 'missing sig'+seq);
  if (!beq(m, hleaf(d, sig))){
    push_error(errors, 'invalid sig'+seq);
    return {branch: true};
  }
  set_sig(sketch, seq, sig);
  set_d(sketch, seq, d, D);
}

function push_error(errors, s){ errors[s] = (errors[s]||0)+1; }
function copy_errors(dst, src){
  for (let e in src)
    push_error(dst, e);
}

function seq_merkel_array_size(seq){
  let n=1;
  for (let i=1; seq&i; i*=2, n++);
  return n;
}

function merkel_ranges(seq){
  let a = [[seq, seq]];
  for (let i=1, s=seq-i; seq&i; i*=2, s-=i)
    a.push([s, seq]);
  return a;
}

function merkel_array_pos(range){
  range = r_fix(range);
  return seq_merkel_array_size(range[1]-range[0])-1;
}

function calc_roots(size){
  let roots = [];
  for (let n=1, s=0; s+n<=size;){
    if (s+n==size){
      roots.push([s, s+n-1]);
      return roots;
    }
    if (s+2*n-1 < size){
      n *= 2;
      continue;
    }
    roots.push([s, s+n-1]);
    [s, n] = [s+n, 1];
  }
}

function calc_merge_info(seq){
  let all = calc_roots(seq+1);
  let last = all[all.length-1][1];
  let any = [];
  let curr = r_parent(all[0]).right;
  while (true){
    if (last < curr[0]){
      any.unshift(curr);
      if (curr[0]==curr[1])
        break;
      [curr] = r_split(curr);
      continue;
    }
    if (curr[0]==curr[1])
      break;
    let [r1, r2] = r_split(curr);
    if (last < r1[1])
      curr = r1;
    else
      curr = r2;
  }
  return {seq, all, any};
}

function verify_sig(sig, pub, d, M_prev){
  let buf = M_prev ? Buffer.concat([d, M_prev]) : d;
  return crypto.verify(sig, pub, crypto.blake2b(buf));
}

function is_null(val, errors, err){
  if (val)
    return false;
  push_error(errors, err);
  return true;
}

function is_m_valid(m, d, sig, errors, err){
  if (beq(m, hleaf(d, sig)))
    return true;
  push_error(errors, err);
  return false;
}

function get_one(){
  let o = this[Symbol.iterator]().next();
  return o ? o.value[0] : undefined;
}

export default class Scroll extends EventEmitter {
  constructor(opt){
    super();
    assert(opt.pub, 'missing pub key');
    this.pub = opt.pub;
    this.key = opt.key;
    this.crypt = opt.crypt||Scroll.supported_crypt[0];
    assert.deepEqual(this.crypt, Scroll.supported_crypt[0], 'unsupported');
    this.prev_scroll = opt.prev_scroll;
    this.dmap = new Map();
    this.branch = new Map();
    this.branch.next_id = 0;
    this.merge_queue = new Map;
    this.merge_queue.get_one = get_one;
    this.create_new_branch();
  }
  create_new_branch(opt={}){
    let {b, seq} = opt;
    let bid = this.branch.next_id++;
    if (b===undefined || seq===undefined){
      assert(b===undefined && seq===undefined, 'invalid create_new_branch');
      assert.equal(bid, 0);
      this.branch.set(bid, {b: bid, top: null, branches: new Map()});
      return bid;
    }
    let M = this.get_decl(seq).M_hash(b);
    assert(M, 'missing M'+seq);
    this.branch.set(bid, {b: bid, top: null, parent: {b, seq, type: 'v'},
      branches: new Map()});
    this.notify_M({b: bid, seq: seq, M});
    return bid;
  }
  to_b(b, seq){
    assert(typeof seq=='number' && seq>=0, 'invalid seq '+seq);
    assert(this.branch.get(b), 'missing branch '+seq+'b'+b);
    for (let parent; (parent = this.branch.get(b).parent) &&
      parent?.b!==undefined && seq<=parent?.seq;
      b = parent.b);
    return b;
  }
  decl(b, frames){ // XXX: test decl on branch
    if (frames===undefined)
      [b, frames] = [0, b];
    let ts = Date.now(), data = new Data({frames});
    let top = this.branch.get(b).top, seq = top ? top.seq+1 : 0;
    data.get(b).unshift({seq, ts});
    let decl = new Decl({scroll: this, seq, data});
    this.dmap.set(seq, decl);
    decl.init();
    decl.sign(b);
    decl.M.get_hash(b); // XXX: rm
    return decl;
  }
  notify_M(opt){
    let {b, seq, M} = opt;
    if (!this.branch.get(b).top || this.branch.get(b).top.seq<seq){
      this.branch.get(b).top = {seq, M};
      assert.equal(b2s(M), b2s(this.M_hash(b, this.branch.get(b).top.seq)),
        'invalid M'+seq+'b'+b);
    }
  }
  put(diff){
    let errors = {}, max_common;
    if (diff[0]) // XXX HACK: for case where we have only M0 (no mo)
      this.put_single(0, diff, errors);
    let a = Object.keys(diff);
    for (let i=a.length-1; i>=0 && +a[i]; i--){
      let seq = +a[i], errors2={}, best = {b: 0, max_common: 0};
      // XXX: optimize, use !mergeable logic from merge_single and also
      // take into account all
      if (this.branch.size>1){
        for (const [j, branch] of this.branch){
          // XXX: optimize with {min_common} based on previous best branch
          max_common = this.find_max_common_M({b: j, seq, diff});
          let top = branch.top.seq;
          if (best.max_common < max_common ||
            best.max_common==max_common && best.top < top){
            best = {b: j, max_common, top};
          }
        }
      }
      let b = best.b, ret = this.put_single(seq, diff, errors2, {b});
      if (ret?.branch){
        max_common = best.max_common || this.find_max_common_M({b, seq, diff});
        if (max_common!==undefined){
          errors2 = {};
          let b2 = this.create_new_branch({b, seq: max_common});
          ret = this.put_single(seq, diff, errors, {b: b2});
          if (ret?.branch || this.branch.get(b2).top.seq<=max_common){
            this.branch.delete(b2);
            continue;
          }
          b = b2;
          this.branch_update(b, {init: true});
        }
      }
      this.merge_all(seq, b);
      copy_errors(errors, errors2);
    }
    return {errors};
  }
  put_single(seq, diff, errors, opt={}){
    let ret = this._put_single(seq, diff, errors, opt);
    if (ret?.branch)
      return ret;
    if (!diff[seq]?.m)
      return;
    let decl=this.get_decl(seq), a=Object.keys(diff[seq].m);
    let max_range = decl.m[decl.m.length-1].range;
    for (let i=0; i<a.length; i++)
      this.copy_extra_m(diff[seq].m[a[i]], [+a[i], seq], max_range, diff, opt);
  }
  copy_extra_m(m, range, max_range, diff, opt){
    let b=opt.b||0, vm = this.m_hash(b, range);
    if (vm)
      return vm.equals(m);
    if (r_eq(range, max_range))
      return false;
    let po = r_parent(range), sketch={}, errors={}, m2;
    let r2 = r_eq(range, po.left) ? po.right : po.left;
    if (!(m2 = this.sketch_calc_m({b, range: r2, sketch, diff, errors})))
      return false;
    let mp = hparent(po.parent[1]-po.parent[0]+1, r_eq(range, po.left) ?
      m : m2, r_eq(range, po.left) ? m2 : m);
    if (!this.copy_extra_m(mp, po.parent, max_range, diff, opt))
      return false;
    set_m_hash(sketch, range, m);
    this.put_verified(sketch, {b});
  }
  _put_single(seq, diff, errors, opt={}){
    let b=opt.b||0;
    let top = this.branch.get(b).top, sketch = {};
    let decl=this.get_decl(seq), m=get_m_hash(diff, seq);
    let D=get_D(diff, seq);
    let sig=get_sig(diff, seq), d=get_d_hash(diff, seq), dD=calc_D_hash(D);
    let vm=decl.m_hash(b, seq), vsig=decl.sig_get(b), vd=decl.d_hash(b);
    if (dD){
      if (vd){
        if (!beq(dD, vd)){
          push_error(errors, 'invalid D'+seq);
          dD = null;
        } else
          this.put_verified(set_d({}, seq, null, D), {b});
      }
      if (d && !beq(dD, d)){
        push_error(errors, 'invalid D'+seq);
        dD = D = null;
      } else
        d = dD;
    }
    if (vd && vsig){
      let branch;
      if (sig && !beq(sig, vsig)){
        push_error(errors, 'invalid sig'+seq);
        branch = true;
      }
      if (d && !beq(d, vd))
        push_error(errors, 'invalid d'+seq);
      if (m && !beq(m, vm))
        push_error(errors, 'invalid m'+seq);
      return seq && branch ? {branch} : undefined;
    }
    if (d && !sig)
      push_error(errors, 'missing sig'+seq);
    if (sig && !d)
      push_error(errors, 'missing d'+seq);
    if (sig && d)
      m = m||hleaf(d, sig);
    if (vm){
      let ret = check_set_sig(sketch, errors, seq, vm, d, D, sig);
      this.put_verified(sketch, {b});
      return ret;
    }
    if (!m)
      return;
    if (seq<=top.seq){ // verify m belongs to existing top.M
      let M = this.sketch_calc_top_M({top, force: {range: [seq, seq], m},
        sketch, diff, errors, b});
      if (!M)
        return {branch: true};
      if (!beq(M, top.M)){
        push_error(errors, 'invalid M'+top.seq);
        return {branch: true}; // XXX: need test
      }
      check_set_sig(sketch, errors, seq, m, d, D, sig);
      this.put_verified(sketch, {b});
      return;
    }
    // new top
    if (!sig || !d)
      return push_error(errors, 'missing '+(sig ? 'd' : 'sig')+seq);
    if (!is_m_valid(m, d, sig, errors, 'invalid sig'+seq))
      return;
    let prev_top = this.get_decl(top.seq);
    let prev_top_r = prev_top.m[prev_top.m.length-1].range;
    let prev_force = {range: prev_top_r, m: prev_top.m_hash(b, prev_top_r)};
    if (is_null(prev_force.m, errors, 'missing m'+r_str(prev_top_r)))
      return;
    let prev_M = this.sketch_calc_top_M({top: {seq: seq-1},
      force: prev_force, sketch, diff, errors, b});
    if (is_null(prev_M, errors, 'missing M'+(seq-1)))
      return {branch: true};
    if (!verify_sig(sig, this.pub, d, prev_M))
      return push_error(errors, 'invalid sig'+seq);
    set_sig(sketch, seq, sig);
    check_set_sig(sketch, errors, seq, m, d, D, sig);
    if (vsig && !vsig.equals(sig))
      return {branch: true};
    this.put_verified(sketch, {b});
    this.M_hash(b, seq); // update new top
  }
  sketch_calc_top_M(opt){
    let {b, top, force, sketch, diff, errors} = opt, {range} = force;
    let seq = force.range[1];
    assert(seq<=top.seq, 'top over seq');
    let roots = calc_roots(top.seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i], mr;
      mr = this.sketch_calc_m({b, range: r, sketch, diff, errors, force:
        r_includes(r, range) ? force : null});
      if (is_null(mr, errors, 'missing m'+r_str(r)))
        return null;
      a.push(mr, enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat(a);
  }
  sketch_calc_m(opt){
    let {b, range, sketch, diff, errors, force} = opt;
    if (force && r_eq(range, force.range))
      return set_m_hash(sketch, range, force.m);
    let seq = range[1], decl = this.get_decl(seq);
    let m = get_m_hash(diff, range), vm = decl.m_hash(b, range);
    if ((vm||m) && (!force || !r_includes(range, force.range))){
      if (m && !vm)
        set_m_hash(sketch, range, m);
      return vm||m;
    }
    if (range[0]==range[1]){
      assert(!m);
      let d = get_d_hash(diff, seq), sig = get_sig(diff, seq);
      if (is_null(d&&sig, errors, 'missing m'+r_str(range)))
        return null;
      return set_m_hash(sketch, seq, hleaf(d, sig));
    }
    let [r1, r2] = r_split(range);
    let m1, vm1, m2, vm2, decl1 = this.get_decl(r1[1]), decl2=decl;
    if (force && r_includes(r1, force.range))
      m1 = this.sketch_calc_m({b, range: r1, sketch, diff, errors, force});
    else if (vm1 = decl1.m_hash(b, r1));
    else if (m1 = get_m_hash(sketch, r1)||get_m_hash(diff, r1));
    else if (m1 = this.sketch_calc_m({b, range: r1, sketch, diff, errors}));
    if (is_null(m1||vm1, errors, 'missing m'+r_str(r1)))
      return null;
    if (force && r_includes(r2, force.range))
      m2 = this.sketch_calc_m({b, range: r2, sketch, diff, errors, force});
    else if (vm2 = decl2.m_hash(b, r2));
    else if (m2 = get_m_hash(sketch, r2)||get_m_hash(diff, r2));
    else if (m2 = this.sketch_calc_m({b, range: r2, sketch, diff, errors}));
    if (is_null(m2||vm2, errors, 'missing m'+r_str(r2)))
      return null;
    if (m1)
      set_m_hash(sketch, r1, m1);
    if (m2)
      set_m_hash(sketch, r2, m2);
    m = hparent(range[1]-range[0]+1, vm1||m1, vm2||m2);
    set_m_hash(sketch, range, m);
    return m;
  }
  find_max_common_M(opt){
    // XXX: optimization: take into account all from calc_merge_info?
    let {b, seq, diff, diff_b, common} = opt, roots = calc_roots(seq+1), ret;
    for (let i=0; i<roots.length; i++){
      let r = roots[i], max;
      max = r[1]<=common ? {range: r} :
        this.find_max_common_m({b, range: r, diff, diff_b, common});
      if (!max)
        break;
      if (r_eq(r, max.range)){
        ret = max.range[1];
        continue;
      }
      // XXX: optimize, we now by now that we have max.range[1]
      let max2 = this.find_max_common_M({b, seq: r[1]-1, diff, diff_b,
        common});
      return max2 ? max2 : max.range[1];
    }
    return ret;
  }
  find_max_common_m(opt){
    // XXX: need sketch to cache results
    let {b, range, diff, diff_b, common} = opt;
    let seq = range[1], decl = this.get_decl(seq);
    let vm = decl.m_hash(b, range);
    if (vm && seq<=common)
      return {range, m};
    let m = this.calc_m({range, diff, diff_b});
    if (vm && m && vm.equals(m))
      return {range, m};
    if (range[0]==range[1])
      return null;
    let [r1, r2] = r_split(range);
    let m1, vm1, m2, vm2, decl1 = this.get_decl(r1[1]), decl2=decl;
    vm1 = decl1.m_hash(b, r1);
    vm2 = decl2.m_hash(b, r2);
    if (!vm1)
      return this.find_max_common_m({b, range: r1, diff, diff_b});
    m1 = this.calc_m({range: r1, diff, diff_b});
    if (!m1 || !vm1.equals(m1)){
      let max1 = this.find_max_common_m({b, range: r1, diff, diff_b});
      if (!max1)
        return null;
      if (!r_eq(r1, max1.range))
        return max1;
      m1 = max1.m;
    }
    if (!vm2)
      return {range: r1, m: m1};
    m2 = this.calc_m({range: r2, diff, diff_b});
    if (!m2 || !vm2.equals(m2)){
      let max2 = this.find_max_common_m({b, range: r2, diff, diff_b});
      if (!max2)
        return {range: r1, m: m1};
      // XXX maybe return r1+max2.range and optimize find_max_common_M
      if (!r_eq(r2, max2.range))
        return {range: r1, m: m1};
      m2 = max2.m;
    }
    assert(vm, 'vm must exists');
    assert(!m, 'm does not exists');
    return {range, m: vm};
  }
  merge_all(seq, b){
    if (this.branch.size<=1)
      return;
    while (this.merge_queue.size){
      let bb = this.merge_queue.get_one(), b_o = this.branch.get(bb);
      this.merge_single(b_o.minfo.merge_queue.get_one(), bb, seq);
    }
    // XXX: can we improve and avoid traverssing all branches
    for (const [i, b_o] of this.branch){
      if (i && b_o.parent?.type!='b' && b_o.minfo.real_map.get(b_o.parent?.b))
        this.merge_single(b_o.parent.b, i, seq);
    }
  }
  merge_single(i1, i2, seq){
    // XXX: test all merge of data. verify we don't lose anything
    // (for eg, one branch has d/sig other only hash)
    assert(i1<i2, 'invalid branch merge '+i1+' '+i2);
    let b1=this.branch.get(i1), b2=this.branch.get(i2), bseq;
    let mergeable = b2.minfo.merge_queue.get(i1);
    let real_branch = b2.minfo.real_map.get(i1);
    if (b2.parent?.seq >= seq)
      return assert(!mergeable && real_branch);
    if (b2.parent?.seq >= b1.top.seq)
      return assert(!mergeable && real_branch);
    if (!mergeable){
      if (real_branch && b2.parent?.b==i1)
        this.branch_update(i2, {type: real_branch ? 'b' : 'v'});
      return;
    }
    // XXX: to calc common, check also if branch is not direct child
    bseq = this.find_max_common_M({b: i1, diff_b: i2, seq,
      common: b2.parent?.b==b1.parent?.b ? b2.parent?.seq : undefined});
    assert((b1.parent?.b||0)<i2, 'lower b'+i1+' cannot point upper b'+i2);
    if (b2.parent?.seq >= bseq)
      return xerr('need optimize merge');
    this.branch_update(i2, {b: i1, seq: bseq, type: real_branch ? 'b' : 'v'});
    if (b2.top.seq!=bseq && b1.top.seq!=bseq)
      return;
    // merge
    // XXX: need more efficient way (just iterate on decl with data)
    for (let i=b1.top.seq+1; i<=b2.top.seq; i++){
      let src = this.get_decl(i, {create: false});
      if (src)
        src.copy(i1, i2);
    }
    if (b2.top.seq > b1.top.seq)
      this.notify_M({b: i1, seq: b2.top.seq, M: b2.top.M});
    this.branch_remove(i2, i1);
    return {curr: i1, prev: i2};
  }
  branch_remove(i2, i1){
    assert(i2, 'cannot remove branch 0');
    assert(i1>=0, 'must provide new branch');
    assert(i1<i2, 'new branch must be smaller');
    let b2 = this.branch.get(i2);
    this.branch.get(b2.parent.b).branches.delete(i2);
    for (const [i] of b2.branches)
      this.branch_update(i, {b: i1});
    this.branch.delete(i2);
    this.emit('branch-removed', {b: i2, b_new: i1});
  }
  branch_update(b, o){
    // XXX: need to rm uneeded decl now when updating branches and update all
    // relevant places on new branch
    assert(o.b!=b, 'branch loop '+b);
    let src = this.branch.get(b);
    assert.equal(src.b, b, 'branch corruption '+b);
    assert(src.parent?.type, 'missing branch type');
    if (o.init){
      assert(o.b===undefined && o.seq===undefined, 'invalid init');
      assert(!src.info, 'invalid init');
      this.update_mergeable(src.b);
      return;
    }
    if (src.b==o.b && src.seq==o.sec)
      return;
    if (o.b!==undefined){
      assert(src.parent!==o.b || o.type===undefined || src.parent?.type!='b' ||
        o.type=='b', 'real branch type change b'+src.b);
      this.branch.get(src.parent?.b).branches.delete(src.b);
      src.parent.b = o.b;
    }
    if (o.seq!==undefined)
      src.parent.seq = o.seq;
    if (o.type!==undefined){
      assert(['v', 'b'].includes(o.type), 'invalid branch type '+o.type);
      assert(o.b || src.parent?.type!='b' || o.type=='b',
        'real branch type change b'+src.b);
      src.parent.type = o.type;
    }
    this.update_mergeable(src.b);
  }
  update_mergeable(b){
    assert(b>0, 'invalid branch');
    let b_o = this.branch.get(b), p_o = this.branch.get(b_o.parent?.b);
    if (!p_o.branches.get(b))
      p_o.branches.set(b, b_o);
    assert.equal(p_o.branches.get(b), b_o, 'branch corruption '+b);
    if (b_o.minfo && b_o.minfo.parent?.b==b_o.parent?.b &&
      b_o.minfo.parent?.seq==b_o.parent?.seq){
      return;
    }
    if (b_o.minfo)
      b_o.minfo.cleanup();
    let any = calc_merge_info(b_o.parent?.seq).any;
    // XXX: maybe we can reuse some of merge_queue & real_map
    b_o.minfo = {any, merge_queue: new Map, real_map: new Map,
      parent: {b: b_o.parent?.b, seq: b_o.parent?.seq}};
    b_o.minfo.merge_queue.get_one = get_one;
    b_o.minfo.cleanup = opt=>{
      if (opt && opt.b!=b)
        return;
      let any = b_o.minfo.any;
      for (let r, m, i=0; i<any.length&&(r = any[i])&&(m=this.m_get(r)); i++)
        m.off('hash', b_o.minfo.on_hash);
      this.off('branch-removed', b_o.minfo.cleanup);
      this.merge_queue.delete(b);
    };
    const update_merge_queue = (r, bb)=>{
      if (b_o.minfo.merge_queue.get(bb))
        return;
      let m1, m2;
      if ((m1=this.m_hash(b, r)) && (m2=this.m_hash(bb, r))){
        if (!m1.equals(m2))
          return b_o.minfo.real_map.set(bb, true);
        b_o.minfo.merge_queue.set(bb, true);
        this.merge_queue.set(b, true);
      }
    };
    b_o.minfo.on_hash = opt=>{
      let r = opt.range, bb = opt.b;
      if (bb<b)
        update_merge_queue(r, bb);
      if (bb!=b)
        return;
      for (const [j] of this.branch){ // XXX: can we skip obvious ones
        if (j<b)
          update_merge_queue(r, j);
      }
    };
    this.on('branch-removed', b_o.minfo.cleanup);
    for (let i=0; i<any.length; i++){
      let r = any[i], m=this.m_get(r);
      m.on('hash', b_o.minfo.on_hash);
      b_o.minfo.on_hash({range: r, b: b});
    }
  }
  calc_m(opt){
    let {range, diff, diff_b} = opt;
    let m = diff ? get_m_hash(diff, range, true) :
      this.m_hash(diff_b, range);
    if (m)
      return m;
    if (range[0]==range[1])
      return null;
    let [r1, r2] = r_split(range);
    let m1 = this.calc_m({range: r1, diff, diff_b});
    if (!m1)
      return null;
    let m2 = this.calc_m({range: r2, diff, diff_b});
    if (!m2)
      return null;
    return hparent(range[1]-range[0]+1, m1, m2);
  }
  put_verified(verified, opt={}){
    let b=0;
    if (opt.b!==undefined)
      b = opt.b;
    for (let seq in verified){
      seq = +seq;
      let v = verified[seq], decl = this.get_decl(seq);
      for (let type in v){
        let val = v[type];
        switch (type){
        case 'sig': decl.sig_set(b, val); break;
        case 'd': decl.fbuf_get(b).set_hash(val); break;
        case 'D': decl.fbuf_get(b).set_frames(val); break;
        case 'M': decl.M.set_hash(b, val); break;
        case 'm':
          for (let s in val)
            decl.m_get([+s, +seq]).set_hash(b, val[s]);
          break;
        default: assert.fail('invalid verified type '+type);
        }
      }
    }
  }
  calc_root_hash(seq, opt){
    let roots=calc_roots(seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i], h = this.m_hash(opt.b, r);
      if (!h) // XXX: rm, call api only if possible to calc
        return;
      assert(h, 'cannot calc root');
      a.push(h, enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat_safe(a);
  }
  seq_sig(b, seq){
    let decl = this.get_decl(seq);
    if (decl)
      return decl.sig_get(b);
  }
  seq_d(b, seq){ return this.get_decl(seq).d_hash(b); }
  seq_D(b, seq){ return this.get_decl(seq).fbuf_get(b).get_frames(); }
  m_hash(b, range){
    let [, e] = range = r_fix(range);
    let decl = this.get_decl(e);
    return decl.m_hash(b||0, range);
  }
  m_get(range){
    let [, e] = range = r_fix(range);
    let decl = this.get_decl(e);
    return decl.m_get(range);
  }
  M_hash(b, seq){
    let decl = this.get_decl(seq);
    return decl ? decl.M_hash(b||0) : null;
  }
  get_decl(seq, opt={}){
    assert(typeof seq=='number', 'invalid seq '+seq);
    let decl = this.dmap.get(seq);
    if (decl || opt.create===false)
      return decl;
    decl = new Decl({scroll: this, seq, data: new Data});
    this.dmap.set(seq, decl);
    decl.init();
    return decl;
  }
}

class Decl extends EventEmitter {
  constructor(opt){
    super();
    assert(opt.seq>=0, 'must provide Decl seq');
    assert(opt.scroll.branch.get(opt.b||0), 'branch '+opt.b+' not found');
    assert(opt.data instanceof Data, 'invalid data '+opt.data);
    this.scroll = opt.scroll;
    this.seq = opt.seq;
    this.data = opt.data;
    this.m = [];
    for (let i=0, ma=merkel_ranges(this.seq); i<ma.length; i++)
      this.m.push(new Merkel_node({decl: this, range: ma[i]}));
    this.M = new Merkel_root({decl: this});
  }
  init(){
    // XXX: rm and make sure init is called only once
    if (this.inited)
      return;
    this.inited = true;
    for (let i=0; i<this.m.length; i++)
      this.m[i].init();
  }
  to_b(b){ return this.scroll.to_b(b, this.seq); }
  sign(b){
    let scroll = this.scroll, d = this.fbuf_get(b).get_hash({skip: 0});
    assert(scroll.key, 'cannot sign without key');
    let buf = this.seq ? Buffer.concat([d, scroll.M_hash(b, this.seq-1)])
      : scroll.prev_scroll ? Buffer.concat([d, scroll.prev_scroll]) : d;
    let sig = crypto.sign(crypto.blake2b(buf), scroll.key);
    this.sig_set(b, sig);
  }
  sig_set(b, sig){
    this.fbuf_get(b).unshift({sig});
    this.emit('sig', {b}); // XXX: need to emit also from set_frames
    return sig;
  }
  sig_get(b){
    let frames = this.fbuf_get(b).frames;
    // XXX: find better way to access buffer as json
    if (!frames.length)
      return;
    try {
      let json = JSON.parse(frames[0].buf.toString());
      if (!json || !json.sig)
        return;
      return Buffer.from(json.sig);
    } catch(err){ xerr('sig_get error %s', err); }
  }
  fbuf_get(b){ return this.data.get(this.to_b(b)); }
  d_hash(b){ return this.fbuf_get(b).get_hash(); }
  m_get(range){
    let i = merkel_array_pos(range);
    assert.deepEqual(this.m[i].range, r_fix(range));
    return this.m[i];
  }
  m_hash(b, range){ return this.m_get(range).get_hash(b); }
  M_hash(b){ return this.M.get_hash(b); }
  copy(bdst, bsrc){
    assert(this.to_b(bdst)!=this.to_b(bsrc), 'copy same b'+bdst+'<- b'+bsrc);
    let M = this.M.get_hash(bsrc);
    if (M)
      this.M.set_hash(bdst, M);
    for (let i=0; i<this.m.length; i++){
      let m = this.m[i].get_hash(bsrc);
      if (m)
        this.m[i].set_hash(bdst, m);
    }
    this.data.copy(bdst, bsrc);
  }
}

class Merkel_node extends EventEmitter {
  constructor(opt){
    super();
    this.inited = false;
    this.range = r_fix(opt.range);
    this.decl = opt.decl;
    this.bmap = new Map();
  }
  init(){
    let decl = this.decl, scroll = decl.scroll;
    let [s, e] = this.range;
    assert(!this.inited, 'already inited');
    this.inited = true;
    // XXX: add event testing
    if (s==e){
      const on_hash = opt=>{
        let b = opt.b, d, sig;
        if ((d = decl.d_hash(b)) && (sig = decl.sig_get(b)))
          return this.set_hash(b, hleaf(d, sig));
      };
      decl.data.on('hash', on_hash);
      decl.on('sig', on_hash);
    } else {
      let [r1, r2] = r_split(this.range);
      let m1 = scroll.m_get(r1), m2 = scroll.m_get(r2);
      const on_hash_m = opt=>{
        let b = opt.b, h1, h2;
        if ((h1 = m1.get_hash(b)) && (h2 = m2.get_hash(b)))
          this.set_hash(b, hparent_safe(e-s+1, h1, h2));
      };
      m1.on('hash', on_hash_m);
      m2.on('hash', on_hash_m);
    }
  }
  get_hash(b){
    b = this.decl.to_b(b);
    return this.bmap.get(b);
  }
  set_hash(b, h){
    b = this.decl.to_b(b);
    let h_curr = this.bmap.get(b);
    if (h_curr){
      assert(h_curr.equals(h), 'hash changed');
      return h_curr;
    }
    this.bmap.set(b, h);
    if (h)
      this.emit('hash', {b, range: this.range});
    return h;
  }
}

class Merkel_root extends EventEmitter {
  constructor(opt){
    super();
    this.decl = opt.decl;
    this.scroll = opt.decl.scroll;
    this.bmap = new Map();
  }
  get_hash(b){
    b = this.decl.to_b(b);
    let h = this.bmap.get(b);
    if (h)
      return h;
    // XXX: move it to be event-driven (also do the same for Merkel_node)
    return this.set_hash(b, this.scroll.calc_root_hash(this.decl.seq, {b}));
  }
  set_hash(b, h){
    if (0) assert(h, 'invalid Merkel_root'); // XXX: enable
    b = this.decl.to_b(b);
    let h_curr = this.bmap.get(b);
    if (h_curr){
      assert(h_curr.equals(h), 'hash changed');
      return h_curr;
    }
    this.bmap.set(b, h);
    if (h){
      this.emit('hash');
      // XXX: move notify_M to listen to 'hash' event
      this.scroll.notify_M({b, seq: this.decl.seq, M: h});
    }
    return h;
  }
}

Scroll.create = function(opt, d){
  let scroll = new Scroll(opt);
  scroll.decl([{scroll: {crypt: Scroll.supported_crypt,
    pub: b2s(opt.pub), ...d}}]);
  return scroll;
};

Scroll.open = function(opt){
  let scroll = new Scroll(opt);
  assert(opt.M && /^\d+$/.test(opt.M.seq) && opt.M.h, 'scroll.open missing M');
  let decl = scroll.get_decl(opt.M.seq);
  decl.M.set_hash(0, opt.M.h);
  return scroll;
};

Scroll.supported_crypt = [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}];
Scroll.hconcat = hconcat; // XXX need test
Scroll.hconcat_safe = hconcat_safe; // XXX need test
Scroll.hparent = hparent; // XXX need test
Scroll.hparent_safe = hparent_safe; // XXX need test
Scroll.hleaf = hleaf; // XXX need test
Scroll.calc_roots = calc_roots;
Scroll.calc_merge_info = calc_merge_info;
Scroll.seq_merkel_array_size = seq_merkel_array_size;
Scroll.merkel_ranges = merkel_ranges;
Scroll.merkel_array_pos = merkel_array_pos;
Scroll.verify_sig = verify_sig;
Scroll.LEAF_TYPE = LEAF_TYPE;
Scroll.PARENT_TYPE = PARENT_TYPE;
Scroll.ROOT_TYPE = ROOT_TYPE;
