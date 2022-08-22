// author: derry. coder: arik.
'use strict'; /*jslint node:true,browser:true*/
import sodium from 'sodium-universal';
import b4a from 'b4a'; // XXX: rm
import {Buffer} from 'buffer';

const E = {};
export default E;

// XXX: need test
E.key_pair = function(seed){
  const pub = b4a.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES);
  const key = b4a.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES);
  if (seed)
    sodium.crypto_sign_seed_keypair(pub, key, seed);
  else
    sodium.crypto_sign_keypair(pub, key);
  return {pub: Buffer.from(pub), key: Buffer.from(key)};
};

// XXX: need test
E.sign = function(buf, key){
  const sig = b4a.allocUnsafe(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, buf, key);
  return Buffer.from(sig);
}
