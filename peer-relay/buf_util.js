// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import {Buffer} from 'buffer';

const E = {};
export default E;

E.buf_to_str = E.b2s = function(b){ return b ? b.toString('hex') : ''; };
E.buf_from_str = E.s2b = function(s){ return Buffer.from(s, 'hex'); };
E.buf_eq = function(a, b){ return a && b ? a.equals(b) : !a && !b; };
E.b2s_obj = function(o, ret){ // XXX: need test
  if (!o || !(o instanceof Object))
    return o;
  if (Array.isArray(o)){
    ret = ret||[];
    for (let i=0; i<o.length; i++)
      ret[i] = E.b2s_obj(o[i]);
    return ret;
  }
  ret = ret||{};
  for (let name in o){
    let v = o[name];
    if (v instanceof Uint8Array)
      ret[name] = E.b2s(Buffer.from(v));
    else if (Buffer.isBuffer(v))
      ret[name] = E.b2s(v);
    else if (Array.isArray(v)){
      ret[name] = [];
      E.b2s_obj(v, ret[name]);
    }
    else if (v instanceof Object){
      ret[name] = {};
      E.b2s_obj(v, ret[name]);
    } else
      ret[name] = v;
  }
  return ret;
};
