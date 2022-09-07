// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import etask from '../util/etask.js';
import crypto from '../util/crypto.js';
import {Buffer} from 'buffer';
import buf_util from '../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str;
const stringify = JSON.stringify.bind(JSON);
const assign = Object.assign.bind(Object);

function to_frame(o){
  if (Buffer.isBuffer(o))
    return {buf: o};
  else if (typeof o=='object')
    return {buf: Buffer.from(stringify(o))};
  else if (typeof o=='string')
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

function parse_seq_range(range){
  range = ''+range;
  let m = range.match(/^(\d+)(_(\d+))?$/); // 10 or 10_15
  return {seq: m[1], seq2: m[3]||m[1]};
}

function calc_roots(size){
  let roots = [];
  let n=1, s=0;
  while (s+n<=size){
    if (s+n==size){
      roots.push({s, e: s+n-1, name: n>1 ? s+'_'+(s+n-1) : ''+s});
      return roots;
    }
    if (s+2*n-1 < size){
      n *= 2;
      continue;
    }
    roots.push({s, e: s+n-1, name: s+'_'+(s+n-1)});
    s += n;
    n=1;
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
      let fbuf = fbuf_from_arg(args);
      yield _this.lock();
      let seq = _this.size, ts = Date.now();
      fbuf_unshift(fbuf, {seq, ts});
      let d = fbuf_hash(fbuf);
      let sig = _this.sign(seq, d);
      fbuf_unshift(fbuf, {sig});
      let node = {seq, d, sig, fbuf, m: {}, M: null};
      _this.nodes.set(''+seq, node);
      _this.size++;
      yield _this.update_root_hash();
      node.M = _this.M;
      // XXX: update M_prev, size
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
  update_root_hash = ()=>etask({_: this}, function update_root_hash(){
    let _this = this._, roots=calc_roots(_this.size), h=[];
    for (let i=0; i<roots.length; i++){
      let o = roots[i];
      h.push(_this._seq_m(o.s, o.e));
    }
    _this.M = h.length==1 ? h[0] : hash_concat(h);
  });
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
        m = node.m[''+seq] = hash_concat([node.d, node.sig]);
      return m;
    }
    node = this.get_node(seq2);
    let range = seq+'_'+seq2;
    let m = node.m[range];
    if (m)
      return m;
    let d = (seq2-seq+1)/2;
    m = node.m[range] = hash_concat([this._seq_m(seq, seq+d-1),
      this._seq_m(seq+d, seq2)]);
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
  yield scroll.decl({scroll: assign({crypt: Scroll.supported_crypt,
    pub: b2s(opt.pub)}, d)});
  return scroll;
});

Scroll.supported_crypt = [{sig: 'ed25519', hash: 'blake2b', lif: 'lif1'}];
Scroll.hash_concat = hash_concat; // XXX need test
Scroll.calc_roots = calc_roots;
Scroll.parse_seq_range = parse_seq_range;
