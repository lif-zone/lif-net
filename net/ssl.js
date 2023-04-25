// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';

const E = {};
export default E;

E.start = opt=>{
  assert(!E.inited, 'ssl already inited');
  E.inited = true;
};

E.stop = ()=>{
  assert(E.inited, 'ssl not inited');
  E.inited = false;
};

// XXX:
// - allow hard-codrd ssl cert
// - renew acme certificate if >1m or <1m
// - solution for ssl local dev
