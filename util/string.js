// author: derry. coder: arik.
'use strict'; /*jslint node:true,browser:true*/
import array from './array.js';
const E = {};
export default E;

E.split_trim = function(s, sep, limit){
  return array.compact_self(s.split(sep, limit)); };
E.split_ws = function(s){ return E.split_trim(s, /\s+/); };
E.is_ws = function(s){ return /^\s$/.test(s); };
E.is_lower = function(ch){ return /^[a-z]$/.test(ch); };
E.is_upper = function(ch){ return /^[A-Z]$/.test(ch); };
