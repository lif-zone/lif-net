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

// XXX wrap as FrameBuffer and move to fbug.js
function fbuf_from_arg(arg){
  let fbuf = {frames: []};
  arg.forEach(o=>fbuf.frames.push(to_frame(o)));
  return fbuf;
}

function fbuf_unshift(fbuf, o){ fbuf.frames.unshift(to_frame(o)); }

function fbuf_hash(fbuf){
  let buf;
  fbuf.frames.forEach(f=>{
    let h = crypto.blake2b(f.buf);
    buf = buf ? Buffer.concat([buf, h]) : h;
  });
  return crypto.blake2b(buf);
}

function hash_concat(a){ return crypto.blake2b(Buffer.concat(a)); }
function hash_parent(size, left, right){
  return hash_concat([PARENT_TYPE, enc_u64(size), left, right]); }
function hash_leaf(h, sig){ return hash_concat([LEAF_TYPE, h, sig]); }

function range_from_str(range){
  let m = (''+range).match(/^(\d+)(_(\d+))?$/); // 10 or 10_15
  return [+m[1], m[3]!==undefined ? +m[3] : +m[1]];
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
      roots.push({s, e: s+n-1, name: n>1 ? s+'_'+(s+n-1) : ''+s});
      return roots;
    }
    if (s+2*n-1 < size){
      n *= 2;
      continue;
    }
    roots.push({s, e: s+n-1, name: s+'_'+(s+n-1)});
    [s, n] = [s+n, 1];
  }
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
  decl(){
    let args = Array.from(arguments);
    return etask({_: this}, function*(){
      let _this = this._;
      // XXX new Scroll.FrameBuffer
      let fbuf = fbuf_from_arg(args);
      yield _this.lock();
      let seq = _this.size, ts = Date.now();
      fbuf_unshift(fbuf, {seq, ts});
      let d = fbuf_hash(fbuf);
      let sig = _this.sign(seq, d);
      fbuf_unshift(fbuf, {sig});
      let decl = new Decl({scroll: _this, seq, d, sig, fbuf});
      _this.decl_map.set(seq, decl);
      _this.size++;
      // XXX: new Merkel_root and _this.M -> merkel_root()
      decl.M = _this.call_root_hash(_this.size);
      return decl;
    });
  }
  sign(seq, d){
    // XXX: mv to Decl
    let buf;
    if (seq)
      buf = Buffer.concat([d, this.seq_M(seq-1)]);
    else if (this.prev_scroll)
      buf = Buffer.concat([d, this.prev_scroll]);
    else
      buf = d;
    return crypto.sign(crypto.blake2b(buf), this.key);
  }
  call_root_hash(size){
    let roots=calc_roots(size), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i];
      a.push(this.seq_m([r.s, r.e]));
      a.push(enc_u64(r.s));
      a.push(enc_u64(r.e-r.s+1));
    }
    return hash_concat(a);
  }
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
  seq_sig(seq){ return this.get_decl(seq)?.sig; }
  seq_d(seq){ return this.get_decl(seq)?.d; }
  seq_m(range){
    let [, e] = range = range_fix(range);
    let decl = this.get_decl(e);
    return decl.merkel_get_hash(range);
  }
  seq_M(seq){ return seq===undefined ? this.get_decl(this.size-1)?.M :
    this.get_decl(seq)?.M }
  get_decl(seq){
    assert(typeof seq=='number', 'invalid seq '+seq);
    return this.decl_map.get(seq);
  }
}

class Decl {
  constructor(opt){
    assert(opt.seq>=0, 'must provide Decl seq');
    assert(opt.scroll, 'must provide Scroll');
    let seq = this.seq = opt.seq;
    this.scroll = opt.scroll;
    this.d = opt.d; // XXX new DataHash()
    this.sig = opt.sig; // XXX: remove from here and get it from fbuf
    this.fbuf = opt.fbuf; // new FrameBuffer()
    this.m = [new Merkel_node({decl: this, range: seq})];
    for (let i=1, s=seq-i; seq&i; i*=2, s-=i)
      this.m.push(new Merkel_node({decl: this, range: [s, seq]}));
  }
  merkel_get(range){
    let i = merkel_array_pos(range);
    assert.deepEqual(this.m[i].range, range_fix(range));
    assert(i<this.m.length);
    return this.m[i];
  }
  merkel_get_hash(range){
    let m = this.merkel_get(range);
    if (!m.h)
      m.calc_hash();
    return m.h;
  }
}

class Merkel_node {
  constructor(opt){
    this.range = range_fix(opt.range);
    this.decl = opt.decl;
  }
  calc_hash(){
    if (this.h)
      return;
    let [s, e] = this.range, decl = this.decl;
    if (s==e)
      this.h = hash_leaf(decl.d, decl.sig);
    else {
      let d = (e-s+1)/2;
      let decl1 = decl.scroll.get_decl(s+d-1);
      let decl2 = decl.scroll.get_decl(e);
      this.h = hash_parent(2*d, decl1.merkel_get_hash([s, s+d-1]),
        decl2.merkel_get_hash([s+d, e]));
    }
  }
}

Scroll.create = (opt, d)=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  yield scroll.decl({scroll: {crypt: Scroll.supported_crypt,
    pub: b2s(opt.pub), ...d}});
  return scroll;
});

Scroll.supported_crypt = [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}];
Scroll.hash_concat = hash_concat; // XXX need test
Scroll.hash_parent = hash_parent; // XXX need test
Scroll.hash_parent = hash_leaf; // XXX need test
Scroll.calc_roots = calc_roots;
Scroll.range_from_str = range_from_str;
Scroll.seq_merkel_array_size = seq_merkel_array_size;
Scroll.merkel_array_pos = merkel_array_pos;
Scroll.LEAF_TYPE = LEAF_TYPE;
Scroll.PARENT_TYPE = PARENT_TYPE;
Scroll.ROOT_TYPE = ROOT_TYPE;
