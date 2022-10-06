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
function get_m_hash(data, r){
  r = range_fix(r);
  let m = data[r[1]]?.m;
  return m && m[r[0]] || null;
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
  if (!beq(m, hleaf(d, sig)))
    return push_error(errors, 'invalid sig'+seq);
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
      this.b.push({size: 0, top: null, map: new Map(), branch: {}});
      return this.b.length-1;
    }
    let M = this.get_decl(seq, {b}).M_hash();
    assert(M, 'missing M'+seq);
    this.b.push({size: 0, top: null, map: new Map(), branch: {b, seq}});
    let b2 = this.b.length-1;
    this.notify_M({b: b2, seq: seq, M});
    return b2;
  }
  // XXX: use return =>
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
      let seq = +a[i], errors2={}, best = {b: 0, max_valid: 0};
      for (let j=0; this.b.length>1 && j<this.b.length; j++){
        let max_valid = this.find_max_valid_M({b: j, seq, diff});
        if (best.max_valid < max_valid)
          best = {b: j, max_valid};
      }
      let b = best.b;
      let ret = this.put_single(seq, diff, errors2, {b});
      if (ret?.branch){
        let max_valid = best.max_valid ||
          this.find_max_valid_M({b, seq, diff});
        if (max_valid!==undefined)
        {
          errors2 = {};
          let b2 = this.create_new_branch({b, seq: max_valid});
          ret = this.put_single(seq, diff, errors2, {b: b2});
          xerr.notice('XXX branch max_valid %s b%s ->b%s ret %O', max_valid,
            b, b2, ret);
          if (this.b[b2].top.seq==max_valid) // XXX: find better way
            this.b.pop();
        }
      }
      copy_errors(errors, errors2);
    }

    return {errors};
  }
  put_single(seq, diff, errors, opt={}){
    // XXX: need to check all brnaches
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
      check_set_sig(sketch, errors, seq, vm, d, D, sig);
      this.put_verified(sketch, {b});
      return;
    }
    if (!m)
      return;
    if (seq<=top.seq){ // verify m belongs to existing top.M
      let M = this.sketch_calc_top_M({top, seq, m, sketch, diff, errors, b});
      if (!M); // XXX push_error(errors, 'missing M'+top.seq)?
      else if (!beq(M, top.M)){
        push_error(errors, 'invalid M'+top.seq);
        return {branch: true}; // XXX: need test
      }
      else {
        check_set_sig(sketch, errors, seq, m, d, D, sig);
        this.put_verified(sketch, {b});
      }
      return;
    }
    // new top
    if (!sig || !d)
      return push_error(errors, 'missing '+(sig ? 'd' : 'sig')+seq);
    if (!is_m_valid(m, d, sig, errors, 'invalid sig'+seq))
      return;
    let old_top_m = this.get_decl(top.seq, {b}).m_hash(top.seq);
    if (is_null(old_top_m, errors, 'missing m'+top.seq))
      return;
    let prev_M = this.sketch_calc_top_M({top: {seq: seq-1},
      seq: top.seq, m: old_top_m, sketch, diff, errors, b});
    if (is_null(prev_M, errors, 'missing M'+(seq-1))) // XXX: add test
      return;
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
    let {b, top, seq, m, sketch, diff, errors} = opt;
    assert(seq<=top.seq, 'top over seq');
    let roots = calc_roots(top.seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i], mr;
      mr = this.sketch_calc_m({b, range: r, sketch, diff, errors, force:
        range_includes(r, [seq, seq]) ? {range: [seq, seq], m} : null});
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
  find_max_valid_M(opt){
    let {b, seq, diff} = opt;
    let roots = calc_roots(seq+1);
    let ret;
    for (let i=0; i<roots.length; i++){
      let r = roots[i], max;
      max = this.find_max_valid_m({b, range: r, diff});
      if (!max)
        break;
      if (range_eq(r, max.range)){
        ret = max.range[1];
        continue;
      }
      let max2 = this.find_max_valid_M({b, seq: r[1]-1, diff});
      return max2 ? max2 : max.range[1];
    }
    return ret;
  }
  find_max_valid_m(opt){
    let {b, range, diff} = opt;
    let seq = range[1], decl = this.get_decl(seq, {b});
    let m = get_m_hash(diff, range), vm = decl.m_hash(range);
    if (vm && m && vm.equals(m))
      return {range, m};
    if (range[0]==range[1])
      return null;
    let [r1, r2] = range_split(range);
    let m1, vm1, m2, vm2, decl1 = this.get_decl(r1[1], {b}), decl2=decl;
    vm1 = decl1.m_hash(r1);
    m1 = get_m_hash(diff, r1);
    vm2 = decl2.m_hash(r2);
    m2 = get_m_hash(diff, r2);
    if (!vm1)
      return this.find_max_valid_m({b, range: r1, diff});
    if (!m1 || !vm1.equals(m1)){
      let max1 = this.find_max_valid_m({b, range: r1, diff});
      if (!max1)
        return null;
      if (!range_eq(r1, max1.range))
        return max1;
      m1 = max1.m;
    }
    if (!vm2)
      return {range: r1, m: m1};
    if (!m2 || !vm2.equals(m2)){
      let max2 = this.find_max_valid_m({b, range: r2, diff});
      if (!max2)
        return {range: r1, m: m1};
      // XXX maybe return r1+max2.range and optimize find_max_valid_M
      if (!range_eq(r2, max2.range))
        return {range: r1, m: m1};
      m2 = max2.m;
    }
    assert(vm, 'vm must exists');
    assert(!m, 'm does not exists');
    return {range, m: vm};
  }
  put_verified(verified, opt={}){
    let b=0;
    if (opt.b===true){
      assert.fail('XXX need info for create_new_branch');
      this.create_new_branch();
      b = this.b.length-1;
    } else if (opt.b!==undefined)
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
      // XXX: get in parallel
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
    assert(this.b[b], 'missing branch '+b);
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
    this.b = opt.b;
    this.fbuf = opt.fbuf;
    this.m = [];
    let ma = Scroll.merkel_ranges(seq);
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
}

class Merkel_node {
  constructor(opt){
    this.range = range_fix(opt.range);
    this.decl = opt.decl;
    this.b = this.decl.b;
  }
  get_hash(){
    if (this.h)
      return this.h;
    let [s, e] = this.range, decl = this.decl;
    if (s==e){ // XXX: need to get sig async?
      let d = decl.fbuf.get_hash(), sig = decl.sig;
      if (!d || !sig)
        return null;
      return this.set_hash(hleaf(d, sig));
    }
    // XXX: get in parallel
    let d = (e-s+1)/2; // XXX: range_split
    let decl1 = decl.scroll.get_decl(s+d-1, {b: this.b});
    let decl2 = decl.scroll.get_decl(e, {b: this.b});
    this.set_hash(hparent_safe(2*d, decl1.m_hash([s, s+d-1]),
      decl2.m_hash([s+d, e])));
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
    this.b = this.decl.b;
  }
  get_hash(){
    if (this.h)
      return this.h;
    return this.set_hash(this.scroll.calc_root_hash(this.decl.seq,
      {b: this.b}));
  }
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    this.h = h;
    if (h)
      this.scroll.notify_M({b: this.b, seq: this.decl.seq, M: h});
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
