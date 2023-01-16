// author: derry. coder: arik.
// XXX: file need test
'use strict'; /*jslint node:true,browser:true*/
import sodium from 'sodium-universal';
import b4a from 'b4a'; // XXX: rm
import blake2b from 'blake2b';
import crypto from 'crypto';
import {Buffer} from 'buffer';
import buf_util from '../net/buf_util.js';
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;
const stringify = JSON.stringify;

const E = {};
export default E;

E.keypair = seed=>{
  const pub = b4a.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES);
  const key = b4a.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES);
  if (seed)
    sodium.crypto_sign_seed_keypair(pub, key, seed);
  else
    sodium.crypto_sign_keypair(pub, key);
  return {pub: Buffer.from(pub), key: Buffer.from(key)};
};

E.sign = (buf, key)=>{
  const sig = b4a.allocUnsafe(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, buf, key);
  return Buffer.from(sig);
};

E.verify = (sig, pub, buf)=>sodium.crypto_sign_verify_detached(sig, buf, pub);

E.keypair_to_str = keys=>stringify({pub: b2s(keys.pub), key: b2s(keys.key)});

E.keypair_from_str = keys_str=>{
  let _keys = JSON.parse(keys_str);
  return {pub: s2b(_keys.pub), key: s2b(_keys.key)};
};

E.sha1 = buf=>Buffer.from(crypto.createHash('sha1').update(buf).digest());

E.sha256 = buf=>Buffer.from(crypto.createHash('sha256').update(buf).digest());

E.blake2b = buf=>{
  const out = b4a.allocUnsafe(blake2b.BYTES);
  blake2b(blake2b.BYTES).update(buf).digest(out);
  return Buffer.from(out);
};
