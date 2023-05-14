// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import fs from 'fs';
import Scroll from './scroll.js';
import DB from './db.js';
import etask from '../util/etask.js';
import buf_util from '../net/buf_util.js';
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;

export default class Soul {
  constructor(opt={}){
    this.soul = new Map();
    this.db = new DB({soul: this});
    this.name = opt.name;
    this.conf = opt.conf;
    this.keypair = opt.keypair;
    this.index_id_next = 0;
  }
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
  new_index_id(){ return this.index_id_next++; }
}

const read_keypair = (file_key, file_pub)=>etask(function*read_keypair(){
  // XXX: need fs api
  let key = yield fs.promises.readFile(file_key, 'utf8');
  let pub = yield fs.promises.readFile(file_pub, 'utf8');
  return {key: s2b(key), pub: s2b(pub)};
});

const write_keypair = (keypair, file_key, file_pub)=>etask(
  function*write_keypair()
{
  yield fs.promises.writeFile(file_key, b2s(keypair.key).toString(), 'utf8');
  yield fs.promises.writeFile(file_pub, b2s(keypair.pub).toString(), 'utf8');
});

Scroll.soul = new Soul();
Soul.read_keypair = read_keypair;
Soul.write_keypair = write_keypair;
