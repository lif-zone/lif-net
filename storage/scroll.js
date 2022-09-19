// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import crypto from '../util/crypto.js';
import enc from 'compact-encoding';
import {Buffer} from 'buffer';
import buf_util from '../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str;
const stringify = JSON.stringify.bind(JSON);
// https://en.wikipedia.org/wiki/Merkle_tree#Second_preimage_attack
const LEAF_TYPE = enc_u64(0);
const PARENT_TYPE = enc_u64(1);
const ROOT_TYPE = enc_u64(2);
const assign = Object.assign;
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
  calc_hash(){
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

// XXX: need test
function get_M_hash(data, seq){ return data[seq]?.M; }
function set_M_hash(data, seq, val){
  data[seq] = data[seq]||{};
  data[seq].M = val;
}
// XXX: need test
function get_d_hash(data, seq){ return data[seq]?.d; } // XXX: or calc from D
// XXX: need test
function get_sig_hash(data, seq){ return data[seq]?.sig; }

// XXX: need test
function get_m_hash(data, r){
  let m = data[r[1]]?.m;
  return m && m[r[0]] || null;
}

// XXX: need test
function set_m_hash(data, r, val){
  let o = data[r[1]] = data[r[1]]||{};
  o.m = o.m||{};
  o.m[r[0]] = val;
}

// XXX: need test
function copy_m_hash(dst, src){
  for (let seq in src){
    seq = +seq;
    let m = src[seq].m;
    if (!m)
      continue;
    for (let seq2 in m)
      set_m_hash(dst, [seq2, seq], m[seq2]);
  }
}

function seq_merkel_array_size(seq){
  let n=1;
  for (let i=1; seq&i; i*=2, n++);
  return n;
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

export default class Scroll {
  constructor(opt){
    assert(opt.pub, 'missing pub key');
    this.pub = opt.pub;
    this.key = opt.key;
    this.crypt = opt.crypt||Scroll.supported_crypt[0];
    assert.deepEqual(this.crypt, Scroll.supported_crypt[0], 'unsupported');
    this.prev_scroll = opt.prev_scroll;
    this.size = 0;
    this.decl_map = new Map();
  }
  // XXX: use return =>
  decl = frames=>etask({_: this}, function*(){
    let _this = this._;
    let fbuf = new FrameBuffer({frames});
    let seq = _this.size, ts = Date.now();
    assert(!_this.decl_map.get(seq), 'XXX TODO'); // XXX: support branch
    fbuf.unshift({seq, ts});
    let decl = new Decl({scroll: _this, seq, fbuf});
    yield decl.sign();
    _this.decl_map.set(seq, decl);
    _this.size++;
    return decl;
  });
  put(diff){ return etask({_: this}, function*put(){
    // XXX: verify all get_decl and check if we load all what is needed before
    // we start
    let _this = this._;
    let decls = {}, verified = {};
    for (let seq in diff){
      if (!/^\d+$/.test(seq))
        throw new Error('invalid seq '+seq);
      seq = +seq;
      // XXX: implement hash_all (it loads all hashes to memory)
      decls[seq] = yield _this.get_decl(seq, {create: true, hash_all: true});
      verified[seq] = verified[seq]||{};
    }
    for (let seq in diff){
      seq = +seq;
      let seq_o = diff[seq], decl = decls[seq];
      if (!seq && seq_o.m){ // XXX: check if we can avoid this if
        // XXX HACK: need to support any seq and verify merkel tree
        let m = seq_o.m[seq];
        if (decl.M.h && m){
          let M = hconcat([ROOT_TYPE, m, enc_u64(0), enc_u64(1)]);
          if (!decl.M.h.equals(M))
             throw new Error('invalid m'+seq);
           set_m_hash(verified, [seq, seq], m);
        }
      }
      if (seq_o.sig && seq_o.d){ // XXX or calc hash from data
        let M_prev = !seq ? _this.prev_scroll :
          yield (yield _this.get_decl(seq-1, {create: true, hash_all: true}))
          .M_hash() || get_M_hash(verified, seq-1);
        if (!seq || M_prev){ // XXX: what if no prev_scroll?
          if (!Scroll.verify_sig(seq_o.sig, _this.pub, seq_o.d, M_prev))
            throw new Error('invalid sig'+seq);
          assign(verified[seq], {d: seq_o.d, sig: seq_o.sig});
          // XXX: need to add more information that was provided
          continue;
        }
        let merkel = {};
        let prev_o = yield _this.merkel_calc_M({seq: seq-1, verified, merkel,
          diff});
        if (!prev_o.match)
          continue;
        // XXX: we can skip verify sometimes by checkig hash
        if (!Scroll.verify_sig(seq_o.sig, _this.pub, seq_o.d, prev_o.M))
           throw new Error('invalid sig'+seq);
        if (seq)
          set_M_hash(verified, seq-1, M_prev);
        assign(verified[seq], {d: seq_o.d, sig: seq_o.sig});
        copy_m_hash(verified, merkel);
      }
    }
    yield _this.put_verified(verified);
  }); }
  put_verified(verified){ return etask({_: this}, function*put(){
    let _this = this._;
    for (let seq in verified){
      seq = +seq;
      let v = verified[seq], decl = yield _this.get_decl(seq, {create: true});
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
  }); }
  merkel_calc_m(opt){ return etask({_: this}, function*_merkel_calc_m(){
    let _this = this._, {r, verified, merkel, diff} = opt;
    let seq = r[1], decl = yield _this.get_decl(seq);
    let m = (yield decl.m_hash(r)) || get_m_hash(verified, r);
    let diff_m = get_m_hash(diff, r);
    if (m)
      return {match: true, m};
    if (r[0]==r[1]){
      let d = decl.fbuf.h||get_d_hash(verified, seq);
      let sig = decl.sig||get_sig_hash(verified, seq);
      if (d && sig){
        m = hleaf(d, sig);
        set_m_hash(merkel, r, m);
        return {match: true, m};
      }
      if (diff_m){
        set_m_hash(merkel, r, diff_m);
        return {match: false, m: diff_m};
      }
      d = d||get_d_hash(diff, seq);
      sig = sig||get_sig_hash(diff, seq);
      if (d && sig){
        // XXX: do we need to verify sig?
        set_m_hash(merkel, r, diff_m);
        return {match: false, m: hleaf(d, sig)};
      }
      return {match: false};
    }
    let [r1, r2] = range_split(r), decl0 = yield _this.get_decl(r1[1]);
    let m1 = (yield decl0.m_hash(r1)) || get_m_hash(verified, r1);
    let m2 = (yield decl.m_hash(r2)) || get_m_hash(verified, r2);
    if (m1 && m2){
      let m = hparent_safe(r[1]-r[0]+1, m1, m2);
      set_m_hash(merkel, r, m);
      return {match: true, m};
    }
    let o1 = m1 ? {match: true, m: m1} :
      yield _this.merkel_calc_m({r: r1, verified, merkel, diff});
    let o2 = m2 ? {match: true, m: m2} :
      yield _this.merkel_calc_m({r: r2, verified, merkel, diff});
    if (!o1.m || !o2.m){
      set_m_hash(merkel, r, diff_m);
      return {match: false, m: diff_m};
    }
    m = hparent(r[1]-r[0]+1, o1.m, o2.m);
    set_m_hash(merkel, r, m);
    return {match: o1.match || o2.match, m};
  }); }
  merkel_calc_M(opt){ return etask({_: this}, function*_merkel_calc_M(){
    let _this = this._, {seq, verified, merkel, diff} = opt;
    let roots = calc_roots(seq+1), a=[ROOT_TYPE];
    let _match=false;
    for (let i=0; i<roots.length; i++){
      let r = roots[i];
      let {match, m} = yield _this.merkel_calc_m({r, verified, merkel, diff});
      if (!m)
        return {match: false};
      if (match)
        _match = true;
      a.push(m, enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return {match: _match, M: hconcat(a)};
  }); }
  calc_root_hash = seq=>etask({_: this}, function*calc_root_hash(){
    let _this = this._;
    let roots=calc_roots(seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i];
      // XXX: get in parallel
      a.push(yield _this.m_hash(r), enc_u64(r[0]), enc_u64(r[1]-r[0]+1));
    }
    return hconcat_safe(a);
  });
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
  seq_sig = seq=>etask({_: this}, function*seq_sig(){
    return (yield this._.get_decl(seq))?.sig; });
  seq_d = seq=>etask({_: this}, function*seq_d(){
    return (yield this._.get_decl(seq)).fbuf.calc_hash(); });
  m_hash = range=>etask({_: this}, function*m_hash(){
    let _this = this._;
    let [, e] = range = range_fix(range);
    let decl = yield _this.get_decl(e, {create: true});
    return decl.m_hash(range);
  });
  M_hash = seq=>etask({_: this}, function*M_hash(){
    let _this = this._;
    let decl = yield _this.get_decl(seq===undefined ? this.size-1 : seq);
    return decl ? decl.M_hash() : null;
  });
  get_decl = (seq, opt={})=>etask({_: this}, function get_decl(){
    let _this = this._;
    assert(typeof seq=='number', 'invalid seq '+seq);
    let decl = _this.decl_map.get(seq);
    if (decl || !opt.create)
      return decl;
    decl = new Decl({scroll: _this, seq, fbuf: new FrameBuffer});
    _this.decl_map.set(seq, decl);
    _this.size = Math.max(_this.size, seq+1);
    return decl;
  });
}

class Decl {
  constructor(opt){
    assert(opt.seq>=0, 'must provide Decl seq');
    assert(opt.scroll, 'must provide Scroll');
    let seq = this.seq = opt.seq;
    this.scroll = opt.scroll;
    this.fbuf = opt.fbuf;
    this.M = new Merkel_root({decl: this});
    this.m = [new Merkel_node({decl: this, range: seq})];
    for (let i=1, s=seq-i; seq&i; i*=2, s-=i)
      this.m.push(new Merkel_node({decl: this, range: [s, seq]}));
  }
  sign = ()=>etask({_: this}, function*sign(){
    let _this = this._;
    let scroll = _this.scroll, d = yield _this.fbuf.calc_hash();
    assert(scroll.key, 'cannot sign without key');
    let buf = _this.seq ? Buffer.concat([d, yield scroll.M_hash(_this.seq-1)])
      : scroll.prev_scroll ? Buffer.concat([d, scroll.prev_scroll]) : d;
    let sig = crypto.sign(crypto.blake2b(buf), scroll.key);
    assert(!_this.sig || _this.sig.equals(sig), 'sig mismatch');
    _this.set_sig(sig);
    _this.fbuf.unshift({sig});
  });
  set_sig(sig){
    assert(!this.sig || this.sig.equals(sig), 'sig changed');
    if (this.sig)
      return this.sig;
    return this.sig = sig;
  }
  m_get(range){
    let i = merkel_array_pos(range);
    assert.deepEqual(this.m[i].range, range_fix(range));
    assert(i<this.m.length);
    return this.m[i];
  }
  m_hash(range){
    let m = this.m_get(range);
    return m.h || m.calc_hash();
  }
  M_hash(){
    let M = this.M;
    return M.h || M.calc_hash();
  }
}

class Merkel_node {
  constructor(opt){
    this.range = range_fix(opt.range);
    this.decl = opt.decl;
  }
  calc_hash = ()=>etask({_: this}, function*calc_hash(){
    let _this = this._;
    if (_this.h)
      return _this.h;
    let [s, e] = _this.range, decl = _this.decl;
    if (s==e){ // XXX: need to get sig async?
      let d = yield decl.fbuf.calc_hash(), sig = decl.sig;
      if (!d || !sig)
        return null;
      return _this.set_hash(hleaf(d, sig));
    }
    // XXX: get in parallel
    let d = (e-s+1)/2; // XXX: range_split
    let decl1 = yield decl.scroll.get_decl(s+d-1, {create: true});
    let decl2 = yield decl.scroll.get_decl(e, {create: true});
    _this.set_hash(hparent_safe(2*d, yield decl1.m_hash([s, s+d-1]),
      yield decl2.m_hash([s+d, e])));
    return _this.h;
  });
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
  }
  calc_hash = ()=>etask({_: this}, function*calc_hash(){
    let _this = this._;
    if (_this.h)
      return _this.h;
    return _this.set_hash(
      yield _this.decl.scroll.calc_root_hash(_this.decl.seq));
  });
  set_hash(h){
    assert(!this.h || this.h.equals(h), 'hash changed');
    if (this.h)
      return this.h;
    return this.h = h;
  }
}

Scroll.create = (opt, d)=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  yield scroll.decl([{scroll: {crypt: Scroll.supported_crypt,
    pub: b2s(opt.pub), ...d}}]);
  return scroll;
});

Scroll.open = opt=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  assert(opt.M && /^\d+$/.test(opt.M.seq) && opt.M.h, 'scroll.open missing M');
  let decl = yield scroll.get_decl(opt.M.seq, {create: true});
  yield decl.M.set_hash(opt.M.h);
  return scroll;
});

Scroll.supported_crypt = [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}];
Scroll.hconcat = hconcat; // XXX need test
Scroll.hconcat_safe = hconcat_safe; // XXX need test
Scroll.hparent = hparent; // XXX need test
Scroll.hparent_safe = hparent_safe; // XXX need test
Scroll.hleaf = hleaf; // XXX need test
Scroll.calc_roots = calc_roots;
Scroll.range_from_str = range_from_str;
Scroll.range_str = range_str;
Scroll.seq_merkel_array_size = seq_merkel_array_size;
Scroll.merkel_array_pos = merkel_array_pos;
Scroll.verify_sig = verify_sig;
Scroll.LEAF_TYPE = LEAF_TYPE;
Scroll.PARENT_TYPE = PARENT_TYPE;
Scroll.ROOT_TYPE = ROOT_TYPE;
