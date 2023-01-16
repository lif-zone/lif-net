// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import hcrypto from 'hypercore-crypto';
import assert from 'assert';
import hash from 'object-hash';
import buf_util from './buf_util.js';
const b2s = buf_util.buf_to_str;
import {undefined_to_null2} from './util.js';

let excludeKeys = key=>['path', 'sign', 'debug'].indexOf(key)!=-1;

export default class Wallet {
  constructor(opt){
    opt = opt||{};
    let {priv, pub} = opt.keys||{};
    if (priv || pub){
      assert(priv && pub, 'must specify both priv/pub keys');
      // XXX assert valid priv/pub keys and that they match
      this.keys = {priv, pub};
      if (b2s(priv)=='00')
        this.test = true;
    } else {
      let {publicKey, secretKey} = hcrypto.keyPair();
      this.keys = {priv: secretKey, pub: publicKey};
    }
  }
  hash_passthrough(o){
    return hash(o, {respectType: false, excludeKeys,
      replacer: undefined_to_null2, algorithm: 'passthrough'});
  }
  hash_obj(o){
    // XXX: need to exclude path/sign only from root, not from sub keys
    return Uint8Array.from(hash(o, {respectType: false, excludeKeys,
      replacer: undefined_to_null2}));
  }
  sign(o){
    if (this.test)
      return this.hash_passthrough(o);
    // XXX: we use sha1 algorithm. need to find a more secured one (blake?)
    return hcrypto.sign(this.hash_obj(o), this.keys.priv);
  }
  verify(o, sign, pub){
    try {
      if (this.test)
        return true;
      pub = pub || this.keys.pub;
      sign = sign || o.sign;
      // XXX HACK: we need it because Uint8Array is lost when sending buffers
      // over websocket (we get generic Buffer). Need to fix it at the
      // websocket/wrtc level
      if (sign && !(sign instanceof Buffer) &&
        !(sign.data instanceof Uint8Array)){
        sign = o.sign = new Uint8Array(sign.data);
      }
      return hcrypto.verify(this.hash_obj(o), sign, pub);
    } catch(err){ return false; }
  }
}

