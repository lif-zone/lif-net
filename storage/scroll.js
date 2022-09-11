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

class FrameBuffer {
  constructor(opt={}){
    let {frames} = opt;
    this.frames = [];
    for (let i=0; i<frames.length; i++)
      this.frames.push(to_frame(frames[i]));
  }
  unshift(o){ this.frames.unshift(to_frame(o)); }
  calc_hash(){
    if (this.h)
      return this.h;
    let buf, frames = this.frames;
    for (let i = frames[0].sig ? 1 : 0; i<frames.length; i++){
      let f = frames[i], h = f.h;
      if (!h)
        h = f.h = crypto.blake2b(f.buf);
      buf = buf ? Buffer.concat([buf, h]) : h;
    }
    return this.h = crypto.blake2b(buf);
  }
  get_sig(){ return this.frames[0].sig; }
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
    let frames = arguments;
    return etask({_: this}, function*(){
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
  }
  calc_root_hash(seq){
    let roots=calc_roots(seq+1), a=[ROOT_TYPE];
    for (let i=0; i<roots.length; i++){
      let r = roots[i];
      a.push(this.m_hash([r.s, r.e]));
      a.push(enc_u64(r.s));
      a.push(enc_u64(r.e-r.s+1));
    }
    return hash_concat(a);
  }
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
  seq_sig(seq){ return this.get_decl(seq)?.sig; }
  seq_d(seq){ return this.get_decl(seq).fbuf.calc_hash(); }
  m_hash(range){
    let [, e] = range = range_fix(range);
    let decl = this.get_decl(e);
    return decl.m_hash(range);
  }
  M_hash(seq){
    let decl = this.get_decl(seq===undefined ? this.size-1 : seq);
    return decl.M_hash();
  }
  get_decl(seq, opt){
    assert(typeof seq=='number', 'invalid seq '+seq);
    let decl = this.decl_map.get(seq);
    if (decl || !opt.create)
      return decl;
    decl = new Decl({scroll: this, seq, fbuf: new FrameBuffer});
    this.decl_map.set(seq, decl);
  }
}

class Decl {
  constructor(opt){
    assert(opt.seq>=0, 'must provide Decl seq');
    assert(opt.scroll, 'must provide Scroll');
    let seq = this.seq = opt.seq;
    this.scroll = opt.scroll;
    this.fbuf = opt.fbuf; // XXX new FrameBuffer()
    this.M = new Merkel_root({decl: this});
    this.m = [new Merkel_node({decl: this, range: seq})];
    for (let i=1, s=seq-i; seq&i; i*=2, s-=i)
      this.m.push(new Merkel_node({decl: this, range: [s, seq]}));
  }
  sign(){
    let scroll = this.scroll, d = this.fbuf.calc_hash();
    assert(scroll.key, 'cannot sign without key');
    let buf = this.seq ? Buffer.concat([d, scroll.M_hash(this.seq-1)]) :
      scroll.prev_scroll ? Buffer.concat([d, scroll.prev_scroll]) : d;
    let sig = this.sig = crypto.sign(crypto.blake2b(buf), scroll.key);
    this.fbuf.unshift({sig});
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
  calc_hash(){
    if (this.h)
      return this.h;
    let [s, e] = this.range, decl = this.decl;
    if (s==e)
      this.h = hash_leaf(decl.fbuf.calc_hash(), decl.sig);
    else {
      let d = (e-s+1)/2;
      let decl1 = decl.scroll.get_decl(s+d-1);
      let decl2 = decl.scroll.get_decl(e);
      this.h = hash_parent(2*d, decl1.m_hash([s, s+d-1]),
        decl2.m_hash([s+d, e]));
    }
    return this.h;
  }
}

class Merkel_root {
  constructor(opt){
    this.decl = opt.decl;
  }
  calc_hash(){
    if (this.h)
      return this.h;
    return this.h = this.decl.scroll.calc_root_hash(this.decl.seq);
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
