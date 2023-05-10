// author: derry. coder: arik.
'use strict';
import crypto from '../util/crypto.js';
import assert from 'assert';
import hash from 'object-hash'; // XXX: rm
import buf_util from './buf_util.js';
const b2s = buf_util.buf_to_str;
import {undefined_to_null2} from './util.js'; // XXX: rm

let excludeKeys = key=>['path', 'sign', 'debug'].indexOf(key)!=-1;
export default class Wallet {
  constructor(opt){
    opt = opt||{};
    let {priv, pub} = opt.keys||{};
    let crypt = this.crypt = opt.crypt||
      {sig: 'secp256k1', hash: 'sha256', lif: 'lif1'};
    if (priv || pub){
      assert(priv && pub, 'must specify both priv/pub keys');
      // XXX assert valid priv/pub keys and that they match
      this.keys = {priv, pub};
      if (b2s(priv)=='00')
        this.test = true;
    } else {
      // XXX: allow to configure it
      let {pub, key} = crypto.keypair(crypt);
      // XXX: rename priv to key
      this.keys = {priv: key, pub: pub};
    }
  }
  hash_passthrough(o){
    return hash(o, {respectType: false, excludeKeys,
      replacer: undefined_to_null2, algorithm: 'passthrough'});
  }
  hash_obj(o){
    // XXX: we use sha1 algorithm. need to find a more secured one (blake?)
    // XXX: need to exclude path/sign only from root, not from sub keys
    return crypto.hash(this.crypt, Uint8Array.from(hash(o,
      {respectType: false, excludeKeys, replacer: undefined_to_null2})));
  }
  sign(o){
    if (this.test)
      return this.hash_passthrough(o);
    return crypto.sign(this.crypt, this.hash_obj(o), this.keys.priv);
  }
  verify(o, sign, pub){
    try {
      if (this.test)
        return true;
      pub = pub || this.keys.pub;
      sign = sign || o.sign; // XXX: rename sign -> sig
      // XXX HACK: we need it because Uint8Array is lost when sending buffers
      // over websocket (we get generic Buffer). Need to fix it at the
      // websocket/wrtc level
      if (sign && !(sign instanceof Buffer) &&
        !(sign.data instanceof Uint8Array)){
        sign = o.sign = sign instanceof Uint8Array ? sign :
          new Uint8Array(sign.data);
      }
      return crypto.verify(this.crypt, sign, pub, this.hash_obj(o));
    } catch(err){ return false; }
  }
}

