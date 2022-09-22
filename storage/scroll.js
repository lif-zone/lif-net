// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import crypto from '../util/crypto.js';
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
  get_hash(){
    if (this.h)
      return this.h;
    let buf, frames = this.frames;
    if (!frames.length)
      return null;
    for (let i = frames[0].sig ? 1 : 0; i<frames.length; i++){
      let f = frames[i], h = f.h;
      if (!h)
        h = f.h = crypto.blake2b(f.buf); // XXX: need set_hash
      buf = buf ? Buffer.concat([buf, h]) : h;
    }
    return this.set_hash(crypto.blake2b(buf));
  }
  get_sig(){ return this.frames[0]?.sig; }
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    return this.h = h;
  }
}

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
function get_d_hash(data, seq){ return data[seq]?.d; } // XXX: or calc from D
function set_d_hash(data, seq, val){
  let o = data[seq] = data[seq]||{};
  assert(!o.d || o.d.equals(val), 'set d'+seq+' diffent vals');
  return o.d = val;
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

function check_set_sig(sketch, errors, seq, m, d, sig){
  if (!d && !sig)
    return;
  if (!d)
    return push_error(errors, 'missing d'+seq);
  if (!sig)
    return push_error(errors, 'missing sig'+seq);
  if (!beq(m, hleaf(d, sig)))
    return push_error(errors, 'invalid sig'+seq);
  set_sig(sketch, seq, sig);
  set_d_hash(sketch, seq, d);
}

function push_error(errors, s){ errors[s] = (errors[s]||0)+1; }

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
    this.size = 0;
    this.top = null;
    this.decl_map = new Map();
  }
  // XXX: use return =>
  decl(frames){
    let fbuf = new FrameBuffer({frames});
    let seq = this.size, ts = Date.now();
    assert(!this.decl_map.get(seq), 'XXX TODO'); // XXX: support branch
    fbuf.unshift({seq, ts});
    let decl = new Decl({scroll: this, seq, fbuf});
    decl.sign();
    this.decl_map.set(seq, decl);
    this.size++;
    return decl;
  }
  notify_M(opt){
    let {seq, M} = opt;
    if (!this.top || this.top.seq<seq)
      this.top = {seq, M};
  }
  put(diff){
    let top = this.top, errors = {};
    let a = Object.keys(diff), last_seq = +a[a.length-1]?.seq;
    assert(top, 'cannot put to empty scroll');
    let i=0, j;
    for (; i<a.length && +a[i]<=top.seq; i++)
      this.put_single(+a[i], diff, errors, last_seq);
    if (i==a.length)
      return {errors};
    // we get when there is new top. a new top requires signature verficiation
    // (which is very expensive). so we first find a new top. afterwards we
    // just verify using hash comparison
    for (j=a.length-1; j>=i && +a[j]>top.seq; j--)
      this.put_single(+a[j], diff, errors, last_seq);
    for (; i<j && +a[i]<=top.seq; i++)
      this.put_single(+a[i], diff, errors, last_seq);
    return {errors};
  }
  put_single(seq, diff, errors){
    let top = this.top, sketch = {};
    let decl=this.get_decl(seq), m=get_m_hash(diff, seq);
    let sig=get_sig(diff, seq), d=get_d_hash(diff, seq);
    let vm=decl.m_hash(seq), vsig=decl.sig_get(), vd=decl.d_hash();
    // XXX: handle getting real data instead of d
    if (vd && vsig){
      if (sig && !beq(sig, vsig))
        push_error(errors, 'invalid sig'+seq);
      if (d && !beq(d, vd))
        push_error(errors, 'invalid d'+seq);
      if (m && !beq(m, vm))
        push_error(errors, 'invalid m'+seq);
      return;
    }
    if (d && !sig)
      push_error(errors, 'missing sig'+seq);
    if (sig && !d)
      push_error(errors, 'missing d'+seq);
    if (sig && d)
      m = m||hleaf(d, sig);
    if (vm){
      check_set_sig(sketch, errors, seq, vm, d, sig);
      this.put_verified(sketch);
      return;
    }
    if (!m)
      return;
    if (seq<=top.seq){ // verify m belongs to existing top.M
      let M = this.sketch_calc_top_M({top, seq, m, sketch, diff, errors});
      if (!M); // XXX push_error(errors, 'missing M'+top.seq)?
      else if (!beq(M, top.M))
        push_error(errors, 'invalid M'+top.seq);
      else {
        check_set_sig(sketch, errors, seq, m, d, sig);
        this.put_verified(sketch);
      }
      return;
    }
    // new top
    if (!sig || !d)
      return push_error(errors, 'missing '+(sig ? 'd' : 'sig')+seq);
    if (!is_m_valid(m, d, sig, errors, 'invalid sig'+seq))
      return;
    let old_top_m = this.get_decl(top.seq).m_hash(top.seq);
    if (is_null(old_top_m, errors, 'missing m'+top.seq))
      return;
    let prev_M = this.sketch_calc_top_M({top: {seq: seq-1},
      seq: top.seq, m: old_top_m, sketch, diff, errors});
    if (is_null(prev_M, errors, 'missing M'+(seq-1))) // XXX: add test
      return;
    if (!verify_sig(sig, this.pub, d, prev_M))
      return push_error(errors, 'invalid sig'+seq);
    set_sig(sketch, seq, sig);
    set_d_hash(sketch, seq, d);
    check_set_sig(sketch, errors, seq, m, d, sig);
    this.put_verified(sketch);
  }
  sketch_calc_top_M(opt){
    let {top, seq, m, sketch, diff, errors} = opt;
    assert(seq<=top.seq, 'top over seq');
    let roots = calc_roots(top.seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i], mr;
      mr = this.sketch_calc_m({range: r, sketch, diff, errors, force:
        range_includes(r, [seq, seq]) ? {range: [seq, seq], m} : null});
      if (!mr){
        push_error(errors, 'missing m'+range_str(r));
        return null;
      }
      a.push(mr, enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat(a);
  }
  sketch_calc_m(opt){
    let {range, sketch, diff, errors, force} = opt;
    if (force && range_eq(range, force.range)){
      set_m_hash(sketch, range, force.m);
      return set_m_hash(sketch, range, force.m);
    }
    let seq = range[1], decl = this.get_decl(seq);
    let m = get_m_hash(diff, range), vm = decl.m_hash(range);
    if ((vm||m) && (!force || !range_includes(range, force.range))){
      if (m && !vm)
        set_m_hash(sketch, range, m);
      return vm||m;
    }
    if (range[0]==range[1]){
      assert(!m);
      let d = get_d_hash(diff, seq), sig = get_sig(diff, seq);
      if (d && sig){
        m = hleaf(d, sig);
        set_m_hash(sketch, seq, m);
      } else
        push_error(errors, 'missing m'+range_str(range));
      return m;
    }
    let [r1, r2] = range_split(range);
    let m1, vm1, m2, vm2, decl1 = this.get_decl(r1[1]), decl2=decl;
    if (force && range_includes(r1, force.range))
      m1 = this.sketch_calc_m({range: r1, sketch, diff, errors, force});
    else if (vm1 = decl1.m_hash(r1));
    else if (m1 = get_m_hash(sketch, r1)||get_m_hash(diff, r1));
    else
      m1 = this.sketch_calc_m({range: r1, sketch, diff, errors});
    if (!m1 && !vm1){
      push_error(errors, 'missing m'+range_str(r1));
      return null;
    }
    if (force && range_includes(r2, force.range))
      m2 = this.sketch_calc_m({range: r2, sketch, diff, errors, force});
    else if (vm2 = decl2.m_hash(r2));
    else if (m2 = get_m_hash(sketch, r2)||get_m_hash(diff, r2));
    else
      m2 = this.sketch_calc_m({range: r2, sketch, diff, errors});
    if (!m2 && !vm2){
      push_error(errors, 'missing m'+range_str(r2));
      return null;
    }
    if (m1)
      set_m_hash(sketch, r1, m1);
    if (m2)
      set_m_hash(sketch, r2, m2);
    m = hparent(range[1]-range[0]+1, vm1||m1, vm2||m2);
    set_m_hash(sketch, range, m);
    return m;
  }
  put_verified(verified){
    for (let seq in verified){
      seq = +seq;
      let v = verified[seq], decl = this.get_decl(seq, {create: true});
      for (let type in v){
        let val = v[type];
        switch (type){
        case 'M': decl.M.set_hash(val); break;
        case 'sig': decl.set_sig(val); break;
        case 'd': decl.fbuf.set_hash(val); break;
        case 'm':
          for (let s in val)
            decl.m_get([+s, +seq]).set_hash(val[s]);
          break;
        default: assert.fail('invalid verified type '+type);
        }
      }
    }
  }
  calc_root_hash(seq){
    let roots=calc_roots(seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i];
      // XXX: get in parallel
      a.push(this.m_hash(r), enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat_safe(a);
  }
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
  seq_sig(seq){ return this.get_decl(seq)?.sig; }
  seq_d(seq){ return this.get_decl(seq).fbuf.get_hash(); }
  m_hash(range){
    let [, e] = range = range_fix(range);
    let decl = this.get_decl(e, {create: true});
    return decl.m_hash(range);
  }
  M_hash(seq){
    let decl = this.get_decl(seq===undefined ? this.size-1 : seq);
    return decl ? decl.M_hash() : null;
  }
  get_decl(seq, opt={}){
    assert(typeof seq=='number', 'invalid seq '+seq);
    let decl = this.decl_map.get(seq);
    if (decl || opt.create===false)
      return decl;
    decl = new Decl({scroll: this, seq, fbuf: new FrameBuffer});
    this.decl_map.set(seq, decl);
    this.size = Math.max(this.size, seq+1);
    return decl;
  }
}

class Decl {
  constructor(opt){
    assert(opt.seq>=0, 'must provide Decl seq');
    assert(opt.scroll, 'must provide Scroll');
    let seq = this.seq = opt.seq;
    this.scroll = opt.scroll;
    this.fbuf = opt.fbuf;
    this.M = new Merkel_root({decl: this});
    this.m = [];
    let ma = Scroll.merkel_ranges(seq);
    for (let i=0; i<ma.length; i++)
      this.m.push(new Merkel_node({decl: this, range: ma[i]}));
  }
  sign = ()=>{
    let scroll = this.scroll, d = this.fbuf.get_hash();
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
    return m.h || m.get_hash();
  }
  M_hash(){
    let M = this.M;
    return M.h || M.get_hash();
  }
}

class Merkel_node {
  constructor(opt){
    this.range = range_fix(opt.range);
    this.decl = opt.decl;
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
    let decl1 = decl.scroll.get_decl(s+d-1, {create: true});
    let decl2 = decl.scroll.get_decl(e, {create: true});
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
  }
  get_hash(){
    if (this.h)
      return this.h;
    return this.set_hash(this.scroll.calc_root_hash(this.decl.seq));
  }
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    this.h = h;
    if (h)
      this.scroll.notify_M({seq: this.decl.seq, M: h});
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
  let decl = scroll.get_decl(opt.M.seq, {create: true});
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
