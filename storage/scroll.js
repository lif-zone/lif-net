// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import crypto from '../util/crypto.js';
import xerr from '../util/xerr.js';
import enc from 'compact-encoding';
import {Buffer} from 'buffer';
import buf_util from '../peer-relay/buf_util.js';
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

// XXX: rename to Frame_buffer;
class FrameBuffer {
  constructor(opt={}){
    let {frames} = opt;
    this.frames = [];
    for (let i=0; i<frames?.length; i++)
      this.frames.push(to_frame(frames[i]));
  }
  unshift(o){ this.frames.unshift(to_frame(o)); }
  get_hash(opt={}){
    if (this.h)
      return this.h;
    return this.set_hash(FrameBuffer.calc_hash(this.frames,
      {safe: true, skip: opt.skip}));
  }
  get_frames(){ return Array.from(this.frames); }
  set_frames(frames){
    for (let i=0; i<frames.length; i++){
      let f = frames[i];
      if (!this.frames[i]){
        this.frames.push(f);
        continue;
      }
      if (this.frames[i]?.buf && frames[i]?.buf &&
        this.frames[i].buf.equals(frames[i].buf)){
        continue;
      }
      assert.fail('XXX TODO - support partial update of frames');
    }
  }
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    return this.h = h;
  }
}

FrameBuffer.calc_hash = function(frames, opt={}){
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

// XXX: need test
function range_split(range){
  let [s, e] = range;
  assert(s!=e, 'invalid range split '+range);
  let d = (e-s+1)/2;
  assert(Number.isInteger(d), 'invalid range '+range);
  return [[s, s+d-1], [s+d, e]];
}

function range_from_str(range){
  let m = (''+range).match(/^(\d+)(_(\d+))?$/); // 10 or 10_15
  return [+m[1], m[3]!==undefined ? +m[3] : +m[1]];
}

function range_str(range){
  return range[0]==range[1] ? ''+range[1] : range[0]+'_'+range[1];
}

// XXX need test
function range_includes(r, r2){ return r2[0]>=r[0] && r2[1]<=r[1]; }

// XXX need test
function range_eq(a, b){ return a[0]==b[0] && a[1]==b[1]; }

function range_to_parent(r){
  let d = r[1]-r[0]+1;
  let p = [r[0], r[1]+d];
  if (p[0] % (2*d) != 0)
    p = [r[0]-d, r[1]];
  return {parent: p, left: [p[0], p[0]+d-1], right: [p[0]+d, p[1]]};
}

// XXX: need test
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
  return FrameBuffer.calc_hash(D);
}

// XXX: need test
function get_sig(data, seq){ return data[seq]?.sig; }
function set_sig(data, seq, val){
  let o = data[seq] = data[seq]||{};
  assert(!o.sig || o.sig.equals(val), 'set sig'+seq+' diffent vals');
  return o.sig = val;
}
// XXX: need test
function get_m_hash(data, r, use_d_sig){
  r = range_fix(r);
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
// XXX: need test
function set_m_hash(data, r, val){
  r = range_fix(r);
  let o = data[r[1]] = data[r[1]]||{};
  o.m = o.m||{};
  assert(!o.m[r[0]] || o.m[r[0]].equals(val), 'set m'+range_str(r)+
    ' diffent vals');
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

// XXX: need test
function merkel_ranges(seq){
  let a = [[seq, seq]];
  for (let i=1, s=seq-i; seq&i; i*=2, s-=i)
    a.push([s, seq]);
  return a;
}

function range_fix(range){
  assert(typeof range=='number' || Array.isArray(range), 'invalid '+range);
  if (typeof range=='number')
    return [range, range];
  if (range.length==1)
    return [range[0], range[0]];
  assert(range.length==2);
  return range;
}

function merkel_array_pos(range){
  range = range_fix(range);
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
  let curr = range_to_parent(all[0]).right;
  while (true){
    if (last < curr[0]){
      any.unshift(curr);
      if (curr[0]==curr[1])
        break;
      [curr] = range_split(curr);
      continue;
    }
    if (curr[0]==curr[1])
      break;
    let [r1, r2] = range_split(curr);
    if (last < r1[1])
      curr = r1;
    else
      curr = r2;
  }
  return {all, any};
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

export default class Scroll {
  constructor(opt){
    assert(opt.pub, 'missing pub key');
    this.pub = opt.pub;
    this.key = opt.key;
    this.crypt = opt.crypt||Scroll.supported_crypt[0];
    assert.deepEqual(this.crypt, Scroll.supported_crypt[0], 'unsupported');
    this.prev_scroll = opt.prev_scroll;
    this.b = [];
    this.create_new_branch();
  }
  create_new_branch(opt={}){
    let {b, seq} = opt;
    if (b===undefined || seq===undefined){
      assert(b===undefined && seq===undefined, 'invalid create_new_branch');
      this.b.push({b: 0, size: 0, top: null, map: new Map(), branch: {}});
      return this.b.length-1;
    }
    let M = this.get_decl(seq, {b}).M_hash();
    assert(M, 'missing M'+seq);
    this.b.push({b: this.b.length, size: 0, top: null, map: new Map(),
      branch: {b, seq}});
    let b2 = this.b.length-1;
    this.notify_M({b: b2, seq: seq, M});
    return b2;
  }
  decl(frames){ // XXX: support decl on branch
    let fbuf = new FrameBuffer({frames});
    let seq = this.b[0].size, ts = Date.now();
    assert(!this.b[0].map.get(seq), 'XXX TODO'); // XXX: support branch
    fbuf.unshift({seq, ts});
    let decl = new Decl({scroll: this, b: 0, seq, fbuf});
    decl.sign();
    this.b[0].map.set(seq, decl);
    this.b[0].size++;
    return decl;
  }
  notify_M(opt){
    let {b, seq, M} = opt;
    if (!this.b[b].top || this.b[b].top.seq<seq){
      this.b[b].top = {seq, M};
      assert.equal(b2s(M), b2s(this.M_hash(this.b[b].top.seq, {b})),
        'invalid M'+seq+'b'+b);
    }
  }
  put(diff){
    let errors = {};
    if (diff[0]) // XXX HACK: for case where we have only M0 (no mo)
      this.put_single(0, diff, errors);
    let a = Object.keys(diff);
    for (let i=a.length-1; i>=0 && +a[i]; i--){
      let seq = +a[i], errors2={}, best = {b: 0, max_common: 0};
      // XXX: optimize. do only once. and assume all diff is on the same branch
      for (let j=0; this.b.length>1 && j<this.b.length; j++){
        // XXX: optimize with {min_common} based on previous best branch
        let max_common = this.find_max_common_M({b: j, seq, diff});
        if (best.max_common < max_common)
          best = {b: j, max_common};
      }
      let b = best.b;
      let ret = this.put_single(seq, diff, errors2, {b});
      if (ret?.branch){
        let max_common = best.max_common ||
          this.find_max_common_M({b, seq, diff});
        if (max_common!==undefined){
          errors2 = {};
          let b2 = this.create_new_branch({b, seq: max_common});
          ret = this.put_single(seq, diff, errors2, {b: b2});
          copy_errors(errors, errors2);
          // XXX: find better logic
          if (ret?.branch || this.b[b2].top.seq<=max_common){
            // XXX: test this scenario
            this.b.pop();
            continue;
          }
          b = b2;
        }
      }
      // XXX: do it only if new data was added to branch (check put_verified)
      this.merge_all(seq, b);
      copy_errors(errors, errors2);
    }
    return {errors};
  }
  put_single(seq, diff, errors, opt={}){
    let ret = this._put_single(seq, diff, errors, opt);
    if (ret?.branch)
      return ret;
    // XXX: remove copy_extra_m and handle it inside put_single
    if (!diff[seq]?.m)
      return;
    let b=opt.b||0, decl=this.get_decl(seq, {b}), a=Object.keys(diff[seq].m);
    let max_range = decl.m[decl.m.length-1].range;
    for (let i=0; i<a.length; i++)
      this.copy_extra_m(diff[seq].m[a[i]], [+a[i], seq], max_range, diff, opt);
  }
  copy_extra_m(m, range, max_range, diff, opt){
    let b=opt.b||0, vm = this.m_hash(range, {b});
    if (vm)
      return vm.equals(m);
    if (range_eq(range, max_range))
      return false;
    let po = range_to_parent(range), sketch={}, errors={}, m2;
    let r2 = range_eq(range, po.left) ? po.right : po.left;
    if (!(m2 = this.sketch_calc_m({b, range: r2, sketch, diff, errors})))
      return false;
    let mp = hparent(po.parent[1]-po.parent[0]+1, range_eq(range, po.left) ?
      m : m2, range_eq(range, po.left) ? m2 : m);
    if (!this.copy_extra_m(mp, po.parent, max_range, diff, opt))
      return false;
    set_m_hash(sketch, range, m);
    this.put_verified(sketch, {b});
  }
  _put_single(seq, diff, errors, opt={}){
    let b=opt.b||0;
    let top = this.b[b].top, sketch = {};
    let decl=this.get_decl(seq, {b}), m=get_m_hash(diff, seq);
    let D=get_D(diff, seq);
    let sig=get_sig(diff, seq), d=get_d_hash(diff, seq), dD=calc_D_hash(D);
    let vm=decl.m_hash(seq), vsig=decl.sig_get(), vd=decl.d_hash();
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
    if (!m) // XXX: support also parent m (eg m4_5)
      return;
    if (seq<=top.seq){ // verify m belongs to existing top.M
      let M = this.sketch_calc_top_M({top, force: {range: [seq, seq], m},
        sketch, diff, errors, b});
      if (!M) // XXX push_error(errors, 'missing M'+top.seq)?
        return {branch: true}; // XXX: need test
      if (!beq(M, top.M)){
        push_error(errors, 'invalid M'+top.seq);
        return {branch: true}; // XXX: need test
      }
      // XXX: can this be branch if sig has error?
      check_set_sig(sketch, errors, seq, m, d, D, sig);
      this.put_verified(sketch, {b});
      return;
    }
    // new top
    if (!sig || !d)
      return push_error(errors, 'missing '+(sig ? 'd' : 'sig')+seq);
    if (!is_m_valid(m, d, sig, errors, 'invalid sig'+seq))
      return;
    // XXX: wrap this part nicely
    let old_top = this.get_decl(top.seq, {b});
    let old_top_r = old_top.m[old_top.m.length-1].range;
    let old_force = {range: old_top_r, m: old_top.m_hash(old_top_r, {b})};
    if (is_null(old_force.m, errors, 'missing m'+range_str(old_top_r)))
      return;
    let prev_M = this.sketch_calc_top_M({top: {seq: seq-1},
      force: old_force, sketch, diff, errors, b});
    if (is_null(prev_M, errors, 'missing M'+(seq-1))) // XXX: add test
      return {branch: true};
    if (!verify_sig(sig, this.pub, d, prev_M))
      return push_error(errors, 'invalid sig'+seq);
    set_sig(sketch, seq, sig);
    check_set_sig(sketch, errors, seq, m, d, D, sig);
    if (decl.sig && !decl.sig.equals(sig))
      return {branch: true};
    this.put_verified(sketch, {b});
    this.M_hash(seq, {b}); // update new top
  }
  sketch_calc_top_M(opt){
    let {b, top, force, sketch, diff, errors} = opt, {range} = force;
    let seq = force.range[1];
    assert(seq<=top.seq, 'top over seq');
    let roots = calc_roots(top.seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i], mr;
      mr = this.sketch_calc_m({b, range: r, sketch, diff, errors, force:
        range_includes(r, range) ? force : null});
      if (is_null(mr, errors, 'missing m'+range_str(r)))
        return null;
      a.push(mr, enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat(a);
  }
  sketch_calc_m(opt){
    let {b, range, sketch, diff, errors, force} = opt;
    if (force && range_eq(range, force.range))
      return set_m_hash(sketch, range, force.m);
    let seq = range[1], decl = this.get_decl(seq, {b});
    let m = get_m_hash(diff, range), vm = decl.m_hash(range);
    if ((vm||m) && (!force || !range_includes(range, force.range))){
      if (m && !vm)
        set_m_hash(sketch, range, m);
      return vm||m;
    }
    if (range[0]==range[1]){
      assert(!m);
      let d = get_d_hash(diff, seq), sig = get_sig(diff, seq);
      if (is_null(d&&sig, errors, 'missing m'+range_str(range)))
        return null;
      return set_m_hash(sketch, seq, hleaf(d, sig));
    }
    let [r1, r2] = range_split(range);
    let m1, vm1, m2, vm2, decl1 = this.get_decl(r1[1], {b}), decl2=decl;
    if (force && range_includes(r1, force.range))
      m1 = this.sketch_calc_m({b, range: r1, sketch, diff, errors, force});
    else if (vm1 = decl1.m_hash(r1));
    else if (m1 = get_m_hash(sketch, r1)||get_m_hash(diff, r1));
    else if (m1 = this.sketch_calc_m({b, range: r1, sketch, diff, errors}));
    if (is_null(m1||vm1, errors, 'missing m'+range_str(r1)))
      return null;
    if (force && range_includes(r2, force.range))
      m2 = this.sketch_calc_m({b, range: r2, sketch, diff, errors, force});
    else if (vm2 = decl2.m_hash(r2));
    else if (m2 = get_m_hash(sketch, r2)||get_m_hash(diff, r2));
    else if (m2 = this.sketch_calc_m({b, range: r2, sketch, diff, errors}));
    if (is_null(m2||vm2, errors, 'missing m'+range_str(r2)))
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
    let {b, seq, diff, diff_b, common} = opt, roots = calc_roots(seq+1), ret;
    for (let i=0; i<roots.length; i++){
      let r = roots[i], max;
      max = r[1]<=common ? {range: r} :
        this.find_max_common_m({b, range: r, diff, diff_b, common});
      if (!max)
        break;
      if (range_eq(r, max.range)){
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
    let seq = range[1], decl = this.get_decl(seq, {b});
    let vm = decl.m_hash(range);
    if (vm && seq<=common) // XXX: add test for this secnario
      return {range, m};
    let m = this.calc_m({range, diff, diff_b});
    if (vm && m && vm.equals(m))
      return {range, m};
    if (range[0]==range[1])
      return null;
    let [r1, r2] = range_split(range);
    let m1, vm1, m2, vm2, decl1 = this.get_decl(r1[1], {b}), decl2=decl;
    vm1 = decl1.m_hash(r1);
    vm2 = decl2.m_hash(r2);
    if (!vm1)
      return this.find_max_common_m({b, range: r1, diff, diff_b});
    m1 = this.calc_m({range: r1, diff, diff_b});
    if (!m1 || !vm1.equals(m1)){
      let max1 = this.find_max_common_m({b, range: r1, diff, diff_b});
      if (!max1)
        return null;
      if (!range_eq(r1, max1.range))
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
      if (!range_eq(r2, max2.range))
        return {range: r1, m: m1};
      m2 = max2.m;
    }
    assert(vm, 'vm must exists');
    assert(!m, 'm does not exists');
    return {range, m: vm};
  }
  merge_all(seq, b){
    // XXX: temporary unefficient code
    for (let j=0; this.b.length>1 && j<this.b.length; j++)
      this.merge_single(b, j, seq);
  }
  merge_single(i1, i2, seq){
    // XXX: test all possible merge of data (for eg, one branch has d/sig,
    // other only hash)
    if (i2==i1)
      return;
    [i1, i2] = i1<i2 ? [i1, i2] : [i2, i1]; // XXX: asc_order(i1, i2)
    let b1=this.b[i1], b2=this.b[i2], bseq;
    if (b2.branch.seq >= seq)
      return;
    if (b2.branch.seq >= b1.top.seq)
      return;
    let minfo = calc_merge_info(b2.branch.seq);
    let possible = false;
    for (let i=0; !possible && i<minfo.any.length; i++){
      let r = minfo.any[i], m1, m2;
      if ((m1=this.m_hash(r, {b: i1})) && (m2=this.m_hash(r, {b: i2})))
        possible = m1.equals(m2);
    }
    if (!possible)
      return;
    if (b2.branch.b==b1.branch.b){
      bseq = this.find_max_common_M({b: i1, diff_b: i2, seq,
        common: b2.branch.seq});
    } else // XXX: calc common by checking if b2 depends on b1 somehow
      bseq = this.find_max_common_M({b: i1, diff_b: i2, seq});
    assert((b1.branch.b||0)<i2, 'lower b'+i1+' cannot point upper b'+i2);
    if (b2.branch.seq >= bseq)
      return xerr('need optimize merge');
    // XXX: need to rm uneeded decl now when updating branches and update all
    // relevant places on new branch
    b2.branch.b = i1;
    b2.branch.seq = bseq;
    if (b2.top.seq!=bseq && b1.top.seq!=bseq)
      return;
    // merge
    // XXX: need more efficient way (just iterate on decl with data
    for (let i=0; i<=b2.top.seq; i++){
      let src = this.get_decl(i, {b: i2, create: false});
      if (!src)
        continue;
      let dst = this.get_decl(i, {b: i1});
      dst.copy(src);
    }
    if (b2.top.seq > b1.top.seq)
      this.notify_M({b: i1, seq: b2.top.seq, M: b2.top.M});
    for (let i=i2+1; i<this.b.length; i++){
      if (this.b[i].branch.b!=i2)
        continue;
      this.b[i].b--; // we are removing i2, need to update b number
      this.b[i].branch.b = i1;
    }
    this.b.splice(i2, 1);
  }
  calc_m(opt){
    let {range, diff, diff_b} = opt;
    let m = diff ? get_m_hash(diff, range, true) :
      this.m_hash(range, {b: diff_b});
    if (m)
      return m;
    if (range[0]==range[1])
      return null;
    let [r1, r2] = range_split(range);
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
      let v = verified[seq], decl = this.get_decl(seq, {b});
      for (let type in v){
        let val = v[type];
        switch (type){
        case 'sig': decl.set_sig(val); break;
        case 'd': decl.fbuf.set_hash(val); break;
        case 'D': decl.fbuf.set_frames(val); break;
        case 'M': decl.M.set_hash(val); break;
        case 'm':
          for (let s in val)
            decl.m_get([+s, +seq]).set_hash(val[s]);
          break;
        default: assert.fail('invalid verified type '+type);
        }
      }
    }
  }
  calc_root_hash(seq, opt){
    let roots=calc_roots(seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i];
      a.push(this.m_hash(r, opt), enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat_safe(a);
  }
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
  seq_sig(seq, opt){ return this.get_decl(seq, opt)?.sig; }
  seq_d(seq, opt){ return this.get_decl(seq, opt).fbuf.get_hash(); }
  seq_D(seq, opt){ return this.get_decl(seq, opt).fbuf.get_frames(); }
  m_hash(range, opt){
    let [, e] = range = range_fix(range);
    let decl = this.get_decl(e, opt);
    return decl.m_hash(range);
  }
  M_hash(seq, opt){
    let decl = this.get_decl(seq, opt);
    return decl ? decl.M_hash() : null;
  }
  get_decl(seq, opt={}){
    assert(typeof seq=='number', 'invalid seq '+seq);
    let b = opt.b===undefined ? 0 : opt.b, decl;
    assert(this.b[b], 'missing branch '+seq+'b'+b);
    if (this.b[b].branch.b!==undefined && seq <= this.b[b].branch.seq)
      return this.get_decl(seq, {b: this.b[b].branch.b, create: opt.create});
    decl = this.b[b].map.get(seq);
    if (decl || opt.create===false)
      return decl;
    decl = new Decl({scroll: this, b, seq, fbuf: new FrameBuffer});
    this.b[b].map.set(seq, decl);
    this.b[b].size = Math.max(this.b[b].size, seq+1);
    return decl;
  }
}

class Decl {
  constructor(opt){
    assert(opt.seq>=0, 'must provide Decl seq');
    assert(opt.scroll, 'must provide Scroll');
    let seq = this.seq = opt.seq;
    this.scroll = opt.scroll;
    this.binfo = this.scroll.b[opt.b||0];
    assert(this.binfo, 'branch '+opt.b+' not found');
    this.fbuf = opt.fbuf;
    this.m = [];
    let ma = merkel_ranges(seq);
    for (let i=0; i<ma.length; i++)
      this.m.push(new Merkel_node({decl: this, range: ma[i]}));
    this.M = new Merkel_root({decl: this});
  }
  sign = ()=>{
    let scroll = this.scroll, d = this.fbuf.get_hash({skip: 0});
    assert(scroll.key, 'cannot sign without key');
    let buf = this.seq ? Buffer.concat([d, scroll.M_hash(this.seq-1)])
      : scroll.prev_scroll ? Buffer.concat([d, scroll.prev_scroll]) : d;
    let sig = crypto.sign(crypto.blake2b(buf), scroll.key);
    assert(!this.sig || this.sig.equals(sig), 'sig mismatch');
    this.set_sig(sig);
    this.fbuf.unshift({sig});
  }
  set_sig(sig){
    assert(!this.sig || this.sig.equals(sig), 'sig changed');
    if (this.sig)
      return this.sig;
    return this.sig = sig;
  }
  sig_get(){ return this.sig; }
  d_hash(){ return this.fbuf.get_hash(); }
  m_get(range){
    let i = merkel_array_pos(range);
    assert.deepEqual(this.m[i].range, range_fix(range));
    assert(i<this.m.length);
    return this.m[i];
  }
  m_hash(range){
    let m = this.m_get(range);
    return m.get_hash();
  }
  M_hash(){
    let M = this.M;
    return M.get_hash();
  }
  copy(src){
    assert.equal(this.seq, src.seq, 'can only copy from same seq');
    if (src.M.h)
      this.M.h = src.M.h;
    for (let i=0; i<this.m.length; i++){
      if (src.m[i].h)
        this.m[i].h = src.m[i].h;
    }
    this.fbuf = src.fbuf; // XXX: need to keep existing fbuf info
  }
}

class Merkel_node {
  constructor(opt){
    this.range = range_fix(opt.range);
    this.decl = opt.decl;
    this.binfo = this.decl.binfo;
  }
  get_hash(){
    // XXX: optimize, don't run calc if there is no change in dependent data
    if (this.h)
      return this.h;
    let [s, e] = this.range, decl = this.decl;
    if (s==e){
      let d = decl.fbuf.get_hash(), sig = decl.sig;
      if (!d || !sig)
        return null;
      return this.set_hash(hleaf(d, sig));
    }
    let [r1, r2] = range_split(this.range);
    let decl1 = decl.scroll.get_decl(r1[1], {b: this.binfo.b});
    let decl2 = decl.scroll.get_decl(r2[1], {b: this.binfo.b});
    this.set_hash(hparent_safe(e-s+1, decl1.m_hash(r1), decl2.m_hash(r2)));
    return this.h;
  }
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    return this.h = h;
  }
}

class Merkel_root {
  constructor(opt){
    this.decl = opt.decl;
    this.scroll = opt.decl.scroll;
    this.binfo = this.decl.binfo;
  }
  get_hash(){
    if (this.h)
      return this.h;
    return this.set_hash(this.scroll.calc_root_hash(this.decl.seq,
      {b: this.binfo.b}));
  }
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    this.h = h;
    if (h)
      this.scroll.notify_M({b: this.binfo.b, seq: this.decl.seq, M: h});
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
  decl.M.set_hash(opt.M.h);
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
Scroll.range_split = range_split;
Scroll.range_from_str = range_from_str;
Scroll.range_str = range_str;
Scroll.range_to_parent = range_to_parent;
Scroll.seq_merkel_array_size = seq_merkel_array_size;
Scroll.merkel_ranges = merkel_ranges;
Scroll.merkel_array_pos = merkel_array_pos;
Scroll.verify_sig = verify_sig;
Scroll.LEAF_TYPE = LEAF_TYPE;
Scroll.PARENT_TYPE = PARENT_TYPE;
Scroll.ROOT_TYPE = ROOT_TYPE;
