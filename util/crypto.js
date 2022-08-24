// author: derry. coder: arik.
// XXX: file need test
'use strict'; /*jslint node:true,browser:true*/
import sodium from 'sodium-universal';
import b4a from 'b4a'; // XXX: rm
/* XXX secp256k1 support
import secp256k1 from 'secp256k1';
import crypto from 'crypto';
*/
import {Buffer} from 'buffer';
import buf_util from '../peer-relay/buf_util.js';
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;
const stringify = JSON.stringify;

const E = {};
export default E;

E.keypair = function(seed){
  const pub = b4a.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES);
  const key = b4a.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES);
  if (seed)
    sodium.crypto_sign_seed_keypair(pub, key, seed);
  else
    sodium.crypto_sign_keypair(pub, key);
  return {pub: Buffer.from(pub), key: Buffer.from(key)};
/* XXX secp256k1 support
  let key;
  while ((key = Buffer.from(crypto.randomBytes(32))) &&
    !secp256k1.privateKeyVerify(key));
  let pub = secp256k1.publicKeyCreate(key);
  return {pub: Buffer.from(pub), key: Buffer.from(key)};
*/
};

E.sign = function(buf, key){
  const sig = b4a.allocUnsafe(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, buf, key);
  return Buffer.from(sig);
/* XXX secp256k1 support
  debugger;
  console.log('XXX pre-buf %o', buf);
  const hash = crypto.createHash('sha256').update(buf).digest();
  console.log('XXX hash %o', hash);
  console.log('XXX buf %o', buf);
  const sig = secp256k1.ecdsaSign(hash, key);
  console.log('XXX sig %o', sig);
  return Buffer.from(hash);
  const sig = b4a.allocUnsafe(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, buf, key);
  return Buffer.from(sig);
*/
}

E.keypair_to_str = function(keys){
  return stringify({pub: b2s(keys.pub), key: b2s(keys.key)}); };

E.keypair_from_str = function(keys_str){
  let _keys = JSON.parse(keys_str);
  return {pub: s2b(_keys.pub), key: s2b(_keys.key)};
};
