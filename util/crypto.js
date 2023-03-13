// author: derry. coder: arik.
// XXX: file need test
'use strict';
import sodium from 'sodium-universal';
import b4a from 'b4a'; // XXX: rm
import blake2b from 'blake2b';
import crypto from 'crypto';
import secp256k1 from 'secp256k1';
import assert from 'assert';
import {Buffer} from 'buffer';
import buf_util from '../net/buf_util.js';
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;
const stringify = JSON.stringify;

const E = {};
export default E;

E.keypair = (crypt, seed)=>{
  switch (crypt.sig){
    case 'secp256k1': return E.keypair_secp256k1(seed);
    case 'ed25519': return E.keypair_ed25519(seed);
    default: assert.fail('unsupported sig '+crypt.sig);
  }
};

E.keypair_secp256k1 = seed=>{
  let key;
  // XXX: check if secp256k1 is the right library to use
  while ((key = crypto.randomBytes(32)) && !secp256k1.privateKeyVerify(key));
  let pub = secp256k1.publicKeyCreate(key);
  return {pub: Buffer.from(pub), key: Buffer.from(key)};
};

E.keypair_ed25519 = seed=>{
  const pub = b4a.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES);
  const key = b4a.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES);
  if (seed)
    sodium.crypto_sign_seed_keypair(pub, key, seed);
  else
    sodium.crypto_sign_keypair(pub, key);
  return {pub: Buffer.from(pub), key: Buffer.from(key)};
};

E.sign = (crypt, buf, key)=>{
  switch (crypt.sig){
    case 'secp256k1': return E.sign_secp256k1(buf, key);
    case 'ed25519': return E.sign_ed25519(buf, key);
    default: assert.fail('unsupported sig '+crypt.sig);
  }
};

E.verify = (crypt, sig, pub, buf)=>{
  switch (crypt.sig){
    case 'secp256k1': return E.verify_secp256k1(sig, pub, buf);
    case 'ed25519': return E.verify_ed25519(sig, pub, buf);
    default: assert.fail('unsupported sig '+crypt.sig);
  }
};

E.sign_secp256k1 = (buf, key)=>Buffer.from(secp256k1.ecdsaSign(buf, key)
.signature);

E.verify_secp256k1 = (sig, pub, buf)=>secp256k1.ecdsaVerify(sig, buf, pub);

E.sign_ed25519 = (buf, key)=>{
  const sig = b4a.allocUnsafe(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, buf, key);
  return Buffer.from(sig);
};

E.keypair_to_str = keys=>stringify({pub: b2s(keys.pub), key: b2s(keys.key)});

E.keypair_from_str = keys_str=>{
  let _keys = JSON.parse(keys_str);
  return {pub: s2b(_keys.pub), key: s2b(_keys.key)};
};

E.sha1 = buf=>Buffer.from(crypto.createHash('sha1').update(buf).digest());
E.sha1_str = buf=>b2s(E.sha1(buf));

E.sha256 = buf=>Buffer.from(crypto.createHash('sha256').update(buf).digest());
E.sha256_str = buf=>b2s(E.sha256(buf));

E.blake2b = buf=>{
  const out = b4a.allocUnsafe(blake2b.BYTES);
  blake2b(blake2b.BYTES).update(buf).digest(out);
  return Buffer.from(out);
};

E.hash = (crypt, buf)=>{
  switch (crypt.hash){
    case 'sha256': return E.sha256(buf);
    case 'blake2b': return E.blake2b(buf);
    default: assert.fail('unsupported hash '+crypt.hash);
  }
};

