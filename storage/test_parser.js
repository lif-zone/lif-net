'use strict';
import assert from 'assert';
import string from '../util/string.js';

const E = {};
export default E;

function space(s){ return s ? ' '+s : ''; }

E.rm_parentesis = rm_parentesis;
function rm_parentesis(s, open='('){
  if (open==''){
    open = s.charAt(0);
    if (!['(', '[', '{'].includes(open))
      return s;
  } else if (s.charAt(0)!=open)
    return s;
  let close = open=='(' ? ')' : open=='{' ? '}' : open=='[' ? ']' : '';
  assert(close, 'invalid open parentesis '+open);
  assert(s.charAt(s.length-1)==close, 'missing parentesis '+s);
  return s.substr(1, s.length-2);
}

E.parse_get_next = function(curr){
  let i=0, s=curr, state='pre', done=false, exp='', parentesis = [], vars = {};
  let at, skip_macro;
  if (typeof curr!='string'){
    if (curr.at===undefined)
      return;
    i = curr.at;
    s = curr.s;
    vars = curr.vars||{};
    skip_macro = curr.skip_macro;
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
    return {exp, s, at, vars, skip_macro};
  }
  if (exp.startsWith('$$')){
    if (exp=='$$last'){
      assert(vars.last, 'missing $$last');
      return {exp: vars.last, s, at, vars, skip_macro};
    }
    let m = exp.match(/^\$\$([a-zA-Z][a-zA-Z0-9]*)\((.*)\)$/);
    if (m){
      vars[m[1]] = m[2];
      let l = s.substr(0, curr.at||0), r = s.substr(at);
      return E.parse_get_next({s: l+' '+r, at: curr.at||0, vars, skip_macro});
    }
    vars.last = exp;
    return {exp, s, at, vars, skip_macro};
  }
  if (skip_macro)
    return {exp, s, at, vars, skip_macro};
  if (exp.includes('$')){
    let _exp = replace_macro_vars(exp, vars);
    if (_exp!=exp){
      let l = s.substr(0, curr.at||0), r = s.substr(at);
      return E.parse_get_next({s: l+_exp+' '+r, at: curr.at||0, vars,
        skip_macro});
    }
    let i = s.substr(at).indexOf('$$');
    assert(i!=-1, 'missing $$');
    let curr2 = E.parse_get_next({s, at: i+at, vars}), ss = '';
    assert(curr2, 'missing $$');
    let o = E.parse_exp(curr2.exp);
    assert.equal(o.cmd, '$$', 'missing $$');
    assert(!o.l, 'invalid $$ '+curr2.exp);
    exp = s.substr(curr.at||0, i+at-(curr.at||0));
    get_array_str(o.r, null).forEach(els=>{
      let args = {};
      get_array_str(els, '').forEach((el, i)=>args[i+1]=el=='!' ? '' : el);
      let _s = replace_macro_vars(exp, args);
      _s = replace_macro_vars(_s, vars);
      _s = apply_macro_funcs(_s);
      ss += (_s ? ' ' : '')+_s;
    });
    assert(!ss.includes('$'), 'missing args for '+exp+'\n\n'+curr2.exp+
      '\n\n'+ss);
    let l = s.substr(0, curr.at||0), r = s.substr(curr2.at);
    return E.parse_get_next({s: l+ss+' '+r, at: curr.at||0, vars, skip_macro});
  }
  return {exp, s, at, vars, skip_macro};
};

// XXX: need test
function apply_macro_funcs(s){
  let func, body, start, parentesis, queue = [];
  for (let i=0; i<s.length; i++){
    let ch = s.charAt(i);
    if (ch=='$'){
      assert(!func, 'invalid macro func usage i '+i+' '+s);
      func = '$';
      parentesis = 0;
      start = i;
      body = '';
      continue;
    }
    if (!func)
      continue;
    if (ch=='(' && !parentesis){
      parentesis++;
      continue;
    }
    if (!parentesis){
      func += ch;
      continue;
    }
    if (ch=='(')
      parentesis++;
    else if (ch==')'){
      parentesis--;
      if (!parentesis){
        queue.push({func, body, start, end: i+1});
        func = body = '';
        continue;
      }
    } else
      body += ch;
  }
  if (!queue.length)
    return s;
  queue.reverse();
  let l, r, mid, a;
  for (let i=0; i<queue.length; i++){
    let o = queue[i];
    switch (o.func){
    case '$rev':
      l = s.substr(0, o.start);
      r = s.substr(o.end);
      mid = s.substr(o.start+o.func.length+1, o.end-o.start-o.func.length-2);
      a = get_array_str(mid, '');
      s = l+mid[0]+a.reverse().join(' ')+mid[mid.length-1]+r;
      break;
    default: assert.fail('invalid marco_func ' +o.func);
    }
  }
  return s;
}

function replace_macro_vars(s, vars){
  for (let v in vars)
    s = s.replace(new RegExp('\\$'+v+'\\b', 'g'), vars[v]);
  return s;
}

function get_array_str(s, open){
  let ret = [];
  if (open!==null)
    s = rm_parentesis(s, open===undefined ? '[' : open);
  let curr = E.parse_get_next({s, at: 0, skip_macro: true});
  for (; curr; curr = E.parse_get_next(curr)){
    if (!/^\/\//.test(curr.exp))
      ret.push(curr.exp);
  }
  return ret;
}
E.get_array_str = get_array_str;

E.parse_push = function(curr, s){
  let pre = curr.s.substr(0, curr.at), post = curr.s.substr(curr.at);
  curr.s = pre+' '+s+' '+post;
};

E._parse_exp = function(s){
  assert(s, 'missing string');
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

