// author: derry. coder: arik.
'use strict';
import array from './array.js';
const E = {};
export default E;

E.cmp = (a, b)=>a==b ? 0 : a<b ? -1 : 1;
// XXX: need test to all api below
E.split_trim = (s, sep, limit)=>array.compact_self(s.split(sep, limit));
E.split_ws = s=>E.split_trim(s, /\s+/);
E.is_ws = s=>/^\s$/.test(s);
E.is_lower = ch=>/^[a-z]$/.test(ch);
E.is_upper = ch=>/^[A-Z]$/.test(ch);
