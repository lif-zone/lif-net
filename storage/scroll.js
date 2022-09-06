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
    debugger;
    let h = crypto.sha256(f.buf);
    buf = buf ? Buffer.concat([buf, h]) : h;
  });
  return crypto.sha256(buf);
}

function hash_concat(a, b){ return crypto.sha256(Buffer.concat([a, b])); }

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
    let node = {seq, fbuf, m: {}};
    node.m[''+seq] = hash_concat(d, sig);
    _this.nodes.set(''+seq, node);
    // XXX _this.M = _this.root_hash();
    _this.size++;
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
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
}

Scroll.create = (opt, d)=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  return yield scroll.decl(d);
});

