// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import {Buffer} from 'buffer';

const E = {};
export default E;

E.buf_to_str = function(b){ return b ? b.toString('hex') : ''; };
E.buf_from_str = function(s){ return Buffer.from(s, 'hex'); };
E.buf_eq = function(a, b){ return a && b ? a.equals(b) : !a && !b; };
