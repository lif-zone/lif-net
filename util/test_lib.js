// author: derry. coder: arik.
'use strict'; /*eslint-env mocha*/
import proc from './proc.js';
import etask from './etask.js';
import xutil from './util.js';
import xerr from './xerr.js';
import string from '../util/string.js';
import date from './date.js';
import sprintf from './sprintf.js';
import assert from 'assert';
import assertion from 'assertion';
import net from 'net';
import _ from 'lodash';
import big_object_diff from 'big-object-diff';
const assign = Object.assign;
const is_node = process?.versions?.node!==undefined;

const E = {};
export default E;

E.currentTest = undefined;

E.currentTest_title = ()=>{
    if (!E.currentTest)
        return '';
    let path = [];
    for (let parent = E.currentTest; parent && !parent.root;
        parent = parent.parent)
    {
        path.unshift(parent.title);
    }
    return path.join(' -> ');
};

let stringify_dates = obj=>_.each(obj, (val, key)=>{
    if (_.isDate(val) && !isNaN(val))
        obj[key] = 'Date Object: '+date.to_sql(val);
    else if (_.isObject(val))
        stringify_dates(val);
});

E.hook_assert = ()=>{
    let AssertionError;
    // avoid forcing running mocha/node with --expose-internals and avoid
    // import AssertionError from 'internal/assert/assertion_error';
    try { assert(false); }
    catch(err){ AssertionError = err.constructor; }
    const print = err=>{
        xerr.flush();
        const stack = new Error().stack;
        let msg = '\n', diff = '';
        msg += stack+'\n';
        if (etask.root.length)
            msg += '\netask '+etask.ps()+'\n';
        if (xutil.is_mocha())
            msg += '*** test '+E.currentTest_title()+' FAILED:\n';
        msg += 'Date.now '+Date.now()+'\n';
        if (err.message)
            msg += err.message+'\n';
        if (err.operator==='deepEqual'||err.operator=='deepStrictEqual')
        {
            [err.expected, err.actual].forEach(stringify_dates);
            diff = '\ndiff: '
                +big_object_diff.renderDiff(err.expected, err.actual)+'\n';
        }
        msg = sprintf(
            '%s\nexpected: %O\n\nactual:   %O\n%soperator: %s\n',
            msg, err.expected, err.actual, diff, err.operator);
        console.log(msg);
        debugger; // eslint-disable-line no-debugger
        return msg;
    };
    Object.defineProperty(AssertionError.prototype, 'operator', {
      get: function(){ return this._operator; },
      set: function(x){
          let msg;
          this._operator = x;
          if (E.assert_hook){
            E.assert_hook(this, print);
            return;
          }
          try { msg = print(this); }
          catch(e){ console.trace('unknown assert error'); }
          if (is_node)
            process.exit(1);
          else
            throw new Error(msg||'assert error');
      },
    });
};

E.test = (app, test_func, hooks)=>{
    hooks = hooks||{};
    let test_name = (test_func ? test_func.name : '')||'trivial_require_test';
    describe(test_name, ()=>{
    let _app;
    before(()=>etask(function*(){
        if (hooks.before)
            yield hooks.before();
        _app = require(app);
        assert(_app.run);
        if (hooks.port && typeof hooks.port=='function')
            process.env.PORT = yield hooks.port();
        else if (hooks.port)
            process.env.PORT = hooks.port;
        return yield _app.run();
    }));
    after(()=>etask(function*(){
        if (hooks.after)
            yield hooks.after();
        assert(_app.stop);
        return yield _app.stop();
    }));
    /* We need to make sure that at least one test is defined in order for
     * the before/after will be called. */
    it('test_stub', done=>done());
    if (test_func)
        test_func(_app);
    });
};

E.create_test_buffer = ()=>{
    let buf = Buffer.allocUnsafe(256);
    for (let i=0; i<buf.length; i++)
        buf[i] = i;
    return buf;
};

E.seq_fn = expected=>{
    let i = 0, ok = true;
    return val=>{
        if (!_.isEqual(expected[i], val))
        {
            console.log('failed. i:%d res:%j exp:%j', i, val, expected[i]);
            ok = false;
        }
        if (typeof expected[i+1]=='function')
            expected[i+1](!ok ? 'error' : undefined);
        i++;
    };
};

let env_stack = [];
E.env_push = set=>{
    assert(env_stack.length<10, 'already pushed env more than 10');
    env_stack.push(xutil.clone(process.env));
    if (set)
        E.set_clone(process.env, set);
};
E.env_pop = ()=>{
    assert(env_stack.length, 'env not pushed');
    E.set_clone(process.env, env_stack.pop());
};

let argv_stack = [];
E.argv_push = set=>{
    assert(argv_stack.length<10, 'already pushed argv more than 10');
    argv_stack.push(process.argv.slice());
    if (set)
        E.set_clone(process.argv, set);
};
E.argv_pop = ()=>{
    assert(argv_stack.length, 'argv not pushed');
    E.set_clone(process.argv, argv_stack.pop());
};

E.set_clone = (dst, src)=>{
    let i;
    if (dst===src)
        return;
    if (dst instanceof Array)
    {
        dst.length = 0;
        for (i=0; i<src.length; i++)
            dst[i] = src[i];
    }
    else if (dst instanceof Object)
    {
        for (i in dst)
            delete dst[i];
        for (i in src)
            dst[i] = src[i];
    }
    else
        assert(0, 'dst not Array or Object');
};

assert.has = (res, exp)=>{
    try { assertion.assert.has(res, exp); }
    catch(e){ assert(0, ''+e); }
};
assert.zero = (result, message)=>assert.equal(result, 0, message);

let test_prop_changes = [];
let on_test_prop_changed = ()=>{
    let old_val;
    while (old_val = test_prop_changes.pop())
    {
        if (old_val.exist)
            old_val.obj[old_val.prop] = old_val.value;
        else
            delete old_val.obj[old_val.prop];
    }
};

E.r_push_pop_prop = function(obj, prop, val){
    let prev, a = arguments, exist;
    if (prop && typeof prop=='object')
    {
        for (let i in prop)
            E.r_push_pop_prop(obj, i, prop[i]);
        return;
    }
    if (E.currentTest!==undefined)
    {
        test_prop_changes.push({obj, prop, value: obj[prop],
            exist: prop in obj});
        obj[prop] = val;
        return;
    }
    beforeEach(()=>{
        exist = prop in obj;
        prev = obj[prop];
        if (a.length==3)
            obj[prop] = val;
    });
    afterEach(()=>{
        if (test_prop_changes.length)
            on_test_prop_changed();
        if (exist)
            obj[prop] = prev;
        else
            delete obj[prop];
    });
};

E.seq_curr = undefined;
E.seq_init = last=>{
    E.seq_curr = undefined;
    E.seq_last = last;
};
E.seq = function(seq){
    if (seq===false || typeof seq=='string')
        assert(0, typeof seq=='string' ? seq : 'should not get here');
    E.seq_curr = E.seq_curr===undefined ? 0 : E.seq_curr+1;
    for (let i=0; i<arguments.length && (seq = arguments[i])<E.seq_curr; i++);
    assert.equal(seq, E.seq_curr, 'expected seq '+E.seq_curr+', but got '+seq);
    return true;
};
E.seq_uninit = ()=>{
    if (E.seq_curr===undefined)
        return;
    if (E.seq_last!==undefined)
    {
        assert.equal(E.seq_curr, E.seq_last, 'expected seq '+E.seq_last+
            ' at end of test, but got '+E.seq_curr);
        E.seq_last = undefined;
    }
    E.seq_curr = undefined;
};

E.assert_no_etasks = ()=>{
    let ps = etask.ps({TIME: 0});
    assert.equal(ps, 'root\n', 'etask root not empty:\n'+ps);
};

E.assert_no_etasks = async()=>{
    let ps = etask.ps({TIME: 0});
    if (ps=='root\n')
      return;
    // in brower, mocha tests of the format it(xxx, etask(...) will faill:
    // 1. mocha.runner will call setImmediate in etask.after() to invoke
    // afterEach()
    // 2. in browser, nextTick is implemented as setImmediate and as a result
    // then_wait will no finish to cleanup and we will get it in etask.ps()
    // events order: nextTick, setImmediate, setTimeout
    let p = new Promise(resolve=>{
      setTimeout(()=>{
        ps = etask.ps({TIME: 0});
        assert.equal(ps, 'root\n', 'etask root not empty:\n'+ps);
        resolve();
      });
    });
    return p;
};

E.assert_etask_err = et=>etask(function*assert_etask_err(){
    try { yield et; }
    catch(e){ return; }
    assert(0, 'expected etask to fail');
});

E.expect_fn = fn=>(err, res)=>{
    if (err)
        throw err;
    return fn();
};

E.get_free_port = ()=>etask(function*get_free_port(){
    let port, wait = etask.wait();
    let server = net.createServer();
    server.on('error', err=>{
        server.close();
        xerr.xexit(err);
    });
    server.on('close', ()=>wait.return());
    server.listen(0, ()=>{
        port = server.address().port;
        server.close();
    });
    yield wait;
    server.removeAllListeners();
    return port;
});

E.etask = (opt, states)=>{
    let seq = E.seq;
    if (Array.isArray(opt) || typeof opt=='function')
    {
        states = opt;
        opt = {};
    }
    if (typeof opt=='number')
        opt = {seq: opt};
    opt = opt||{};
    // don't convert to ES6 generators, since this tests etask itself!
    return etask('xtest.etask', [function(){
        seq(0);
        return etask(Object.assign({name: 'et_call'}, opt), states);
    }, function(res){
        assert(!('err' in opt),
            'got etask ret '+res+', expected err '+opt.err);
        if ('ret' in opt)
        {
            if (typeof opt.ret=='function')
                assert(opt.ret(res), 'ret value mismatch');
            else
                assert.deepEqual(res, opt.ret);
        }
        this.via_res = true;
    }, function catch$(err){
        assert('err' in opt, 'got etask err '+(err.stack||err));
        if (typeof opt.err=='function')
            assert(opt.err(err), 'err value mismatch');
        else if (opt.err!='any')
            assert.deepEqual(err, opt.err);
        this.via_err = true;
    }, function finally$(){
        assert.equal(!!this.via_err, 'err' in opt);
        assert.equal(!!this.via_res, !('err' in opt));
        seq(opt.seq||1);
    }]);
};

E.set = E.r_push_pop_prop;

E.stub_req = opt=>{
    let req = {
        query: Object.assign({}, opt&&opt.query),
        headers: {},
        body: opt&&opt.body,
    };
    if (opt&&opt.headers)
    {
        for (let k in opt.headers)
            req.headers[k.toLowerCase()] = opt.headers[k];
    }
    req.get = k=>req.headers[k.toLowerCase()];
    req.zparam = (k, def)=>{
        // eslint-disable-next-line no-prototype-builtins
        if (req.body && req.body[k]!=null && req.body.hasOwnProperty(k))
            return req.body[k];
        return req.query[k]!=null ? req.query[k] : def;
    };
    return req;
};

E.stub_res = sb=>{
    let res = {state: {}, data: {}};
    res.data.headers = {};
    res.status = s=>{
        if (res.state.sent)
            throw new Error('Already sent');
        res.state.status = s;
        return res;
    };
    sb.spy(res, 'status');
    res.send = body=>{
        if (res.state.sent)
            throw new Error('Already sent');
        res.state.status = res.state.status||200;
        if (body!==undefined)
            res.data.body = body;
        res.state.sent = true;
        return res;
    };
    res.json = res.send;
    sb.spy(res, 'send');
    sb.spy(res, 'json');
    res.sendStatus = s=>{
        if (res.state.sent)
            throw new Error('Already sent');
        res.state.status = s;
        res.state.sent = true;
        return res;
    };
    sb.spy(res, 'sendStatus');
    res.redirect = url=>{
        if (res.state.sent)
            throw new Error('Already sent');
        res.state.status = 302;
        res.data.headers.location = url;
        res.state.sent = true;
        return res;
    };
    sb.spy(res, 'redirect');
    let set_header = (k, v)=>res.data.headers[(''+k).toLowerCase()] = ''+v;
    res.set = function(k_or_obj, v){
        if (res.state.sent)
            throw new Error('Already sent');
        if (v===undefined && k_or_obj!=null && typeof k_or_obj=='object')
        {
            for (let k in k_or_obj)
                set_header(k, v);
        }
        else
            set_header(k_or_obj, v);
        return res;
    };
    sb.spy(res, 'set');
    res.end = ()=>{
        if (res.state.sent)
            throw new Error('Already sent');
        res.state.status = res.state.status||200;
        res.state.sent = true;
        return res;
    };
    sb.spy(res, 'end');
    res.cookie = (name, value, opt)=>{
        if (res.state.sent)
            throw new Error('Already sent');
        res.data.cookies = res.data.cookies||{};
        res.data.cookies[name] = {value, opt};
    };
    return res;
};

function throw_invalid(s, i){
  throw new Error('invalid '+s.substr(0, i)+'^^^'+s.substr(i)); }

function assert_invalid(exp, s, i){
  if (!exp)
    throw_invalid(s, i);
}

E.test_parse_cmd_single = function(s, opt){
  opt = opt||{};
  let state = 'pre', i, ret={}, cmd_s=0, cmd_e = s.length, arg_s=0, arg_e=0;
  let parentesis = 0, done, comment;
  for (i=0; i<s.length && !done; i++){
    let c = s.charAt(i);
    switch (state){
    case 'pre':
      if (string.is_ws(c))
        continue;
      assert_invalid(!'()'.includes(c), s, i);
      state = 'cmd';
      cmd_s = i;
      comment = c=='/';
      break;
    case 'cmd':
      assert_invalid(!')'.includes(c), s, i);
      if (comment && c=='/'){
        cmd_e = i+1;
        arg_s = i+1;
        state = 'arg';
        break;
      }
      comment = false;
      if (string.is_ws(c))
      {
        cmd_e = i;
        done = true;
      }
      else if ('('.includes(c))
      {
        cmd_e = i;
        arg_s = i+1;
        state = 'arg';
        parentesis++;
      }
      break;
    case 'arg':
      if (comment){
        if (c=='\r' || c==`\n`){
          arg_e = i;
          done = true;
        }
        break;
      }
      else if (c=='(')
        parentesis++;
      if (c==')')
        parentesis--;
      assert_invalid(parentesis>=0, s, i);
      if (!parentesis)
      {
        arg_e = i;
        done = true;
      }
      break;
    default: throw new Error('unknown parser error '+s);
    }
  }
  if (state=='pre')
    return;
  assert_invalid(!parentesis, s, i);
  if (comment && !done)
    arg_e = s.length;
  let cmd = ret.cmd = s.substr(cmd_s, cmd_e-cmd_s);
  if (arg_e>arg_s)
    ret.arg = s.substr(arg_s, arg_e-arg_s);
  else if (cmd.includes(':'))
  {
    if (!opt.no_dir &&
      cmd.includes('>') && cmd.indexOf('>') > cmd.indexOf(':'));
    else if (!opt.no_dir && cmd.includes('<') &&
      cmd.indexOf('<') > cmd.indexOf(':'));
    else {
      let m = cmd.match(/(^[^:]+):([^:]+$)/);
      assert_invalid(m, cmd, cmd.lastIndexOf(':'));
      ret.cmd = m[1];
      ret.arg = m[2];
    }
  }
  ret.meta = {last: i};
  ret.orig = s.substr(cmd_s, i-cmd_s).trim();
  return ret;
};

E.test_parse_cmd_multi = function(s, opt){
  if (!s)
    return [];
  let ret = [], t = E.test_parse_cmd_single(s, opt);
  if (!t)
    return;
  ret.push(t);
  let rest = E.test_parse_cmd_multi(s.substr(t.meta.last), opt);
  if (rest)
    ret = ret.concat(rest);
  return ret;
};

E.test_parse_cmd_multi_level = function(s){
  if (!s)
    return [];
  let ret = [], arg, t = E.test_parse_cmd_single(s);
  if (!t)
    return;
  let meta = t.meta;
  if (t.arg)
    arg = E.test_parse_cmd_multi_level(t.arg);
  ret.push(arg ? {cmd: t.cmd, arg, orig: t.orig, meta} :
    {cmd: t.cmd, orig: t.orig, meta});
  let rest = E.test_parse_cmd_multi_level(s.substr(t.meta.last));
  if (rest)
    ret = ret.concat(rest);
  return ret;
};

E.test_run_plugin = function(a, cb){
  if (!Array.isArray(a))
    return;
  a.forEach((o, i)=>{
    if (cb)
      a[i] = cb(o);
    if (o.arg)
      E.test_run_plugin(o.arg, cb);
  });
  return a;
};

E.parse_cmd_dir = function(s){
  if (!/^[^(^:]*[<>=]/.test(s))
    return {cmd: s};
  let _d = s.search(/[<>=]/);
  if (_d==-1)
    return {cmd: s};
  let loop = [], dir = s[_d], a='', b='', comma, no_comma, sign='';
  let dot_a, dot_b, cmd = s.substr(_d+1);
  let rt_opt_before, rt_opt_after, rt_path, rt_path_open;
  for (let i=0; i<_d+1; i++){
    let ch = s[i];
    assert_invalid(/[:a-zA-Z,.<>=~!?[\]]/i.test(ch), s, i);
    if (ch=='['){
      assert_invalid(!rt_path && !rt_path_open, s, i);
      rt_path_open = true;
      rt_path = '';
    } else if (ch==']'){
      assert_invalid(rt_path && rt_path_open, s, i);
      rt_path_open = false;
      if (dir=='<')
        rt_path = rt_path.split('').reverse().join('');
    } else if (rt_path_open){
      assert_invalid(/[a-zA-Z]/.test(ch), s, i);
      rt_path += ch;
    } else if (/[!?]/.test(ch)){
      if (dot_a || dot_b){
        assert_invalid(!rt_opt_after, s, i);
        rt_opt_after = ch;
      } else {
        assert_invalid(!rt_opt_before, s, i);
        rt_opt_before = ch;
      }
    } else if (ch=='~'){
      assert_invalid(!sign && /[a-zA-Z]/.test(s[i+1]), s, i);
      assert_invalid(dir=='>' ? s[i+2]=='>' : !i, s, i);
      sign = ch;
    } else if (ch=='.'){
      dot_b = dot_b || !!b;
      dot_a = dot_a || !b && !!a;
    }
    else if (/[<>=,]/.test(ch))
    {
      if (ch==','){
        assert_invalid(!no_comma, s, i);
        comma = true;
      }
      assert_invalid(a||b, s, i);
      if (loop.length)
      {
        assert_invalid(a||b, s, i);
        assert_invalid(
          a && loop[loop.length-1].s && !b && !loop[loop.length-1].d||
          !a && !loop[loop.length-1].s && b && loop[loop.length-1].d||
          a && loop[loop.length-1].s && b && loop[loop.length-1].d, s, i);
      }
      assert_invalid(dir!='=' || !b, s, i);
      assert_invalid(!rt_path_open, s, i);
      let sd = /[>=]/.test(dir) ? {s: a, d: b, dir} : {s: b, d: a, dir};
      if (rt_path){
        sd.rt_path = rt_path;
        rt_path = undefined;
      }
      if (dot_a){
        sd.dot = true;
        dot_a = false;
        if (rt_opt_before)
          sd.rt_opt = rt_opt_before;
        rt_opt_before = false;
      } else if (rt_opt_before)
        sd.rt_opt = rt_opt_before;
      assert_invalid(!dot_b, s, i);
      loop.push({...sd});
      loop[dir=='>' ? loop.length-1 : 0].d =
        sign+loop[dir=='>' ? loop.length-1 : 0].d;
      a = b = '';
    }
    else if (a && b)
    {
      assert_invalid(!comma, s, i);
      assert_invalid(dir!='=' || !b, s, i);
      assert_invalid(!rt_path_open, s, i);
      let sd = /[>=]/.test(dir) ? {s: a, d: b, dir} : {s: b, d: a, dir};
      if (rt_path){
        sd.rt_path = rt_path;
        rt_path = undefined;
      }
      no_comma = true;
      if (dot_a){
        sd.dot = true;
        dot_a = false;
        rt_opt_before = false;
        if (rt_opt_after){
          rt_opt_before = rt_opt_after;
          rt_opt_after = false;
          sd.rt_opt = rt_opt_before;
        }
      } else if (rt_opt_before)
        sd.rt_opt = rt_opt_before;
      if (dot_b){
        dot_a = true;
        dot_b = false;
      }
      loop.push({...sd});
      a = b;
      b = ch;
    }
    else if (!a)
      a = ch;
    else if (!b)
      b = ch;
    else
      assert(false);
  }
  assert_invalid(loop.length, s, _d);
  if (dir=='<'){
    loop.reverse();
    for (let i=0, first_dot=true; i<loop.length; i++){
      if (loop[i].dot && loop[i].rt_opt && first_dot)
        delete loop[i].rt_opt;
      if (loop[i].dot && loop[i+1]?.rt_opt)
        loop[i].rt_opt = loop[i+1].rt_opt;
      if (loop[i].dot && !first_dot)
        first_dot = false;
    }
  }
  return assign(loop.length>1 ? {loop} : loop[0], {cmd, meta: {cmd: s}},
    !comma ? {s: loop[0].s, d: loop[loop.length-1].d,
    dir: loop[0].dir} : undefined, comma ? {comma} : undefined);
};

E.plugin_cmd_dir = function(o){
  let t = E.parse_cmd_dir(o.cmd);
  let o2 = assign({}, o);
  assign(o, t, {arg: o2.arg, orig: o2.orig});
  o.meta = assign(o.meta||{}, o2.meta);
  return o;
};

E.test_parse_rm_meta = function(a){
  return E.test_run_plugin(a, o=>{
    delete o.meta;
    return o;
  });
};

E.test_parse_rm_meta_orig = function(a){
  return E.test_run_plugin(a, o=>{
    delete o.meta;
    delete o.orig;
    return o;
  });
};

E.test_parse = function(s){
  return E.test_run_plugin(E.test_parse_cmd_multi(s), E.plugin_cmd_dir); };

E.test_parse_no_dir = function(s){
  return E.test_run_plugin(E.test_parse_cmd_multi(s, {no_dir: true}),
    E.plugin_cmd_dir);
};

E.test_parse_plugin = function(s, plugin, opt){
  return E.test_run_plugin(E.test_parse_cmd_multi(s, opt), plugin); };

E.arg_to_val = function(arg){
  if (!arg)
    return true;
  if (arg.length==1 && !arg[0].arg)
    return arg[0].cmd;
  return arg;
};

E.arg_to_obj = function(arg){
  let ret = {};
  arg.forEach(o=>{
    assert(ret[o.cmd]===undefined, 'duplicated arg '+o.cmd);
    if (!o.arg)
      ret[o.cmd] = true;
    else if (o.arg.length==1 && !o.arg[0].arg)
      ret[o.cmd] = o.arg[0].cmd;
    else
      ret[o.cmd] = o.arg;
  });
  return ret;
};

E.arg_to_obj_multi = function(arg){
  let ret = {};
  arg.forEach(o=>{
    assert(ret[o.cmd]===undefined, 'duplicated arg '+o.cmd);
    if (!o.arg)
      ret[o.cmd] = true;
    else if (o.arg.length==1 && !o.arg[0].arg)
      ret[o.cmd] = o.arg[0].cmd;
    else
      ret[o.cmd] = E.arg_to_obj_multi(o.arg);
  });
  return ret;
};

function xerr_cb(level, args, msg, output){
  if (level>xerr.L.ERR)
    return;
  if (E.t.expect_err?.length){
    let expect_err = E.t.expect_err.pop();
    assert.equal(msg, expect_err);
    return;
  }
  assert(level>xerr.L.ERR, 'xerr L.'+xerr.LINV[level]+' in mocha: '+msg); }

E.xerr_level = function(level){
  if (level===undefined)
    return xerr.unregister(xerr_cb);
  xerr_cb.level = level;
  xerr.register(xerr_cb);
};

E.set_timeout = function(_this, ms){
  _this.timeout(xutil.is_inspect() ? Number.MAX_SAFE_INTEGER : ms);
};

E.init = function(){
  proc.init();
  // XXX: is it needed?
  xerr.on_unhandled_exception = err=>assert(false, err);
  proc.xexit_init();
  E.xerr_level(xerr.L.ERR);
  E.hook_assert();
  beforeEach(function(){
    E.currentTest = this.currentTest;
    E.seq_init();
    if (!xutil.is_inspect())
      xerr.set_buffered(true, 1000);
  });
  afterEach(function(){
    E.currentTest = null;
    if (test_prop_changes.length)
      on_test_prop_changed();
    E.seq_uninit();
    if (this.currentTest.timedOut){
      xerr.notice(this.currentTest.err.stack);
      assert.fail(this.currentTest.fullTitle()+': FAILED TIMEOUT');
    }
    xerr.clear();
    xerr.set_buffered(false);
  });
};

E.t = {};
