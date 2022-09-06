// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import assert from 'assert';
import etask from '../util/etask.js';

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
  decl = fbuf=>etask(function*(){
    /*
    yield this.lock();
    let seq = this.size, ts = Date.now();
    fbuf.unshift({seq, ts});
    let d = fbuf.hash();
    let sig = sign(d, seq ? this.M : this.prev_scroll);
    fbuf.unshift({sig});
    let node = {seq, fbuf, m: {}};
    node.m[seq] = hash(d, sig);
    this.nodes.set(seq, node);
    this.M = this.root_hash();
    this.size++;
    // XXX: update M_prev, size
    */
  });
  lock(){} // XXX: TODO
  unlock(){} // XXX: TODO
}

Scroll.create = (opt, decl)=>etask(function*scroll_create(){
  let scroll = new Scroll(opt);
  return yield scroll.decl({scroll: decl});
});

