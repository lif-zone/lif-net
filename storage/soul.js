// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import Scroll from './scroll.js';
import DB from './db.js';
import buf_util from '../net/buf_util.js';
const b2s = buf_util.buf_to_str;

export default class Soul {
  soul = new Map();
  db = new DB();
  constructor(opt={}){ this.name = opt.name; }
  set(M0, scroll){
    M0 = typeof M0=='string' ? M0 : b2s(M0);
    assert(!this.soul.get(M0) || this.soul.get(M0)===scroll,
      'scroll already exists '+M0);
    return this.soul.set(M0, scroll);
  }
  get(M0){
    M0 = typeof M0=='string' ? M0 : b2s(M0);
    return this.soul.get(M0);
  }
  delete(M0){
    M0 = typeof M0=='string' ? M0 : b2s(M0);
    return this.soul.delete(M0);
  }
  clear(){ this.soul.clear(); }
}

Scroll.soul = new Soul();
