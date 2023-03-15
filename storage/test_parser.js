'use strict';
import assert from 'assert';
import string from '../util/string.js';
import xerr from '../util/xerr.js';

const E = {};
export default E;

E.rm_parentesis = rm_parentesis;
function rm_parentesis(s, open='('){
  if (open==''){
    open = s.at(0);
    if (!['(', '[', '{'].includes(open))
      return s;
  } else if (s.at(0)!=open)
    return s;
  let close = open=='(' ? ')' : open=='{' ? '}' : open=='[' ? ']' : '';
  assert(close, 'invalid open parentesis '+open);
  assert(s.at(s.length-1)==close, 'missing parentesis '+s);
  return s.substr(1, s.length-2);
}

E.parse_get_next = function(curr){
  if (typeof curr=='string')
    curr = {s: curr, at: 0};
  if (curr.at===undefined)
    return;
  let {s, vars, skip_macro} = curr, i = curr.at, at;
  let state='pre', done=false, exp='', parentesis = [];
  vars = vars||{};
  for (i; i<s.length && !done; i++){
    let c = s.at(i);
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
        assert.strictEqual(parentesis.pop(), '(');
      else if (c==']')
        assert.strictEqual(parentesis.pop(), '[');
      else if (c=='}')
        assert.strictEqual(parentesis.pop(), '{');
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
    at = nl==-1 ? undefined : at+nl+1;
    return E.parse_get_next({s, at, vars, skip_macro});
  }
  if (exp.startsWith('$$')){
    if (exp=='$$last'){
      assert(vars['$$last'], 'missing $$last');
      return {exp: vars['$$last'], s, at, vars, skip_macro};
    }
    let m = exp.match(/^\$\$([a-zA-Z][a-zA-Z0-9]*)\(([.\s\S]*)\)$/);
    if (m){
      vars[m[1]] = m[2];
      let l = s.substr(0, curr.at||0), r = s.substr(at);
      return E.parse_get_next({s: l+' '+r, at: curr.at||0, vars, skip_macro});
    }
    vars['$$last'] = exp;
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
    assert.strictEqual(o.cmd, '$$', 'missing $$');
    assert(!o.l, 'invalid $$ '+curr2.exp);
    exp = s.substr(curr.at||0, i+at-(curr.at||0));
    vars.last = exp;
    get_array_str(o.r, null).forEach(els=>{
      let args = {};
      get_array_str(els, '').forEach((el, i)=>args[i+1]=el=='!' ? '' : el);
      let _s = replace_macro_vars(exp, args);
      _s = replace_macro_vars(_s, vars);
      _s = apply_macro_funcs(_s);
      ss += (_s ? ' ' : '')+_s;
      assert(!_s.includes('$'), 'missing args for '+exp+'\n\n'+curr2.exp+
        '\n\n'+_s);
    });
    let l = s.substr(0, curr.at||0), r = s.substr(curr2.at);
    return E.parse_get_next({s: l+ss+' '+r, at: curr.at||0, vars, skip_macro});
  }
  return {exp, s, at, vars, skip_macro};
};

// XXX: need test
function apply_macro_funcs(s){
  let func, body, start, parentesis, queue = [], _s = s;
  for (let i=0; i<s.length; i++){
    let ch = s.at(i);
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
    case '$rm_parentesis':
      l = s.substr(0, o.start);
      r = s.substr(o.end);
      mid = s.substr(o.start+o.func.length+1, o.end-o.start-o.func.length-2);
      s = l+rm_parentesis(mid, '')+r;
      break;
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
  if (s!=_s)
    xerr.notice('macro_funcs %s -> %s', _s, s);
  return s;
}

function replace_macro_vars(s, vars){
  let _s = s;
  for (let v in vars)
    s = s.replace(new RegExp('\\$'+v+'\\b', 'g'), vars[v]);
  if (s!=_s)
    xerr.notice('macro_vars %s -> %s', _s, s);
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

// XXX: need test
function remove_comments(s){
  let ret = '', comment;
  for (let i=0; i<s.length; i++){
    let ch = s.at(i);
    if (s.substr(i, 2)=='//'){
      comment = true;
      continue;
    }
    if ('\n'==ch)
      comment = false;
    if (comment)
      continue;
    ret += ch;
  }
  return ret;
}

E._parse_exp = function(s){
  assert(s, 'missing string');
  let c, parentesis = [], first, meta = {s: s.trim()};
  s = remove_comments(s);
  s = string.split_ws(s).join(' ');
  // XXX: rm special handling for # and ##
  if ('##'==s.substr(0, 2))
    return {cmd: '##', l: '', r: rm_parentesis(s.substr(2).trim()), meta};
  if ('#'==s.at(0))
    return {cmd: '#', l: '', r: rm_parentesis(s.substr(1).trim()), meta};
  if ('//'==s.substr(0, 2))
    return {cmd: '//', l: '', r: s.substr(2).trim(), meta};
  if ('!'==s.at(0))
    return {cmd: '!', l: '', r: s.substr(1).trim(), meta};
  for (let i=0; i<s.length; i++){
    c = s.at(i);
    let cn = s.at(i+1), cnn= s.at(i+2);
    if (c=='('){
      first = first===undefined ? i : first;
      parentesis.push(c);
    }
    else if (c==')')
      assert.strictEqual(parentesis.pop(), '(');
    else if (!parentesis.length && ['+', '-', ':', '=', '.'].includes(c)){
      if (cn==cnn && ['=', '.'].includes(cnn)){
        assert.strictEqual(s.at(i), cn, 'invalid exp '+s);
        assert.strictEqual(s.at(i), cnn, 'invalid exp '+s);
        return {cmd: c+cn+cnn, l: s.substr(0, i), r: s.substr(i+3), meta};
      }
      if (['=', '.'].includes(cn)){
        assert(s.at(i)==':' && cn=='=' || s.at(i)==cn,
          'invalid exp '+s);
        return {cmd: c+cn, l: s.substr(0, i),
          r: rm_parentesis(s.substr(i+2)), meta};
      }
      return {cmd: c, l: s.substr(0, i), r: s.substr(i+1), meta};
    }
  }
  assert.strictEqual(parentesis.length, 0, 'invalid parentesis '+s);
  if (first==undefined)
    return {cmd: s, l: '', r: '', meta};
  assert.strictEqual(s[s.length-1], ')');
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

