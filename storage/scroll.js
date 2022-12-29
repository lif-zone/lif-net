// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import {EventEmitter} from 'events';
import crypto from '../util/crypto.js';
import util from '../util/util.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import enc from 'compact-encoding';
import {Buffer} from 'buffer';
import buf_util from '../peer-relay/buf_util.js';
import {r_fix, r_parent, r_eq, r_includes, r_str, r_split} from './range.js';
const assign = Object.assign; // XXX: rm, use ...
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;
const beq = buf_util.buf_eq;
const stringify = JSON.stringify.bind(JSON);
// https://en.wikipedia.org/wiki/Merkle_tree#Second_preimage_attack
const LEAF_TYPE = enc_u64(0), PARENT_TYPE = enc_u64(1), ROOT_TYPE = enc_u64(2);
function enc_u64(v){ return enc.encode(enc.uint64, v); }

function to_frame(o){ // XXX: need test
  if (Buffer.isBuffer(o))
    return {buf: o};
  if (o instanceof Uint8Array)
    return {buf: Buffer.from(o)};
  if (typeof o=='object')
    return {buf: Buffer.from(stringify(o))};
  if (typeof o=='string')
    return {buf: Buffer.from(o)};
  assert.fail('invalid frame data '+o);
}

class Data extends EventEmitter {
  constructor(opt={}){
    super();
    this.cmap = new Map();
    let fbuf = new Frame_buffer(opt);
    fbuf.on('hash', this.on_hash);
    fbuf.map_info = {_: this, c: 0};
    this.cmap.set(0, fbuf);
  }
  on_hash(){ this.map_info._.emit('hash', {c: this.map_info.c}); }
  get(c){
    assert(c>=0, 'invalid c'+c);
    let fbuf = this.cmap.get(c);
    if (fbuf)
      return fbuf;
    fbuf = new Frame_buffer();
    fbuf.map_info = {_: this, c};
    fbuf.on('hash', this.on_hash);
    this.cmap.set(c, fbuf);
    return fbuf;
  }
  copy(bdst, bsrc){
    let fsrc = this.get(bsrc);
    let fdst = this.get(bdst);
    assert.equal(fsrc.map_info.c, bsrc);
    assert.equal(fdst.map_info.c, bdst);
    // XXX: wrap with api in Frame_buffer
    assert(!fdst.h && fdst.frames.length==1, 'already contain data');
    fdst.h = fsrc.h;
    fdst.frames = fsrc.frames;
    this.cmap.delete(bsrc);
  }
}

class Frame_buffer extends EventEmitter {
  constructor(opt={}){
    super();
    let {frames} = opt;
    this.frames = [{}]; // first frame reserved for {sig, h_rest}
    for (let i=0; i<frames?.length; i++)
      this.frames.push(to_frame(frames[i]));
  }
  get_frames(){ return Array.from(this.frames); }
  set_frames(frames){
    assert(this.frames.length==1 || this.frames.length==frames.length,
      'frames length mismatch');
    let {h_rest} = this.frames[0];
    for (let i=0; i<frames.length; i++){
      let f = frames[i], ff = this.frames[i];
      if (!ff){
        this.frames.push(f);
        continue;
      }
      if (ff?.sig && f?.sig)
        assert(ff.sig.equals(f.sig), 'sig changed');
      else if (f?.sig)
        ff.sig = f.sig;
      if (ff?.h_rest && f?.h_rest)
        assert(ff.h_rest.equals(f.h_rest), 'h changed');
      else if (f?.h_rest)
        ff.h_rest = f.h_rest;
      if (ff?.buf && f?.buf)
        assert(ff.buf.equals(f.buf), 'buf changed');
      else if (f?.buf)
        ff.buf = f.buf;
      if (ff?.h && f?.h)
        assert(ff.h.equals(f.h), 'h changed');
      else if (f?.h)
        ff.h = f.h;
      if (f?.sz)
        ff.sz = f.sz;
    }
    if (!h_rest && this.frames[0].h_rest)
      this.emit('hash');
    this.get_hash();
  }
  set_frame_buf(i, buf){
    let f = this.frames[i];
    assert(f, 'no frame '+i);
    assert(!f.buf, 'buf aleady exist');
    let h = crypto.blake2b(buf);
    if (f.h)
      assert(h.equals(f.h), 'invalid hash');
    else
      f.h = h;
    f.buf = buf;
  }
  get_hash(opt={}){
    let h_rest = this.frames[0].h_rest;
    if (h_rest)
      return h_rest;
    return this.set_hash(Frame_buffer.calc_hash(this.frames, {safe: true}));
  }
  set_hash(h){
    let h_rest = this.frames[0].h_rest;
    assert(!h_rest || h_rest.equals(h), 'hash changed');
    if (h_rest)
      return h_rest;
    if (h){
      this.frames[0].h_rest = h;
      this.emit('hash');
    }
    return h;
  }
  sig_get(){ return this.frames[0].sig; }
  sig_set(sig){
    assert(!this.frames[0].sig || this.frames[0].sig.equals(sig),
      'sig changed');
    this.frames[0].sig = sig;
  }
  get(i){ return this.frames[i]?.buf; }
  get_json(i){ // XXX: need better implemenation + add caching of result
    let buf = this.frames[i]?.buf;
    if (buf)
      return JSON.parse(buf.toString());
  }
}

Frame_buffer.calc_hash = function(frames, opt={}){
  let buf;
  if (frames.length<=1)
    return null;
  let {safe} = opt;
  for (let i=1; i<frames.length; i++){
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

function parse_buf_ref(ref){
  if (ref===undefined || ref===null)
    return {l: '_'};
  if (Number.isInteger(ref))
    return {d: ref};
  if (typeof ref=='string')
    return {buf: Buffer.from(ref)};
  if (Number.isInteger(ref.d))
    return {d: ref.d};
  if (typeof ref.d=='string')
    return {l: ref.d};
  assert.fail('invalid ref %o', ref);
}

function resolve_link(links, l){ // XXX: need test
  links = Number.isInteger(links) ? {_: links} : links||{};
  let seq = links[l];
  assert(seq>=0, 'invalid link '+l);
  return seq;
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
    return {conflict: true};
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

function Map_get_one(){
  let o = this[Symbol.iterator]().next();
  return o?.value && o?.value[0];
}

export default class Scroll extends EventEmitter {
  constructor(opt){
    super();
    assert(opt.pub, 'missing pub key');
    assert(util.is_mocha()||!opt.soul, 'producion must use global soul');
    this.soul = opt.soul||Scroll.soul;
    this.pub = opt.pub;
    this.key = opt.key;
    this.storage = opt.storage;
    this.crypt = opt.crypt||Scroll.supported_crypt[0];
    assert.deepEqual(this.crypt, Scroll.supported_crypt[0], 'unsupported');
    this.prev_scroll = opt.prev_scroll;
    this.dmap = new Map();
    this.conflict = new Map();
    this.conflict.next_id = 0;
    this.merge_queue = new Map;
    this.merge_queue.get_one = Map_get_one;
    this.create_new_conflict();
  }
  init(){ return etask({_: this}, function*scroll_init(){
    let _this = this._;
    if (_this.storage)
      yield _this.storage.init({scroll: _this});
  }); }
  unload(){ // XXX HACK: quick implementation
    let M0 = this.M_hash(0, 0);
    this.soul.delete(M0);
    this.dmap = new Map();
    this.merge_queue = new Map;
    this.merge_queue.get_one = Map_get_one;
    this.conflict = new Map();
    this.top = null;
    this.conflict.next_id = 0;
    this.create_new_conflict();
    // XXX HACK: why is needed (for soul?)
    let decl = this.get_decl(0);
    decl.M.set_hash(0, M0);
  }
  create_new_conflict(opt={}){
    let {c, seq} = opt;
    let cfid = this.conflict.next_id++;
    if (c===undefined || seq===undefined){
      assert(c===undefined && seq===undefined, 'invalid create_new_conflict');
      assert.equal(cfid, 0);
      this.conflict.set(cfid, {c: cfid, top: null, conflicts: new Map()});
      return cfid;
    }
    let M = this.get_decl(seq).M_hash(c);
    assert(M, 'missing M'+seq);
    this.conflict.set(cfid, {c: cfid, top: null, parent: {c, seq, type: 't'},
      conflicts: new Map()});
    this.notify_M({c: cfid, seq: seq, M});
    return cfid;
  }
  to_c(c, seq){
    assert(typeof seq=='number' && seq>=0, 'invalid seq '+seq);
    assert(this.conflict.get(c), 'missing conflict '+seq+'c'+c);
    for (let parent; (parent = this.conflict.get(c).parent) &&
      parent?.c!==undefined && seq<=parent?.seq;
      c = parent.c);
    return c;
  }
  decl(opt, frames){ // XXX: test decl on conflict
    if (frames===undefined)
      [opt, frames] = [{c: 0}, opt];
    if (typeof opt=='number')
      opt = {c: opt};
    let {c, prev, group, link, branch} = opt;
    c = c||0;
    let top = this.conflict.get(c).top;
    let seq = top ? top.seq+1 : 0, header = {seq, ts: Date.now()};
    if (prev>0 && prev!=seq-1)
      header.prev = prev;
    if (group)
      header.group = group;
    if (link)
      header.link = link;
    if (branch)
      header.branch = branch;
    let data = new Data({frames: [header].concat(frames)});
    let decl = new Decl({scroll: this, seq, data});
    this.dmap.set(seq, decl);
    decl.init();
    decl.sign(c);
    decl.M.get_hash(c);
    return decl;
  }
  notify_M(opt){
    let {c, seq, M} = opt;
    assert(seq!=0 || c==0, 'M0 exists only on b0');
    if (seq==0){
      this.name = b2s(M);
      this.soul.set(M, this);
    }
    if (!this.conflict.get(c).top || this.conflict.get(c).top.seq<seq){
      this.conflict.get(c).top = {seq, M};
      if (!this.top || this.top.seq<seq)
        this.top = {c, seq, M};
      assert.equal(b2s(M), b2s(this.M_hash(c, this.conflict.get(c).top.seq)),
        'invalid M'+seq+'c'+c);
    }
  }
  find_best_conflict(seq, diff){
    let best = {c: 0, seq: 0};
    if (this.conflict.size<=1)
      return best;
    for (const [j, conflict] of this.conflict){
      // XXX: optimize. use prev max_common to first check if we can
      // improve and stop checking if max_common is lower the prev
      let max = this.find_max_common_M({c: j, seq, diff});
      let top = conflict.top.seq;
      if (best.seq < max || best.seq==max && best.top<top){
        best = {c: j, seq: max, top};
      }
    }
    return best;
  }
  put(diff){ return etask({_: this}, function*put(){
    let _this = this._;
    let errors = {}, a = Object.keys(diff);
    if (_this.storage)
      yield _this.storage.begin_update();
    if (diff[0]) // XXX HACK: for case where we have only M0 (missing m0)
      _this.put_single(0, diff, errors);
    for (let i=a.length-1; i>=0 && +a[i]; i--){
      let seq = +a[i], errors2={};
      if (seq==0)
        continue;
      let best = _this.find_best_conflict(seq, diff), c = best.c;
      let ret = _this.put_single(seq, diff, errors2, {c});
      if (ret?.conflict){
        let max = best.seq || _this.find_max_common_M({c, seq, diff});
        if (max!==undefined){
          errors2 = {};
          let c2 = _this.create_new_conflict({c, seq: max});
          ret = _this.put_single(seq, diff, errors, {c: c2});
          if (ret?.conflict || _this.conflict.get(c2).top.seq<=max){
            _this.conflict.delete(c2);
            continue;
          }
          c = c2;
          yield _this.conflict_update(c, {init: true});
        }
      }
      yield _this.merge_all(seq, c);
      copy_errors(errors, errors2);
    }
    if (_this.storage)
      yield _this.storage.end_update();
    return {errors};
  }); }
  put_single(seq, diff, errors, opt={}){
    let ret = this._put_single(seq, diff, errors, opt);
    if (ret?.conflict)
      return ret;
    if (!diff[seq]?.m)
      return;
    let decl=this.get_decl(seq), a=Object.keys(diff[seq].m);
    let max_range = decl.m[decl.m.length-1].range;
    for (let i=0; i<a.length; i++)
      this.copy_extra_m(diff[seq].m[a[i]], [+a[i], seq], max_range, diff, opt);
  }
  copy_extra_m(m, range, max_range, diff, opt){
    let c=opt.c||0, vm = this.m_hash(c, range);
    if (vm)
      return vm.equals(m);
    if (r_eq(range, max_range))
      return false;
    let po = r_parent(range), sketch={}, errors={}, m2;
    let r2 = r_eq(range, po.left) ? po.right : po.left;
    if (!(m2 = this.sketch_calc_m({c, range: r2, sketch, diff, errors})))
      return false;
    let mp = hparent(po.parent[1]-po.parent[0]+1, r_eq(range, po.left) ?
      m : m2, r_eq(range, po.left) ? m2 : m);
    if (!this.copy_extra_m(mp, po.parent, max_range, diff, opt))
      return false;
    set_m_hash(sketch, range, m);
    this.put_verified(sketch, {c});
  }
  _put_single(seq, diff, errors, opt={}){
    let c=opt.c||0;
    let top = this.conflict.get(c).top, sketch = {};
    let decl=this.get_decl(seq), m=get_m_hash(diff, seq);
    let D=get_D(diff, seq);
    let sig=get_sig(diff, seq), d=get_d_hash(diff, seq), dD=calc_D_hash(D);
    let vm=decl.m_hash(c, seq), vsig=decl.sig_get(c), vd=decl.d_hash(c);
    if (dD){
      if (vd){
        if (!beq(dD, vd)){
          push_error(errors, 'invalid D'+seq);
          dD = null;
        } else
          this.put_verified(set_d({}, seq, null, D), {c});
      }
      if (d && !beq(dD, d)){
        push_error(errors, 'invalid D'+seq);
        dD = D = null;
      } else
        d = dD;
    }
    if (vd && vsig){
      let conflict;
      if (sig && !beq(sig, vsig)){
        push_error(errors, 'invalid sig'+seq);
        conflict = true;
      }
      if (d && !beq(d, vd))
        push_error(errors, 'invalid d'+seq);
      if (m && !beq(m, vm))
        push_error(errors, 'invalid m'+seq);
      return seq && conflict ? {conflict} : undefined;
    }
    if (d && !sig)
      push_error(errors, 'missing sig'+seq);
    if (sig && !d)
      push_error(errors, 'missing d'+seq);
    if (sig && d)
      m = m||hleaf(d, sig);
    if (vm){
      let ret = check_set_sig(sketch, errors, seq, vm, d, D, sig);
      this.put_verified(sketch, {c});
      return ret;
    }
    if (!m)
      return;
    if (seq<=top.seq){ // verify m belongs to existing top.M
      let M = this.sketch_calc_top_M({top, force: {range: [seq, seq], m},
        sketch, diff, errors, c});
      if (!M)
        return {conflict: true};
      if (!beq(M, top.M)){
        push_error(errors, 'invalid M'+top.seq);
        return {conflict: true}; // XXX: need test
      }
      check_set_sig(sketch, errors, seq, m, d, D, sig);
      this.put_verified(sketch, {c});
      return;
    }
    // new top
    if (!sig || !d)
      return push_error(errors, 'missing '+(sig ? 'd' : 'sig')+seq);
    if (!is_m_valid(m, d, sig, errors, 'invalid sig'+seq))
      return;
    let prev_top = this.get_decl(top.seq);
    let prev_top_r = prev_top.m[prev_top.m.length-1].range;
    let prev_force = {range: prev_top_r, m: prev_top.m_hash(c, prev_top_r)};
    if (is_null(prev_force.m, errors, 'missing m'+r_str(prev_top_r)))
      return;
    let prev_M = this.sketch_calc_top_M({top: {seq: seq-1},
      force: prev_force, sketch, diff, errors, c});
    if (is_null(prev_M, errors, 'missing M'+(seq-1)))
      return {conflict: true};
    if (!verify_sig(sig, this.pub, d, prev_M))
      return push_error(errors, 'invalid sig'+seq);
    set_sig(sketch, seq, sig);
    check_set_sig(sketch, errors, seq, m, d, D, sig);
    if (vsig && !vsig.equals(sig))
      return {conflict: true};
    this.put_verified(sketch, {c});
    this.M_hash(c, seq); // update new top
  }
  sketch_calc_top_M(opt){
    let {c, top, force, sketch, diff, errors} = opt, {range} = force;
    let seq = force.range[1];
    assert(seq<=top.seq, 'top over seq');
    let roots = calc_roots(top.seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i], mr;
      mr = this.sketch_calc_m({c, range: r, sketch, diff, errors, force:
        r_includes(r, range) ? force : null});
      if (is_null(mr, errors, 'missing m'+r_str(r)))
        return null;
      a.push(mr, enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat(a);
  }
  sketch_calc_m(opt){
    let {c, range, sketch, diff, errors, force} = opt;
    if (force && r_eq(range, force.range))
      return set_m_hash(sketch, range, force.m);
    let seq = range[1], decl = this.get_decl(seq);
    let m = get_m_hash(diff, range), vm = decl.m_hash(c, range);
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
      m1 = this.sketch_calc_m({c, range: r1, sketch, diff, errors, force});
    else if (vm1 = decl1.m_hash(c, r1));
    else if (m1 = get_m_hash(sketch, r1)||get_m_hash(diff, r1));
    else if (m1 = this.sketch_calc_m({c, range: r1, sketch, diff, errors}));
    if (is_null(m1||vm1, errors, 'missing m'+r_str(r1)))
      return null;
    if (force && r_includes(r2, force.range))
      m2 = this.sketch_calc_m({c, range: r2, sketch, diff, errors, force});
    else if (vm2 = decl2.m_hash(c, r2));
    else if (m2 = get_m_hash(sketch, r2)||get_m_hash(diff, r2));
    else if (m2 = this.sketch_calc_m({c, range: r2, sketch, diff, errors}));
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
    let {c, seq, diff, diff_c, common} = opt, roots = calc_roots(seq+1), ret;
    for (let i=0; i<roots.length; i++){
      let r = roots[i], max;
      max = r[1]<=common ? {range: r} :
        this.find_max_common_m({c, range: r, diff, diff_c, common});
      if (!max)
        break;
      if (r_eq(r, max.range)){
        ret = max.range[1];
        continue;
      }
      // XXX: optimize, we now by now that we have max.range[1]
      let max2 = this.find_max_common_M({c, seq: r[1]-1, diff, diff_c,
        common});
      return max2 ? max2 : max.range[1];
    }
    return ret;
  }
  find_max_common_m(opt){
    // XXX: need sketch to cache results
    let {c, range, diff, diff_c, common} = opt;
    let seq = range[1], decl = this.get_decl(seq);
    let vm = decl.m_hash(c, range);
    if (vm && seq<=common)
      return {range, m};
    let m = this.calc_m({range, diff, diff_c});
    if (vm && m && vm.equals(m))
      return {range, m};
    if (range[0]==range[1])
      return null;
    let [r1, r2] = r_split(range);
    let m1, vm1, m2, vm2, decl1 = this.get_decl(r1[1]), decl2=decl;
    vm1 = decl1.m_hash(c, r1);
    vm2 = decl2.m_hash(c, r2);
    if (!vm1)
      return this.find_max_common_m({c, range: r1, diff, diff_c});
    m1 = this.calc_m({range: r1, diff, diff_c});
    if (!m1 || !vm1.equals(m1)){
      let max1 = this.find_max_common_m({c, range: r1, diff, diff_c});
      if (!max1)
        return null;
      if (!r_eq(r1, max1.range))
        return max1;
      m1 = max1.m;
    }
    if (!vm2)
      return {range: r1, m: m1};
    m2 = this.calc_m({range: r2, diff, diff_c});
    if (!m2 || !vm2.equals(m2)){
      let max2 = this.find_max_common_m({c, range: r2, diff, diff_c});
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
  merge_all(seq, c){ return etask({_: this}, function*merge_all(){
    let _this = this._;
    if (_this.conflict.size<=1)
      return;
    while (_this.merge_queue.size){
      let bb = _this.merge_queue.get_one(), c_o = _this.conflict.get(bb);
      yield _this.merge_single(c_o.minfo.merge_queue.get_one(), bb, seq);
    }
    // XXX: can we improve and avoid traverssing all conflicts
    for (const [i, c_o] of _this.conflict){
      if (i && c_o.parent?.type!='c' && c_o.minfo.real_map.get(c_o.parent?.c))
        yield _this.merge_single(c_o.parent.c, i, seq);
    }
  }); }
  merge_single(i1, i2, seq){ return etask({_: this}, function*merge_single(){
    let _this = this._;
    assert(i1<i2, 'invalid conflict merge '+i1+' '+i2);
    let b1=_this.conflict.get(i1), c2=_this.conflict.get(i2), bseq;
    let mergeable = c2.minfo.merge_queue.get(i1);
    let real_conflict = c2.minfo.real_map.get(i1);
    if (c2.parent?.seq >= seq)
      return assert(!mergeable && real_conflict);
    if (c2.parent?.seq >= b1.top.seq)
      return assert(!mergeable && real_conflict);
    if (!mergeable){
      if (real_conflict && c2.parent?.c==i1)
        yield _this.conflict_update(i2, {type: real_conflict ? 'c' : 't'});
      return;
    }
    // XXX: to calc common, check also if conflict is not direct child
    bseq = _this.find_max_common_M({c: i1, diff_c: i2, seq,
      common: c2.parent?.c==b1.parent?.c ? c2.parent?.seq : undefined});
    assert((b1.parent?.c||0)<i2, 'lower c'+i1+' cannot point upper c'+i2);
    if (c2.parent?.seq >= bseq)
      return xerr('need optimize merge');
    yield _this.conflict_update(i2, {c: i1, seq: bseq,
      type: real_conflict ? 'c' : 't'});
    if (c2.top.seq!=bseq && b1.top.seq!=bseq)
      return;
    // merge
    // XXX: need more efficient way (just iterate on decl with data)
    for (let i=b1.top.seq+1; i<=c2.top.seq; i++){
      let src = _this.get_decl(i, {create: false});
      if (src)
        src.copy(i1, i2);
    }
    if (c2.top.seq > b1.top.seq)
      _this.notify_M({c: i1, seq: c2.top.seq, M: c2.top.M});
    yield _this.conflict_remove(i2, i1);
    return {curr: i1, prev: i2};
  }); }
  conflict_remove(i2, i1){ return etask({_: this}, function*conflict_remove(){
    let _this = this._;
    assert(i2, 'cannot remove conflict 0');
    assert(i1>=0, 'must provide new conflict');
    assert(i1<i2, 'new conflict must be smaller');
    let c2 = _this.conflict.get(i2);
    _this.conflict.get(c2.parent.c).conflicts.delete(i2);
    for (const [i] of c2.conflicts)
      yield _this.conflict_update(i, {c: i1});
    _this.conflict.delete(i2);
    _this.emit('conflict-removed', {c: i2, cfid_new: i1});
  }); }
  conflict_update(c, o){ return etask({_: this}, function*conflict_update(){
    let _this = this._;
    // XXX: need to rm uneeded decl now when updating conflicts and update all
    // relevant places on new conflict
    assert(o.c!=c, 'conflict loop '+c);
    let src = _this.conflict.get(c);
    assert.equal(src.c, c, 'conflict corruption '+c);
    assert(src.parent?.type, 'missing conflict type');
    if (o.init){
      assert(o.c===undefined && o.seq===undefined, 'invalid init');
      assert(!src.info, 'invalid init');
      _this.update_mergeable(src.c);
      return;
    }
    if (src.c==o.c && src.seq==o.sec)
      return;
    if (o.c!==undefined){
      assert(src.parent!==o.c || o.type===undefined || src.parent?.type!='c' ||
        o.type=='c', 'real conflict type change c'+src.c);
      _this.conflict.get(src.parent?.c).conflicts.delete(src.c);
      src.parent.c = o.c;
    }
    if (o.seq!==undefined)
      src.parent.seq = o.seq;
    if (o.type!==undefined){
      assert(['t', 'c'].includes(o.type), 'invalid conflict type '+o.type);
      assert(o.c || src.parent?.type!='c' || o.type=='c',
        'real conflict type change c'+src.c);
      src.parent.type = o.type;
    }
    _this.update_mergeable(src.c);
  }); }
  update_mergeable(c){
    assert(c>0, 'invalid conflict');
    let c_o = this.conflict.get(c), p_o = this.conflict.get(c_o.parent?.c);
    if (!p_o.conflicts.get(c))
      p_o.conflicts.set(c, c_o);
    assert.equal(p_o.conflicts.get(c), c_o, 'conflict corruption '+c);
    if (c_o.minfo && c_o.minfo.parent?.c==c_o.parent?.c &&
      c_o.minfo.parent?.seq==c_o.parent?.seq){
      return;
    }
    if (c_o.minfo)
      c_o.minfo.cleanup();
    let any = calc_merge_info(c_o.parent?.seq).any;
    // XXX: maybe we can reuse some of merge_queue & real_map
    c_o.minfo = {any, merge_queue: new Map, real_map: new Map,
      parent: {c: c_o.parent?.c, seq: c_o.parent?.seq}};
    c_o.minfo.merge_queue.get_one = Map_get_one;
    c_o.minfo.cleanup = opt=>{
      if (opt && opt.c!=c)
        return;
      let any = c_o.minfo.any;
      for (let r, m, i=0; i<any.length&&(r = any[i])&&(m=this.m_get(r)); i++)
        m.off('hash', c_o.minfo.on_hash);
      this.off('conflict-removed', c_o.minfo.cleanup);
      this.merge_queue.delete(c);
    };
    const update_merge_queue = (r, bb)=>{
      if (c_o.minfo.merge_queue.get(bb))
        return;
      let m1, m2;
      if ((m1=this.m_hash(c, r)) && (m2=this.m_hash(bb, r))){
        if (!m1.equals(m2))
          return c_o.minfo.real_map.set(bb, true);
        c_o.minfo.merge_queue.set(bb, true);
        this.merge_queue.set(c, true);
      }
    };
    c_o.minfo.on_hash = opt=>{
      let r = opt.range, bb = opt.c;
      if (bb<c)
        update_merge_queue(r, bb);
      if (bb!=c)
        return;
      for (const [j] of this.conflict){ // XXX: can we skip obvious ones
        if (j<c)
          update_merge_queue(r, j);
      }
    };
    this.on('conflict-removed', c_o.minfo.cleanup);
    for (let i=0; i<any.length; i++){
      let r = any[i], m=this.m_get(r);
      m.on('hash', c_o.minfo.on_hash);
      c_o.minfo.on_hash({range: r, c: c});
    }
  }
  calc_m(opt){
    let {range, diff, diff_c} = opt;
    let m = diff ? get_m_hash(diff, range, true) :
      this.m_hash(diff_c, range);
    if (m)
      return m;
    if (range[0]==range[1])
      return null;
    let [r1, r2] = r_split(range);
    let m1 = this.calc_m({range: r1, diff, diff_c});
    if (!m1)
      return null;
    let m2 = this.calc_m({range: r2, diff, diff_c});
    if (!m2)
      return null;
    return hparent(range[1]-range[0]+1, m1, m2);
  }
  put_verified(verified, opt={}){
    let c=0;
    if (opt.c!==undefined)
      c = opt.c;
    for (let seq in verified){
      seq = +seq;
      let v = verified[seq], decl = this.get_decl(seq);
      for (let type in v){
        let val = v[type];
        switch (type){
        case 'sig': decl.sig_set(c, val); break;
        case 'd': decl.fbuf_get_sync(c).set_hash(val); break;
        case 'D': decl.fbuf_get_sync(c).set_frames(val); break;
        case 'M': decl.M.set_hash(c, val); break;
        case 'm':
          for (let s in val)
            decl.m_get([+s, +seq]).set_hash(c, val[s]);
          break;
        default: assert.fail('invalid verified type '+type);
        }
      }
    }
  }
  calc_root_hash(seq, opt){
    let roots=calc_roots(seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i], h = this.m_hash(opt.c, r);
      if (!h)
        return;
      assert(h, 'cannot calc root');
      a.push(h, enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat_safe(a);
  }
  seq_sig(c, seq){ return this.get_decl(seq)?.sig_get(c); }
  seq_d(c, seq){ return this.get_decl(seq).d_hash(c); }
  seq_D(c, seq){ return this.get_decl(seq).fbuf_get_sync(c).get_frames(); }
  m_hash(c, range){
    let [, e] = range = r_fix(range), decl = this.get_decl(e);
    return decl.m_hash(c||0, range);
  }
  m_get(range){
    let [, e] = range = r_fix(range);
    let decl = this.get_decl(e);
    return decl.m_get(range);
  }
  M_hash(c, seq){
    let decl = this.get_decl(seq);
    return decl ? decl.M_hash(c||0) : null;
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
  conflict_to_static(){
    let o = {};
    for (const [c, co] of this.conflict){
      o[c] = {top: {seq: co.top.seq, M: co.top.M}};
      if (co.parent){
        o[c].parent = {c: co.parent.c, seq: co.parent.seq,
          type: co.parent.type};
      }
    }
    return o;
  }
  conflict_from_static(bs){
    assert(this.conflict.size==1 && this.top.seq==0,
      'cannot update conflict info after it was populated');
    let max_c = this.conflict.next_id||0, max_top;
    for (let c in bs){
      let o = bs[c], M = Buffer.from(o.top.M);
      c = +c;
      max_c = Math.max(c, max_c);
      if (!max_top || max_top.seq<o.top.seq)
        max_top = {c, seq: o.top.seq, M};
      let co = {c, top: {seq: o.top.seq, M: M},
        parent: o.parent ? {c: o.parent.c, seq: o.parent.seq,
          type: o.parent.type} : null, conflicts: new Map()};
      this.conflict.set(c, co);
      if (co.parent)
        this.conflict.get(co.parent.c).conflicts.set(c, co);
    }
    // NOW: add test to verify conflict.next_id and top are updated
    this.conflict.next_id = max_c+1;
    this.top = max_top;
  }
}

class Decl extends EventEmitter {
  constructor(opt){
    super();
    assert(opt.seq>=0, 'must provide Decl seq');
    assert(opt.scroll.conflict.get(opt.c||0), 'conflict '+opt.c+' not found');
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
    this.M.init();
  }
  to_c(c){ return this.scroll.to_c(c, this.seq); }
  sign(c){
    let scroll = this.scroll, d = this.fbuf_get_sync(c).get_hash();
    assert(scroll.key, 'cannot sign without key');
    let buf = this.seq ? Buffer.concat([d, scroll.M_hash(c, this.seq-1)])
      : scroll.prev_scroll ? Buffer.concat([d, scroll.prev_scroll]) : d;
    let sig = crypto.sign(crypto.blake2b(buf), scroll.key);
    this.sig_set(c, sig);
  }
  sig_set(c, sig){
    this.fbuf_get_sync(c).sig_set(sig);
    this.emit('sig', {c}); // XXX NOW: need to emit also from set_frames
    return sig;
  }
  sig_get(c){ return this.fbuf_get_sync(c).sig_get(); }
  fbuf_get_sync(c){ return this.data.get(this.to_c(c)); }
  data_get(){ return this.data; }
  d_hash(c){ return this.fbuf_get_sync(c).get_hash(); }
  m_get(range){
    let i = merkel_array_pos(range);
    assert.deepEqual(this.m[i].range, r_fix(range));
    return this.m[i];
  }
  m_hash(c, range){ return this.m_get(range).get_hash(c); }
  M_hash(c){ return this.M.get_hash(c); }
  fbuf_get(c){
    let _this = this;
    return etask(function(){
      // XXX: load data from db/net
      return _this.fbuf_get_sync(c);
    });
  }
  get_buf(opt){
    let _this = this;
    if (Number.isInteger(opt))
      opt = {c: 0, d: opt};
    let d = opt.d;
    return etask(function*(){
      let fbuf = yield _this.fbuf_get(opt.c);
      return fbuf.get(d);
    });
  }
  get_json(opt){
    let _this = this;
    if (opt===undefined)
      opt = {c: 0, d: [1, 2]}; // header & data section
   else if (Number.isInteger(opt) || Array.isArray(opt))
      opt = {c: 0, d: opt};
    let d = opt.d;
    return etask(function*(){
      let fbuf = yield _this.fbuf_get(opt.c);
      if (!Array.isArray(d))
        return fbuf.get_json(d);
      let a = [];
      d.forEach(i=>a.push(fbuf.get_json(i)));
      return a;
    });
  }
  get_prev(opt={}){ // XXX: need test
    if (this.seq==0)
      return null;
    return etask({_: this}, function*get_prev(){
      let _this = this._, header = yield _this.get_json(1);
      if (Number.isInteger(header.prev))
        return yield _this.scroll.get_decl(header.prev);
      if (!opt.group || !header.group)
        return yield _this.scroll.get_decl(_this.seq-1);
      return (yield _this.scroll.get_decl(_this.seq-header.group))
      .get_prev(opt);
    });
  }
  copy(bdst, bsrc){
    assert(this.to_c(bdst)!=this.to_c(bsrc), 'copy same c'+bdst+'<- c'+bsrc);
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
  to_static(opt={}){
    let {max_decl, max_frame, blob} = opt;
    let o = {scroll: this.scroll.name, seq: this.seq};
    // XXX: inefficient, don't go over all conflicts, but instead just those
    // with data
    for (const [c] of this.scroll.conflict){
      if (c != this.to_c(c))
        continue;
      if (this.sig_get(c)){
        o.sig = o.sig||{};
        assert(!o.sig[c], 'sig already set');
        o.sig[c] = this.sig_get(c);
      }
      if (this.M_hash(c)){
        o.M = o.M||{};
        assert(!o.M[c], 'M already set');
        o.M[c] = this.M_hash(c);
      }
      let frames = this.fbuf_get_sync(c).get_frames();
      // XXX: move this logic to Frame_buffer
      if (frames.length>1 || frames[0].sig || frames[0].h_rest){
        let frames2 = [], total=0;
        for (let i=0; i<frames.length; i++){
          let f = frames[i], len = f.buf?.length||0;
          if (len && (len>max_frame || total+len>max_decl)){
            assert(f.h, 'missing hash');
            if (blob)
              blob[b2s(f.h)] = f.buf;
            let ff = {h: f.h};
            if (f.sz)
              ff.sz = f.sz;
            frames2.push(ff);
          }
          else {
            frames2.push(assign({}, f));
            total += len;
          }
        }
        o.D = o.D||{};
        assert(!o.D[c], 'D already set');
        o.D[c] = frames2;
      }
      for (let i=0; i<this.m.length; i++){
        if (!this.m[i].get_hash(c))
          continue;
        let r = this.m[i].range;
        o.m = o.m||{};
        o.m[r[0]] = o.m[r[0]]||{};
        assert(!o.m[r[0]][c], 'm already set');
        o.m[r[0]][c] = this.m[i].get_hash(c);
      }
    }
    return o;
  }
  from_static(o){
    for (const c in o.M)
      this.M.set_hash(+c, o.M[c]);
    for (const i in o.m){
      let m = o.m[i];
      for (const c in m) // XXX: need to verify +c is valid
        this.m_get([+i, this.seq]).set_hash(+c, m[c]);
    }
    for (const c in o.D)
      this.fbuf_get_sync(+c).set_frames(o.D[c]);
  }
}

class Merkel_node extends EventEmitter {
  constructor(opt){
    super();
    this.inited = false;
    this.range = r_fix(opt.range);
    this.decl = opt.decl;
    this.cmap = new Map();
  }
  init(){
    let decl = this.decl, scroll = decl.scroll;
    let [s, e] = this.range;
    assert(!this.inited, 'already inited');
    this.inited = true;
    // XXX test events
    if (s==e){
      const on_hash = opt=>{
        let c = opt.c, d, sig;
        if ((d = decl.d_hash(c)) && (sig = decl.sig_get(c)))
          return this.set_hash(c, hleaf(d, sig));
      };
      decl.data.on('hash', on_hash);
      decl.on('sig', on_hash);
    } else {
      let [r1, r2] = r_split(this.range);
      let m1 = scroll.m_get(r1), m2 = scroll.m_get(r2);
      const on_hash_m = opt=>{
        let c = opt.c, h1, h2;
        if ((h1 = m1.get_hash(c)) && (h2 = m2.get_hash(c)))
          this.set_hash(c, hparent_safe(e-s+1, h1, h2));
      };
      m1.on('hash', on_hash_m);
      m2.on('hash', on_hash_m);
    }
  }
  get_hash(c){
    assert(this.inited, 'Merkel_node not inited');
    c = this.decl.to_c(c);
    return this.cmap.get(c);
  }
  set_hash(c, h){
    assert(this.inited, 'Merkel_node not inited');
    c = this.decl.to_c(c);
    let h_curr = this.cmap.get(c);
    if (h_curr){
      assert(h_curr.equals(h), 'hash changed');
      return h_curr;
    }
    this.cmap.set(c, h);
    if (h)
      this.emit('hash', {c, range: this.range});
    return h;
  }
}

class Merkel_root extends EventEmitter {
  constructor(opt){
    super();
    this.inited = false;
    this.decl = opt.decl;
    this.scroll = opt.decl.scroll;
    this.cmap = new Map();
  }
  init(){
    assert(!this.inited, 'Merkel_root already inited');
    this.inited = true;
    this.on('hash', o=>this.scroll.notify_M({c: o.c, seq: o.seq, M: o.h}));
  }
  get_hash(c){
    assert(this.inited, 'Merkel_root not inited');
    c = this.decl.to_c(c);
    let h = this.cmap.get(c);
    if (h)
      return h;
    return this.set_hash(c, this.scroll.calc_root_hash(this.decl.seq, {c}));
  }
  set_hash(c, h){
    assert(this.inited, 'Merkel_root not inited');
    c = this.decl.to_c(c);
    let h_curr = this.cmap.get(c);
    if (h_curr){
      assert(h_curr.equals(h), 'hash changed');
      return h_curr;
    }
    this.cmap.set(c, h);
    if (h)
      this.emit('hash', {c, h, seq: this.decl.seq});
    return h;
  }
}

Scroll.create = (opt, d)=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  yield scroll.init();
  scroll.decl([{scroll: {crypt: Scroll.supported_crypt,
    pub: b2s(opt.pub), ...d}}]);
  return scroll;
});

Scroll.open = opt=>etask(function*scroll_open(){
  assert(util.is_mocha()||!opt.soul, 'producion must use global soul');
  let seq, h;
  if (typeof opt.M=='string')
    [seq, h] = [0, s2b(opt.M)];
  else // XXX: support Uint8Array
    [seq, h] = Buffer.isBuffer(opt.M) ? [0, opt.M] : [opt.M.seq, opt.M.h];
  assert(util.is_mocha() || seq==0, 'producion scroll must have M0');
  let soul = opt.soul||Scroll.soul;
  let scroll = seq==0 && soul.get(h);
  if (scroll)
    return scroll;
  scroll = new Scroll(opt);
  yield scroll.init();
  assert(/^\d+$/.test(seq) && h, 'scroll.open missing M');
  let decl = scroll.get_decl(seq);
  decl.M.set_hash(0, h);
  return scroll;
});

Scroll.supported_crypt = [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}];
Scroll.parse_buf_ref = parse_buf_ref;
Scroll.resolve_link = resolve_link;
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
