'use strict';
import assert from 'assert';
import string from '../util/string.js';

const E = {};
export default E;

function space(s){ return s ? ' '+s : ''; }

E.rm_parentesis = rm_parentesis;
function rm_parentesis(s, open='('){
  if (s.charAt(0)!=open)
    return s;
  let close = open=='(' ? ')' : open=='{' ? '}' : open=='[' ? ']' : '';
  assert(close, 'invalid open parentesis '+open);
  assert(s.charAt(s.length-1)==close, 'missing parentesis '+s);
  return s.substr(1, s.length-2);
}

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
      if (['(', '[', '{'].includes(c))
        parentesis.push(c);
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
  if (exp.indexOf('$$')!=-1)
    return {exp, s, at};
  if (exp.indexOf('$')!=-1){
    let curr2 = E.parse_get_next({s, at}), ss = '';
    assert(curr2, 'missing $$');
    let o = E.parse_exp(curr2.exp);
    assert.equal(o.cmd, '$$', 'missing $$');
    assert(!o.l, 'invalid $$ '+curr2.exp);
    get_array_str(o.r).forEach(els=>{
      let _s = exp;
      get_array_str(els).forEach((el, i)=>
        _s = _s.replace(new RegExp('\\$'+(i+1)+'\\b', 'g'), el));
      ss += (_s ? ' ' : '')+_s;
    });
    assert(-1==ss.indexOf('$'), 'missing args for '+exp);
    let l = s.substr(0, curr.at||0);
    let r = s.substr(curr2.at);
    return E.parse_get_next({s: l+ss+' '+r, at: curr.at||0});
  }
  return {exp, s, at};
};

function get_array_str(s){
  let ret = [];
  s = rm_parentesis(s, '[');
  for (let curr=s; curr = E.parse_get_next(curr);)
    ret.push(curr.exp);
  return ret;
}
E.get_array_str = get_array_str;

E.parse_push = function(curr, s){
  let pre = curr.s.substr(0, curr.at), post = curr.s.substr(curr.at);
  curr.s = pre+' '+s+' '+post;
};

E._parse_exp = function(s){
  let c, parentesis = [], first, meta = {s: s.trim()};
  s = string.split_ws(s).join(' ');
  // XXX: rm special handling for # and ##
  if ('##'==s.substr(0, 2))
    return {cmd: '##', l: '', r: rm_parentesis(s.substr(2).trim()), meta};
  if ('#'==s.charAt(0))
    return {cmd: '#', l: '', r: rm_parentesis(s.substr(1).trim()), meta};
  if ('//'==s.substr(0, 2))
    return {cmd: '//', l: '', r: s.substr(2).trim(), meta};
  if ('!'==s.charAt(0))
    return {cmd: '!', l: '', r: s.substr(1).trim(), meta};
  for (let i=0; i<s.length; i++){
    c = s.charAt(i);
    let cn = s.charAt(i+1), cnn= s.charAt(i+2);
    if (c=='('){
      first = first===undefined ? i : first;
      parentesis.push(c);
    }
    else if (c==')')
      assert.equal(parentesis.pop(), '(');
    else if (!parentesis.length && ['+', '-', ':', '=', '.'].includes(c)){
      if (cn==cnn && ['=', '.'].includes(cnn)){
        assert.equal(s.charAt(i), cn, 'invalid exp '+s);
        assert.equal(s.charAt(i), cnn, 'invalid exp '+s);
        return {cmd: c+cn+cnn, l: s.substr(0, i), r: s.substr(i+3), meta};
      }
      if (['=', '.'].includes(cn)){
        assert(s.charAt(i)==':' && cn=='=' || s.charAt(i)==cn,
          'invalid exp '+s);
        return {cmd: c+cn, l: s.substr(0, i),
          r: rm_parentesis(s.substr(i+2)), meta};
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
  if (/^[^(]+:.*$/.test(exp)){
    m = exp.match(/^([^:]+):([^:]+)$/);
    assert(m, 'invalid arg_pair '+exp);
    return {l: m[1], r: m[2]};
  }
  if (m = exp.match(/^([^(^)]+)\(([^(^)]+)\)$/))
    return {l: m[1], r: m[2]};
  m = exp.match(/(^[^.]*)(\.*)([^.]*)$/);
  assert(m, 'invalid arg_pair '+exp);
  return ['.', '..', '...'].includes(m[2]) ? {l: m[3], r: m[0]} :
    {l: m[0], r: m[1]};
};

