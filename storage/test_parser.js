'use strict'; /*jslint node:true*/
import assert from 'assert';
import string from '../util/string.js';

const E = {};
export default E;

function space(s){ return s ? ' '+s : ''; }

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
  if (at===undefined)
    at = s.length;
  if (exp=='//'){
    let nl = s.substr(at).search('\n');
    if (nl==-1){
      exp += space(s.substr(at));
      at = undefined;
    } else {
      exp += space(s.substr(at, nl));
      at += nl+1;
    }
    return {exp, s, at};
  }
  return {exp, s, at};
};

E._parse_exp = function(s){
  s = s.trim();
  let c, parentesis = [], first, meta = {s};
  if ('//'==s.substr(0, 2))
    return {cmd: '//', l: '', r: s.substr(2).trim(), meta};
  for (let i=0; i<s.length; i++){
    c = s.charAt(i);
    if (c=='('){
      first = first===undefined ? i : first;
      parentesis.push(c);
    }
    else if (c==')')
      assert.equal(parentesis.pop(), '(');
    else if (!parentesis.length && ['+', '-', ':', '=', '.'].includes(c)){
      let cn = s.charAt(i+1), cnn= s.charAt(i+2);
      if (cn==cnn && ['=', '.'].includes(cnn)){
        assert.equal(s.charAt(i), cn, 'invalid exp '+s);
        assert.equal(s.charAt(i), cnn, 'invalid exp '+s);
        return {cmd: c+cn+cnn, l: s.substr(0, i), r: s.substr(i+3), meta};
      }
      if (['=', '.'].includes(cn)){
        assert.equal(s.charAt(i), cn, 'invalid exp '+s);
        return {cmd: c+cn, l: s.substr(0, i), r: s.substr(i+2), meta};
      }
      return {cmd: c, l: s.substr(0, i), r: s.substr(i+1), meta};
    }
  }
  assert.equal(parentesis.length, 0, 'invalid parentesis '+s);
  if (first==undefined)
    return {cmd: s, l: '', r: '', meta};
  assert.equal(s[s.length-1], ')');
  return {cmd: s.substr(0, first), l: '',
    r: s.substr(first+1, s.length-first-2), meta};
};

E.parse_exp = function(s){
  let o = E._parse_exp(s);
  assert(o?.cmd, 'invalid experssion');
  return o;
};

E.parse_exp_arg = function(exp){
  let t = E.parse_exp(exp);
  if (t.cmd!=':')
    return t;
  t.cmd = t.l;
  t.l = '';
  return t;
};

E.parse_exp_arg_pair = function(exp){
  let m;
  if (exp.includes(':')){
    m = exp.match(/^([^:]+):([^:]+)$/);
    assert(m, 'invalid arg_pair '+exp);
    return {l: m[1], r: m[2]};
  }
  else if (m = exp.match(/^([^(^)]+)\(([^(^)]+)\)$/))
    return {l: m[1], r: m[2]};
  m = exp.match(/(^[^.]*)(\.*)([^.]*)$/);
  assert(m, 'invalid arg_pair '+exp);
  return ['.', '..', '...'].includes(m[2]) ? {l: m[3], r: m[0]} :
    {l: m[0], r: m[1]};
};

