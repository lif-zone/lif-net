// author: derry. coder: arik.
'use strict'; /*zlint node, br*/
import xutil from './util.js';
import date from './date.js';
import array from './array.js';
import sprintf from './sprintf.js';
import xescape from './escape.js';
import rate_limit from './rate_limit.js';
import cluster from 'cluster';
const is_node = typeof window==='undefined';
let _process = is_node ? process : {env: {}};
var _xerr;
var env = _process.env, xerr_cb = [];
var xerr = function(msg){ _xerr(L.ERR, arguments); };
var E = xerr;
export default xerr;
E.xerr = xerr;
var L = E.L = {
    EMERG: 0,
    ALERT: 1,
    CRIT: 2,
    ERR: 3,
    WARN: 4,
    NOTICE: 5,
    INFO: 6,
    DEBUG: 7,
};
var perr_pending = [];
// inverted
var LINV = E.LINV = {};
for (var k in L)
    LINV[L[k]] = k;

['debug', 'info', 'notice', 'warn', 'err', 'crit'].forEach(function(l){
    var level = L[l.toUpperCase()];
    E[l] = function(){ return _xerr(level, arguments); };
});

E.assert = function(exp, msg){
    if (!exp)
        xerr.crit(msg);
};

E.json = function(o, replacer, space){
    try { return JSON.stringify(o, replacer, space)||''; }
    catch(e){ return '[circular]'; }
};

E.is = function(level){ return level<=E.level; };
['debug', 'info', 'notice', 'warn', 'err'].forEach(function(l){
    var level = L[l.toUpperCase()];
    E.is[l] = function(){ return level<=E.level; };
});

/* perr is a stub overridden by upper layers */
E.perr = function(id, info, opt){
    E._xerr(!opt || opt.level===undefined ? L.ERR : opt.level,
        ['perr '+id+' '+E.json(info)]);
    if (perr_pending && perr_pending.length<100)
        perr_pending.push(Array.from(arguments));
};
var perr_hooks = [];
E.add_perr_hook = perr_hooks.push.bind(perr_hooks);
var perr_dropped = {};
var perr_orig = E.perr;
function wrap_perr(perr_fn){
    var send = perr_fn, pre_send;
    if (typeof perr_fn!='function')
    {
        send = perr_fn.send;
        pre_send = perr_fn.pre_send;
    }
    return function(id, info, opt){
        opt = opt||{};
        var _rate_limit = opt.rate_limit||{};
        var ms = _rate_limit.ms||date.ms.HOUR, count = _rate_limit.count||10;
        var disable_drop_count = _rate_limit.disable_drop_count;
        var rl_hash = perr_orig.rl_hash = perr_orig.rl_hash||{};
        var rl = rl_hash[id] = rl_hash[id]||{};
        if (pre_send)
            pre_send(id, info, opt);
        perr_hooks.filter(function(h){ return h.ids.test(id); })
        .forEach(function(h){ h.fn(id, info, opt); });
        if (opt.rate_limit===false || rate_limit(rl, ms, count))
        {
            if (perr_dropped[id])
            {
                if (!disable_drop_count && info && typeof info!='string')
                    info.w = perr_dropped[id];
                perr_dropped[id] = null;
            }
            return send(id, info, opt);
        }
        perr_dropped[id] = (perr_dropped[id]||0)+1;
        if (info && typeof info!='string')
            info = xerr.json(info);
        xerr('perr %s %s rate too high %s %d %d', id, info, xerr.json(rl), ms,
            count);
    };
}
E.perr_install = function(install_fn){
    E.perr = wrap_perr(install_fn(perr_orig, perr_pending||[]));
    perr_pending = null;
};

function err_has_stack(err){ return err instanceof Error && err.stack; }

E.e2s = function(err){
    if (!is_node && err_has_stack(err))
    {
        var e_str = ''+err, e_stack = ''+err.stack;
        return e_stack.startsWith(e_str) ? e_stack : e_str+' '+e_stack;
    }
    return err_has_stack(err) ? ''+err.stack : ''+err;
};

E.on_exception = undefined;
E.exception_catch_all = false;
var in_exception;

E.set_exception_catch_all = function(all){ E.exception_catch_all = all; };

E.is_typeerror = function(err){ return err instanceof TypeError ||
          err instanceof ReferenceError;
};

E.set_exception_handler = function(prefix, err_func){
    E.on_exception = function(err){
        if (in_exception)
            return;
        let typeerror = E.is_typeerror(err);
        if (!typeerror && !E.exception_catch_all)
            return;
        in_exception = 1;
        err_func((prefix ? prefix+'_' : '')+
            (typeerror ? 'etask_typeerror' : 'etask_exception'), null, err);
        in_exception = 0;
    };
};

E.on_unhandled_exception = undefined;
E.catch_unhandled_exception = function(func, obj){
    return function(){
        var args = arguments;
        try { return func.apply(obj, Array.from(args)); }
        catch(e){ E.on_unhandled_exception(e); }
    };
};
E.set_level = function(level){
    var prev = 'L'+LINV[E.level];
    level = level||env.ZERR;
    if (!level)
        return prev;
    var val = L[level] || L[level.replace(/^L/, '')];
    if (val!==undefined)
        E.level = val;
    return prev;
};

E.get_stack_trace = function(opt){
    if (!opt)
        opt = {};
    if (opt.limit===undefined)
        opt.limit = Infinity;
    if (opt.short===undefined)
        opt.short = true;
    var old_stack_limit = Error.stackTraceLimit;
    if (opt.limit)
        Error.stackTraceLimit = opt.limit;
    var stack = xerr.e2s(new Error());
    if (opt.limit)
        Error.stackTraceLimit = old_stack_limit;
    if (opt.short)
    {
        stack = stack
            .replace(/^.+util\/etask.+$/gm, '    ...')
            .replace(/( {4}\.\.\.\n)+/g, '    ...\n');
    }
    return stack;
};

E.log = [];
E.log_max_size = 200;
E.buffered = false;
E.clear = function(){ E.log = []; };

E.set_buffered = function(on, max_size){
  if (on)
  {
    E.buffered = on;
    E.log_max_size = max_size||E.log_max_size;
    E.clear();
    if (is_node)
      process.on('exit', E.flush);
  }
  else
  {
    E.flush();
    E.buffered = on;
    if (is_node)
      process.off('exit', E.flush);
  }
};

E.flush = function(){
  if (!E.log.length)
    return;
  console.error(E.log.join('\n'));
  E.clear();
};

E.log_tail = function(size){
    return (E.log||[]).join('\n').substr(-(size||4096)); };

function log_tail_push(msg){
    E.log.push(msg);
    if (E.log.length>E.log_max_size)
        E.log.splice(0, E.log.length - E.log_max_size/2);
}

if (is_node)
{ // xerr-node
E.ZEXIT_LOG_DIR = env.ZEXIT_LOG_DIR||'/tmp/xexit_logs';
E.prefix = '';

E.level = L.NOTICE;
var node_init = function(){
    if (xutil.is_mocha())
        E.level = L.NOTICE;
    else
        E.prefix = !cluster.isMaster ? 'C'+cluster.worker.id+' ' : '';
};

var init = function(){
    if (is_node)
        node_init();
    E.set_level();
};
init();

var xerr_format = function(args){
    return args.length<=1 ? args[0] : sprintf.apply(null, args); };
var __xerr = function(level, args){
    var msg = xerr_format(args);
    var k = Object.keys(L);
    var prefix = E.hide_timestamp ? '' : E.prefix+date.to_sql_ms()+' ';
    if (env.CURRENT_SYSTEMD_UNIT_NAME)
        prefix = '<'+level+'>'+prefix;
    var res = prefix+k[level]+': '+msg;
    if (!xerr.buffered)
      console.error(res);
    log_tail_push(res);
    xerr_cb.forEach(cb=>cb(level, args, msg, res));
};

E.set_logger = function(logger){
    __xerr = function(level, args){
        var msg = xerr_format(args);
        logger(level, msg);
        log_tail_push(E.prefix+date.to_sql_ms()+': '+msg);
    };
};

_xerr = function(level, args){
    if (level>E.level)
        return;
    __xerr(level, args);
};
E._xerr = _xerr;

E.xexit = function(args){
    var stack;
    if (err_has_stack(args))
    {
        stack = args.stack;
        __xerr(L.CRIT, [E.e2s(args)]);
    }
    else
    {
        var e = new Error();
        stack = e.stack;
        __xerr(L.CRIT, arguments);
    }
    E.flush();
    if ((args&&args.code)!='ERR_ASSERTION')
        console.error('xerr.xexit was called', new Error().stack);
    if (env.NODE_ENV=='production')
    {
        /* XXX TODO
        var conf = require('./conf.js');
        var zcounter_file = require('./zcounter_file.js');
        zcounter_file.inc('server_xexit');
        args = xerr_format(arguments);
        write_xexit_log({id: 'lerr_server_xexit', info: ''+args,
            ts: date.to_sql(), backtrace: stack, version: version,
            app: conf.app});
        */
    }
    console.error('CRASH:\n'+stack);
    debugger; // eslint-disable-line no-debugger
    _process.exit(1);
};

/* XXX TODO
var write_xexit_log = function(json){
    try {
        var file = require('./file.js');
        file.mkdirp(E.ZEXIT_LOG_DIR);
        file.write_atomic_e(E.ZEXIT_LOG_DIR+'/'+date.to_log_file()+'_xexit_'+
            _process.pid+'.log', E.json(json));
    } catch(e){ E.xerr(E.e2s(e)); }
};
*/
}
else
{ // browser-xerr
var chrome;
E.log = [];
var L_STR = E.L_STR = ['EMERGENCY', 'ALERT', 'CRITICAL', 'ERROR', 'WARNING',
    'NOTICE', 'INFO', 'DEBUG'];
E.log_max_size = 200;
E.buffered = false;
chrome = self.chrome;
E.conf = self.conf;
E.level = E.conf && E.conf.xerr_level ? L[self.conf.xerr_level] : L.WARN;

var console_method = function(l){
    return l<=L.ERR ? 'error' : !chrome ? 'log' : l===L.WARN ? 'warn' :
        l<=L.INFO ? 'info' : 'debug';
};

_xerr = function(l, args){
    var s;
    try {
        var fmt = ''+args[0];
        var fmt_args = Array.prototype.slice.call(args, 1);
        s = (fmt+(fmt_args.length ? ' '+E.json(fmt_args) : ''))
        .substr(0, 1024);
        var prefix = (E.hide_timestamp ? '' : date.to_sql_ms()+' ')
        +L_STR[l]+': ';
        if (E.is(l))
        {
            if (!xerr.buffered)
            {
                Function.prototype.apply.bind(console[console_method(l)],
                    console)([prefix+fmt].concat(fmt_args));
            }
        }
        log_tail_push(prefix+s);
    } catch(err){
        try { console.error('ERROR in xerr '+(err.stack||err), arguments); }
        catch(e){}
    }
    if (l<=L.CRIT)
        throw new Error(s);
};
E._xerr = _xerr;

var post = function(url, data){
    var req = new XMLHttpRequest();
    req.open('POST', url);
    if (req.setRequestHeader)
    {
        req.setRequestHeader('Content-Type',
            'application/x-www-form-urlencoded; charset=UTF-8');
    }
    req.send(xescape.qs(data));
    return req;
};
var perr_transport = function(id, info, opt){
    opt = xutil.clone(opt||{});
    var qs = opt.qs||{}, data = opt.data||{};
    data.is_json = 1;
    if (info && typeof info!='string')
        info = xerr.json(info);
    if (opt.err && !info)
        info = ''+(opt.err.message||xerr.json(opt.err));
    data.info = info;
    qs.id = id;
    if (!opt.no_xerr)
    {
        xerr._xerr(opt.level, ['perr '+id+(info ? ' info: '+info : '')+
            (opt.bt ? '\n'+opt.bt : '')]);
    }
    return post(xescape.uri(E.conf.url_perr+'/perr', qs), data);
};

var perr = function(perr_orig, pending){
    while (pending.length)
        perr_transport.apply(null, pending.shift());
    // set the xerr.perr stub to send to the clog server
    return perr_transport;
};
E.perr_install(perr);
} // end of browser-xerr}

E.register = function(cb){
  E.unregister(cb);
  xerr_cb.push(cb);
};

E.unregister = function(cb){ array.rm_elm(xerr_cb, cb); };

