// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import etask from '../util/etask.js';
import crypto from '../util/crypto.js';
import enc from 'compact-encoding';
import {Buffer} from 'buffer';
import buf_util from '../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str;
const stringify = JSON.stringify.bind(JSON);
const assign = Object.assign.bind(Object);
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

function parse_seq_range(range){
  let m = (''+range).match(/^(\d+)(_(\d+))?$/); // 10 or 10_15
  return {seq: m[1], seq2: m[3]||m[1]};
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
    this.nodes = new Map();
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
      /* XXX: change m to be array and make every hash a class
        (can be empty/in_progress)
        m['0_1']'2_3'
        m['1.5_6']
        m1   = s[1].m[0] = s[1].d[0]+s[1].d[1]... // self
        m0_1 = s[1].m[1] = s[1].m[0]+s[1].m[0] // if (seq & 0x1)
        m3   = s[3].m[0] = s[3].d[0]+s[3].d[1]... // self
        m2_3 = s[3].m[1] = s[2].m[0]+s[3].m[0] // if (seq & 0x1)
        m0_3 = s[3].m[2] = s[1].m[1]+s[3].m[1] // if (seq & 0x3)
        m[0] = self always exits
        m[1] = if seq & 0x1
        m[2] = if seq & 0x3
        m[3] = if seq & 0x7
      */
      // XXX  new Scroll.Node
      let node = {seq, d, sig, fbuf, m: {}, M: null};
      _this.nodes.set(''+seq, node);
      _this.size++;
      _this.M = node.M = _this.call_root_hash(_this.size);
      return node;
    });
  }
  sign(seq, d){
    let buf;
    if (seq)
      buf = Buffer.concat([d, this.M]);
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
      a.push(this._seq_m(r.s, r.e));
      a.push(enc_u64(r.s));
      a.push(enc_u64(r.e-r.s+1));
    }
    return hash_concat(a);
  }
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
  seq_sig(seq){ return this.get_node(seq)?.sig; }
  seq_d(seq){ return this.get_node(seq)?.d; }
  _seq_m(seq, seq2){
    seq = +seq;
    seq2 = +seq2;
    let node = this.get_node(seq);
    if (seq==seq2){
      let m = node.m[''+seq];
      if (!m)
        m = node.m[''+seq] = hash_leaf(node.d, node.sig);
      return m;
    }
    node = this.get_node(seq2);
    let range = seq+'_'+seq2;
    let m = node.m[range];
    if (m)
      return m;
    let d = (seq2-seq+1)/2;
    m = node.m[range] = hash_parent(2*d, this._seq_m(seq, seq+d-1),
      this._seq_m(seq+d, seq2));
    return m;
  }
  seq_m(range){
    let {seq, seq2} = parse_seq_range(range);
    return this._seq_m(seq, seq2);
  }
  seq_M(seq){ return seq ? this.get_node(seq)?.M : this.M; }
  get_node(seq){ return this.nodes.get(''+seq); }
}

Scroll.create = (opt, d)=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  // XXX: assign --> {d...} XXX TODO
  yield scroll.decl({scroll: assign({crypt: Scroll.supported_crypt,
    pub: b2s(opt.pub)}, d)});
  return scroll;
});

Scroll.supported_crypt = [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}];
Scroll.hash_concat = hash_concat; // XXX need test
Scroll.hash_parent = hash_parent; // XXX need test
Scroll.hash_parent = hash_leaf; // XXX need test
Scroll.calc_roots = calc_roots;
Scroll.parse_seq_range = parse_seq_range;
Scroll.LEAF_TYPE = LEAF_TYPE;
Scroll.PARENT_TYPE = PARENT_TYPE;
Scroll.ROOT_TYPE = ROOT_TYPE;
