// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import etask from '../util/etask.js';
import crypto from '../util/crypto.js';
import {Buffer} from 'buffer';
const stringify = JSON.stringify.bind(JSON);

/* XXX: tree
d0
d1, d0-1
d2
d3, d2-3, d0-3
d4
d5, d4-5
d6
d7, d6-7, d4-7, d0-7
*/

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
    let h = crypto.sha256(f.buf);
    buf = buf ? Buffer.concat([buf, h]) : h;
  });
  return crypto.sha256(buf);
}

function hash_concat(a, b){ return crypto.sha256(Buffer.concat([a, b])); }

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
    this.crypt = opt.crypt||'ed25519';
    this.prev_scroll = opt.prev_scroll;
    this.size = 0;
    this.nodes = new Map();
  }
  decl = ()=>etask({_: this}, function*(){
    let _this = this._;
    let fbuf = fbuf_from_arg(Array.from(arguments));
    yield _this.lock();
    let seq = _this.size, ts = Date.now();
    fbuf_unshift(fbuf, {seq, ts});
    let d = fbuf_hash(fbuf);
    let sig = _this.sign(seq, d);
    fbuf_unshift(fbuf, {sig});
    let node = {seq, d, sig, fbuf, m: {}, M: null};
    node.m[''+seq] = hash_concat(d, sig);
    _this.nodes.set(''+seq, node);
    _this.size++;
    yield _this.update_root_hash();
    node.M = _this.M;
    // XXX: update M_prev, size
    return node;
  });
  sign(seq, d){
    let buf;
    if (seq)
      buf = Buffer.concat([d, this.M]);
    else if (this.prev_scroll)
      buf = Buffer.concat([d, this.prev_scroll]);
    else
      buf = d;
    return crypto.sign(crypto.sha256(buf), this.key);
  }
  update_root_hash = ()=>etask({_: this}, function update_root_hash(){
    // let roots = calc_roots(size);
    // XXX: WIP
    let _this = this._;
    if (_this.size==1)
      _this.M = _this.seq_m('0');
    else if (_this.size==2)
      _this.M = hash_concat(_this.seq_m('0'), _this.seq_m('1'));
    else
      assert.fail('XXX TODO');
  });
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
  seq_sig(seq){ return this.get_node(seq)?.sig; }
  seq_d(seq){ return this.get_node(seq)?.d; }
  seq_m(seq){ return this.get_node(seq)?.m[''+seq]; }
  seq_M(seq){ return seq ? this.get_node(seq)?.M : this.M; }
  get_node(seq){ return this.nodes.get(''+seq); }
}

Scroll.create = (opt, d)=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  yield scroll.decl(d);
  return scroll;
});

// XXX need test
Scroll.hash_concat = hash_concat;
Scroll.calc_roots = calc_roots;
