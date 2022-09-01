import crypto from 'hypercore-crypto';
import sodium from 'sodium-universal';
import b4a from 'b4a';
import c from 'compact-encoding';

const E = {};

// TODO: rename this to "crypto" and move everything hashing related etc in here
// Also lets move the tree stuff from hypercore-crypto here

const [TREE, REPLICATE_INITIATOR, REPLICATE_RESPONDER] = crypto.namespace('hypercore', 3)

E.replicate = function (isInitiator, key, handshakeHash) {
  const out = b4a.allocUnsafe(32)
  sodium.crypto_generichash_batch(out, [isInitiator ? REPLICATE_INITIATOR : REPLICATE_RESPONDER, key], handshakeHash)
  return out
}

E.treeSignable = function (hash, length, fork) {
  const state = { start: 0, end: 80, buffer: b4a.allocUnsafe(80) }
  c.raw.encode(state, TREE)
  c.raw.encode(state, hash)
  c.uint64.encode(state, length)
  c.uint64.encode(state, fork)
  return state.buffer
}

E.treeSignableLegacy = function (hash, length, fork) {
  const state = { start: 0, end: 48, buffer: b4a.allocUnsafe(48) }
  c.raw.encode(state, hash)
  c.uint64.encode(state, length)
  c.uint64.encode(state, fork)
  return state.buffer
}

export default E;
