'use strict'; /*jslint node:true*/
import assert from 'assert';
import string from '../util/string.js';

const E = {};
export default E;

E.parse_get_next = function(curr){
  let i=0, s=curr, state='pre', done=false, exp='', parentesis = [];
  let at;
  if (typeof curr!='string'){
    if (curr.at===undefined)
      return;
    i = curr.at;
    s = curr.s;
  }
  for (i; i<s.length && !done; i++){
    let c = s.charAt(i);
    switch (state){
    case 'pre':
      if (string.is_ws(c))
        continue;
      exp = c;
      state = 'exp';
      break;
    case 'exp':
      if (['(', '[', '{'].includes(c))
        parentesis.push(c);
      else if (c==')')
        assert.equal(parentesis.pop(), '(');
      else if (c==']')
        assert.equal(parentesis.pop(), '[');
      else if (c=='}')
        assert.equal(parentesis.pop(), '{');
      else if (!parentesis.length && string.is_ws(c)){
        state = 'post';
        continue;
      }
      exp += c;
      break;
    case 'post':
      if (!string.is_ws(c)){
        done = true;
        at = i;
      }
      break;
    default: assert.fail('invalid state '+state);
    }
  }
  if (!exp)
    return;
  return {exp, s, at};
};

E.parse_exp = function(s){
  s = s.trim();
  let c, parentesis = [], first;
  for (let i=0; i<s.length; i++){
    c = s.charAt(i);
    if (c=='('){
      first = first===undefined ? i : first;
      parentesis.push(c);
    }
    else if (c==')')
      assert.equal(parentesis.pop(), '(');
    else if (!parentesis.length && ['+', '-', ':', '='].includes(c)){
      let cn = s.charAt(i+1);
      if (cn=='=')
        return {op: c+cn, l: s.substr(0, i), r: s.substr(i+2)};
      return {op: c, l: s.substr(0, i), r: s.substr(i+1)};
    }
  }
  assert.equal(parentesis.length, 0);
  if (first==undefined)
    return {cmd: s, arg: ''};
  assert.equal(s[s.length-1], ')');
  return {cmd: s.substr(0, first), arg: s.substr(first+1, s.length-first-2)};
};
