'use strict'; /*global describe,it,beforeEach*/
import assert from 'assert';
import Node from './node.js';
import Router from './router.js';
import NodeId from './node_id.js';
import NodeMap from './node_map.js';
import * as util from './util.js';
import Req from './req.js';
import buf_util from './buf_util.js';
import ReqHandler from './req_handler.js';
import etask from '../util/etask.js';
import xurl from '../util/url.js';
import date from '../util/date.js';
import proc from '../util/proc.js';
import LBuffer from './lbuffer.js';
import xescape from '../util/escape.js';
import xutil from '../util/util.js';
import xsinon from '../util/sinon.js';
import string from '../util/string.js';
import xtest from '../util/test_lib.js';
import xerr from '../util/xerr.js';
import Wallet from './wallet.js';
import {EventEmitter} from 'events';
import bigInt from 'big-integer';
const assign = Object.assign;
const s2b = buf_util.buf_from_str;
const stringify = JSON.stringify, is_number = xutil.is_number;
const DEF_RTT = 100;

Router.t.xxx_rt = false; // XXX WIP

proc.init();

function get_fuzzy(name){ return name && name[0]=='~' ? name[0] : ''; }
function N(name, opt){
  opt = opt||{};
  if (opt.fuzzy)
    assert(get_fuzzy(name), 'must be fuzzy '+name);
  if (!name)
    return;
  name = name[0]=='~' ? name[1] : name;
  assert(/^[a-zA-Z]$/.test(name), 'invalid name '+name);
  let node = t_nodes[name];
  assert(node, 'missing node '+name);
  return node;
}

let t_nodes = {}, t_ids = {}, t_msg, t_msgid, t_req, t_cmds, t_i, t_role;
let t_port=4000, t_pending, t_sleep;
let t_pre_process, t_cmds_processed, t_mode, t_mode_prev, t_req_id;
let t_reprocess, t_conf, t_req_id_last, t_test_prev;
let t_prev_time, t_event, t_pause, t_no_events_allowed_ts;
NodeMap.t.t_nodes = Router.t.t_nodes = t_nodes;
NodeMap.t.node_from_id = Router.t.node_from_id = node_from_id;

const etask_sleep = dur=>etask(function*etask_sleep(){
  let t0 = Date.now();
  yield etask.sleep(dur);
  assert.equal(Date.now(), t0+dur, 'wrong time after sleep. timer skipped');
});

function push_event(event){
  xerr.notice('push_event %s', event);
  if (t_event.length){
    assert.equal(t_event[0].ts, Date.now(),
     'got event before previous handled. event '+event+'\n'+events_str());
  }
  t_event.push({ts: Date.now(), event});
}

function events_str(){
  let s = '';
  t_event.forEach(o=>s+= (s ? '\n' : '')+o.ts+': '+o.event);
  return s;
}

function shift_event(c){
  if (!t_event.length)
    return;
  let o = t_event.shift();
  assert.equal(Date.now(), o.ts, 'wrong timing for event '+o.event+
    '\nexpected: '+c?.fwd+' '+c?.orig+'\npending: '+events_str());
  return o.event;
}

// XXX: need test
function fwd_from_lbuffer(lbuffer){
  let fwd = [], m;
  for (let i=0; i<lbuffer.size() && (m=lbuffer.get_json(i)).type=='fwd'; i++)
    fwd.push(node_from_id(m.from).t.name+node_from_id(m.to).t.name+'>');
  return fwd;
}

function fwd_s(fwd, i){
  assert(i<=fwd.length, 'invalid fwd index '+stringify(fwd)+':'+i);
  return fwd[i][2]=='>' ? fwd[i][0] : fwd[i][1];
}

function fwd_d(fwd, i){
  assert(i<=fwd.length, 'invalid fwd index '+stringify(fwd)+':'+i);
  return fwd[i][2]=='>' ? fwd[i][1] : fwd[i][0];
}

function fwd_s_id(fwd, i){
  i = i||0;
  if (typeof fwd=='string')
    fwd = [fwd];
  return N(fwd_s(fwd, i)).id.s;
}

function fwd_d_id(fwd, i){
  i = i||0;
  if (typeof fwd=='string')
    fwd = [fwd];
  return N(fwd_d(fwd, i)).id.s;
}

function msgid_hash(msg){
  assert(msg.req_id, 'missing req_id '+stringify(msg));
  return id_to_name(msg.from)+'_'+id_to_name(msg.to)+'_'+(msg.req_id||'none')+
    '_'+(msg.type||'none')+'_'+(msg.cmd||'none');
}

function conn_opts(body){
  let a = [];
  if (body.ws)
    a.push('ws');
  if (body.wrtc)
    a.push('wrtc');
  return a.join(' ');
}

function conn_opts_from_node(node){
  let a = [];
  node = typeof node=='string' ? N(node) : node;
  if (support_wss(node))
    a.push('ws');
  if (support_wrtc(node))
    a.push('wrtc');
  return a.join(' ');
}

function hash_from_int(val, bits, total_bits){
  assert(!(total_bits % 4), 'invalid total_bits '+total_bits); // hex is 4bits
  assert(bits<=total_bits, 'bits bigger than total_bits');
  let len = total_bits/4;
  let s = bigInt(val).shiftLeft(total_bits-bits).toString(16);
  return '0'.repeat(len-s.length)+s;
}

function int_from_hash(hash, bits, total_bits){
  assert(!(total_bits % 4), 'invalid total_bits '+total_bits); // hex is 4bits
  assert(bits<=total_bits, 'bits bigger than total_bits');
  return bigInt(hash, 16).shiftRight(total_bits-bits).toString(10);
}

function ch_diff(s, e){
  assert(string.is_lower(s)&&string.is_lower(e) ||
    string.is_upper(s)&&string.is_upper(e), 'invalid range '+s+'-'+e);
  let _s = s.charCodeAt(0), _e = e.charCodeAt(0);
  return _s<_e ? _e-_s : _e-'a'.charCodeAt(0) + 'z'.charCodeAt(0)-_s+1;
}

function gen_ids(s, e, val){
  val = val||'head(0-1)';
  let _type = xtest.test_parse_no_dir(val);
  assert(_type.length==1, 'inavlid ids '+val);
  let mode = _type[0].cmd, range = _type[0].arg;
  if (!range){
    range = mode;
    mode = 'head';
  }
  let m = range.match(/^([0-9.]+)-([0-9.]+)$/);
  assert(m?.length==3, 'inavlid ids '+val);
  let v0 = NodeId.from(+m[1]), v1 = NodeId.from(+m[2]);
  let n, d, v, ret = {};
  let is_upper = /[A-Z]/.test(s);
  switch (mode){
  case 'head':
  case 'tail':
  case 'mid':
    n = ch_diff(s, e)+1;
    d = (v1.d>v0.d ? v1.d-v0.d : 1-v0.d+v1.d)/n;
    v = v0.d+(mode=='mid' ? 0.5*d : mode=='tail' ? d : 0);
    break;
  case 'exact':
    n = ch_diff(s, e)+1;
    d = (v1.d>v0.d ? v1.d-v0.d : 1-v0.d+v1.d)/(n-1);
    v = v0.d;
    break;
  default: assert.fail('invalid mode '+mode+ ' ids '+val);
  }
  for (let i=0, ch = s; i<n; i++){
    ret[ch] = NodeId.from(+(v+d*i > 1 ? v+d*i-1 : v+d*i).toFixed(10));
    ch = String.fromCharCode(ch<(is_upper ? 'Z' : 'z') ? ch.charCodeAt(0)+1 :
      (is_upper ? 'A' : 'a').charCodeAt(0));
  }
  return ret;
}

function rt_to_str(rt, dir){
  let s = rt.opt||'';
  if (!rt?.path)
    return s+'';
  return s+path_to_str(rt.path, dir);
}

function normalize(e){
  if (!e)
    return e;
  let a=e[0], b=e[1], d=e[2];
  if (d!='<')
    return e;
  return b+a+'>'+e.slice(3);
}

function rev_trim(s){
  let i = s.search(/[<>]/);
  assert(i>=0 && i<3, 'invalid [<>] '+s);
  s = s.slice(0, i)+(s[i]=='<' ? '>' : '<');
  return s;
}

// _build_cmd(cmd, fwd, ...)
function _build_cmd(){
  let args = Array.from(arguments), cmd = args[0], fwd = args[1]||'', arg = '';
  assert(cmd);
  for (let i=2; i<args.length; i++){
    if (args[i] || args[i]===0)
      arg += (arg ? ' ' : '')+args[i];
  }
  let ret = cmd+(arg ? '('+arg+')' : '');
  if (!fwd)
    return ret;
  assert(Array.isArray(fwd), 'invalid fwd '+stringify(fwd));
  Array.from(fwd).reverse().forEach(f=>ret=f+'fwd('+ret+')');
  return ret;
}

// build_cmd(cmd, ...)
function build_cmd(){
  let a = Array.from(arguments);
  a.splice(1, 0, ''); // fwd: ''
  return _build_cmd.apply(this, a);
}

function build_cmd_o(cmd, fwd, o){
  if (o===undefined)
  {
    o = fwd;
    fwd = '';
  }
  assert(!fwd || Array.isArray(fwd), 'invalid fwd '+stringify(fwd));
  let a = [cmd, fwd];
  for (let arg in o){
    let val = o[arg];
    if (val===true)
      a.push(arg);
    else if (val || val===0)
      a.push(build_cmd(arg, val));
  }
  return _build_cmd.apply(this, a);
}

function build_fwd(fwd, rt2, range2, s){
  let _rt = Array.from(rt2||[]);
  let _range = Array.from(range2||[]);
  Array.from(fwd).reverse().forEach(f=>{
    let rt = _rt.pop();
    let range = _range.pop();
    s = build_cmd(normalize(f)+'fwd', s+
      (rt ? ' '+build_cmd('rt', rt_to_str(rt)) : '')+
      (range ? ' '+build_cmd('range', range_to_str(range)) : ''));
  });
  return s;
}

function dir_str(s, d, dir){ return dir=='>' ? s+d+'>' :
  dir=='<' ? d+s+'<' : s+d+dir; }
function dir_c(c){ return dir_str(c.s, c.d, c.dir); }
function rev_c(c){ return rev_trim(dir_str(c.s, c.d, c.dir)); }

function loop_str(loop){
  let s = (loop[0].rt_opt||'')+loop[0].s;
  for (let i=0; i<loop.length; i++){
    let o = loop[i];
    s += /[~]/.test(o.d) ? o.d : (o.dot ? '.'+(o.rt_opt||'') : '')+o.d;
    if (o.rt_path)
      s += '['+o.rt_path+']';
  }
  return s;
}

function rev_loop_str(loop){
  let s = loop[loop.length-1].d;
  for (let i=loop.length-1; i>=0; i--)
    s += loop[i].s;
  return s;
}

function set_orig(c, orig){
  c.meta.orig = c.orig;
  c.orig = orig;
}

function _push_cmd(a){
  assert(t_pre_process, 'push_cmd only allowed in pre pre_process');
  t_cmds.splice(t_i, 0, ...a);
}

function push_cmd(cmd){ _push_cmd(xtest.test_parse(cmd)); }
function _set_push_cmd(c, a){
  if (!a.length)
    return c;
  t_cmds[t_i-1] = a[0];
  a.shift();
  _push_cmd(a);
  t_reprocess = true;
  return t_cmds[t_i-1];
}
function set_push_cmd(c, cmd){ _set_push_cmd(c, xtest.test_parse(cmd)); }

function is_fake(p){ return t_role!=p; }

function wss_from_node(node){ return xutil.get(node, 't.wss.url'); }

function node_from_url(url){
  for (let name in t_nodes){
    let node = N(name);
    if (node.t.wss && wss_from_node(node)==url)
      return node;
  }
}

function support_wss(node){ return !!wss_from_node(node); }
function support_wrtc(node){ return node.wrtcConnector.supported; }

function node_from_id(id){ return t_ids[NodeId.from(id).s]; }

function assert_bool(val){
  assert(!val);
  return true;
}

function assert_int(val){
  assert(/^[0-9]+$/.test(val), 'invalid int '+val);
  return parseInt(val);
}

function assert_node_ids(val){
  let ret = {};
  let arg = xtest.test_parse_no_dir(val);
  xutil.forEach(arg, a=>{
    let cmd = a.cmd, arg2 = a.arg;
    switch (cmd){
    case 'all': return assign(ret,
      assert_node_ids('a-z(exact(0.038085-0.990234375))'),
      assert_node_ids('A-Z(exact(0.49-0.506))'));
    case 'a-mXYZn-z': return assign(ret,
      assert_node_ids('a-z(exact(0.038085-0.990234375))'),
      assert_node_ids('X-Z(exact(0.5-0.506))'));
    default:
      if (/:/.test(cmd)){ // XXX HACK: bug in parser
        let aa = xtest.test_parse_no_dir(cmd);
        assert(aa.length==1, 'invalid conf '+cmd);
        cmd = aa[0].cmd;
        arg2 = build_cmd(aa[0].arg, arg2);
      }
      if (/^[a-zA-Z]-[a-zA-Z]$/.test(cmd))
        assign(ret, gen_ids(cmd[0], cmd[2], arg2));
      else if (/^[a-zA-Z]$/.test(cmd)){
        if (/[.]/.test(arg2))
          ret[cmd] = NodeId.from(parseFloat(arg2));
        else {
          ret[a.cmd] = NodeId.from(hash_from_int(+arg2,
            t_conf.id_bits, NodeId.bits));
        }
      }
      else
        assert(0, 'unknown arg '+a.cmd);
    }
  });
  return ret;
}

// XXX: fix assert_rtt to return value (not set t_conf.rtt)
function assert_rtt(val){
  let a = val.split(' ');
  a.forEach(s=>{
    if (is_number(s)){
      assert(+s>=2, 'invalid rtt '+s);
      t_conf.rtt.def = +s;
    } else {
      let a = s.match(/^([a-zA-Z][a-zA-Z]):([0-9]+)$/);
      assert(a.length==3, 'invalid rtt '+s+' '+val);
      let conn = rtt_hash(a[1][0], a[1][1]);
      assert(+a[2]>=2, 'invalid rtt '+a[2]);
      t_conf.rtt.conn[conn] = +a[2];
    }
  });
}

function assert_ack(val){
  if (!val)
    return [];
  let a = val.split(',');
  xutil.forEach(a, ack=>assert_int(ack));
  return a;
}

function assert_exist(name){ assert(N(name), 'node not found '+name); }

function assert_not_exist(name){
  assert(!t_nodes[name], 'node already exist '+name); }

function assert_name_new(name){
  assert_not_exist(name);
  assert(/^[a-zA-Z]$/.test(name), 'invalid name '+name);
  return name;
}

function assert_port(port){
  assert.ok(/[0-9]+/.test(port), 'invalid port '+port);
  assert.ok(port>0 && port<65535, 'invalid port '+port);
  return +port;
}

function assert_host(host){
  assert.ok(xurl.is_valid_domain(host), 'invalid host '+host);
  return host;
}

function assert_path(s, dir){
  let path = parse_path(s, dir);
  assert(path, 'invalid path '+s);
  return path;
}

function assert_rt(src, str, dir){
  let rt = {};
  if (dir=='>'){
    if ('?!'.includes(str[0])){
      rt.opt = str[0];
      str = str.substr(1);
    }
  } else {
    if ('?!'.includes(str[str.length-1])){
      rt.opt = str[str.length-1];
      str = str.substr(0, str.length-1);
    }
  }
  rt.path = parse_path(str, dir);
  assert(rt.path, 'invalid rt '+str);
  assert(!src || !src.id.eq(NodeId.from(rt.path[0])),
   'rt should not contain src '+str);
  return rt;
}

function range_to_str(range){
  let min, max;
  for (let name in t_conf.node_ids){
    if (range.min.eq(t_conf.node_ids[name]))
      min = name;
    if (range.max.eq(t_conf.node_ids[name]))
      max = name;
  }
  assert(min, 'range.min not found');
  assert(max, 'range.max not found');
  return min+'-'+max;
}

function assert_range(s){
  let m = s.match(/^([a-zA-Z])-([a-zA-Z])/);
  assert(m.length==3, 'invalid range '+s);
  let min = t_conf.node_ids[m[1]], max = t_conf.node_ids[m[2]];
  assert(min, s+' min not found '+m[1]);
  assert(min, s+' max not found '+m[2]);
  return {min, max};
}

function assert_support_wrtc(name){
  assert(support_wrtc(N(name)), 'node '+name+' does not support wrtc');
  return true;
}

function assert_wss(val){
  let host = 'lif.zone', port, arg = xtest.test_parse_no_dir(val);
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'host': host = assert_host(a.arg); break;
    case 'port': port = assert_port(a.arg); break;
    default: 'invalid cmd '+a.cmd;
    }
  });
  if (!port)
    port = t_port++;
  assert(host, 'must specify host');
  return {host, port, url: 'wss://'+host+':'+port};
}

function assert_wrtc(val){
  assert(!val, 'unexpected val for wrtc');
  return true;
}

function assert_wss_url(d, val){
  let wss;
  if (!val)
    wss = N(d).wsConnector.url;
  else {
    assert(!d);
    wss = val;
  }
  assert(wss, 'dest '+d+' has no ws server');
  // XXX: TODO assert val and wss
  return wss;
}

function assert_bootstrap(val){
  let bootstrap = [];
  let a = val.split(' ');
  a.forEach(name=>{
    let node = N(name);
    assert(node, 'node not found '+name);
    let url = wss_from_node(node);
    assert(url, 'no url for '+name);
    bootstrap.push(url);
  });
  return bootstrap;
}

/* XXX: decide if to remove
function assert_peers(peers){
  let a = peers.split(',');
  assert(a.length>0, 'no peers specified');
  a.forEach(name=>assert(N(name), 'node not found '+name+'/'+peers));
}
*/

function assert_event(event, exp){
  assert.equal(normalize(event), normalize(exp), 'events: '+events_str()); }

// XXX: rm
function assert_event_c(c, event, call){
  if (call)
    return assert(!event, 'unexpected event '+event+' for call '+c.orig);
  assert(!c.fwd, 'XXX TODO fwd support');
  let expected = c.fwd ? build_cmd(c.fwd+'fwd', normalize(c.orig)) : c.orig;
  if (event){
    assert_event(event, expected);
  } else
    assert_missing_event(c, expected);
}

function assert_event_c2(c, orig, fwd, event, call){
  if (call)
    return assert(!event, 'unexpected event '+event+' for call '+orig);
  let expected = orig;
  if (fwd){
    assert(Array.isArray(fwd), 'invalid fwd '+stringify(fwd));
    expected = build_fwd(c.fwd, c.rt2, c.range2, normalize(orig));
  }
  if (event)
    assert_event(event, expected);
  else
    assert_missing_event(c, expected);
}

function assert_missing_event(c, expected){
  let s = N(c.s), d = N(c.d);
  if (c.fwd)
    s = N(fwd_s(c.fwd, 0));
  assert(s, 'fwd node not found '+stringify(c.fwd)+' '+c.orig);
  if (c.cmd[0]=='*'){
    if (!d)
      assert(s.t.fake, 'missing event '+expected+'\nfor '+c.orig);
    else
      assert(!s.t.fake || d.t.fake, 'missing event '+expected+'\nfor '+c.orig);
  } else {
    if (s.t.fake)
      return;
    assert.fail('missing event '+expected+
      '\nfor '+(c.fwd||[]).join(':')+' '+c.orig);
  }
}

// XXX: unite with track_msg
function track_seq_req(s, d, id, cmd, type, seq, call){
  if (!t_req[id])
    t_req[id] = {s, d, id, cmd, req: {seq: 0}};
  else if (/req_next|req_end/.test(type) && !t_req[id].req.call)
    t_req[id].req.seq++;
  assert(s==t_req[id].s, 'invalid s '+s+'!='+t_req[id].s+' req '+id);
  assert(d==t_req[id].d, 'invalid d '+d+'!='+t_req[id].d+' req '+id);
  t_req[id].req.call = call;
  return seq===undefined ? t_req[id].req.seq : seq;
}

// XXX: unite with track_msg
function track_seq_res(s, d, id, type, seq, call){
  if (!t_req[id])
    return;
  if (!t_req[id].res)
    t_req[id].res = {seq: 0};
  else if (/res_next|res_end/.test(type) && !t_req[id].res.call)
    t_req[id].res.seq++;
  assert(s==t_req[id].d, 'invalid s '+s+'!='+t_req[id].d+' req '+id);
  assert(d==t_req[id].s, 'invalid d '+d+'!='+t_req[id].s+' req '+id);
  t_req[id].res.call = call;
  return seq===undefined ? t_req[id].res.seq : seq;
}

const rtt_hash = (a, b)=>(a+b).split('').sort((a, b)=>a>b ? -1 : a<b ? 1 : 0)
.join('');

function conf_rtt(a, b){
  let hash = rtt_hash(a, b);
  return t_conf.rtt.conn[hash]||t_conf.rtt.def;
}

function conf_rtt_from_node(s, d){ return conf_rtt(s.t.name, d.t.name); }
function conf_rtt_from_name(s, d){ return conf_rtt(N(s).t.name, N(d).t.name); }
function conf_rtt_from_id(id1, id2){
  return conf_rtt(node_from_id(id1).t.name, node_from_id(id2).t.name); }

function track_rtt(lbuffer){
  track_rtt_fwd(lbuffer);
  track_rtt_path(lbuffer);
}

function track_rtt_fwd(lbuffer){
  let msg0 = lbuffer.get_json(0);
  let d0 = node_from_id(msg0.to);
  d0.t.rtt = d0.t.rtt||{};
  for (let i=0; i<lbuffer.size(); i++){
    let msg = lbuffer.get_json(i);
    if (msg.type!='fwd')
      break;
    let s = node_from_id(msg.from);
    let d = node_from_id(msg.to);
    let hash = rtt_hash(s.t.name, d.t.name);
    d0.t.rtt[hash] = Math.min(d0.t.rtt[hash]||1000, msg.rtt||1000);
  }
}

function track_rtt_path(lbuffer){
  let msg0 = lbuffer.get_json(0), rt = msg0.rt, path = rt?.path;
  if (msg0.type!='fwd' || !rt?.path)
    return;
  let rtt_a = rt?.rtt, d0 = node_from_id(msg0.to);
  assert.equal(path.length, rtt_a.length, 'invalid rtt for path');
  for (let i=0, prev=d0; i<path.length; i++){
    let curr = node_from_id(path[i]), rtt = rtt_a[i];
    let hash = rtt_hash(prev.t.name, curr.t.name);
    d0.t.rtt[hash] = Math.min(d0.t.rtt[hash]||1000, rtt||1000);
    prev = curr;
  }
}

// XXX: unite with msgid and use t_req instead of t_ack/t_msg
let t_msg_n = 0;
function track_msg(lbuffer){
  let msg = lbuffer.msg();
  if (msg.type=='ack') // XXX TODO
    return;
  assert(msg.req_id, 'missing req_id %s', stringify(msg));
  let s = node_from_id(msg.from).t.name, d = node_from_id(msg.to).t.name;
  let {type, req_id, cmd, seq} = msg;
  track_rtt(lbuffer);
  assert(is_number(msg.seq), 'req/res must have seq '+stringify(msg));
  req_id = ''+req_id;
  cmd = cmd||'';
  t_msg[req_id] = t_msg[req_id]||{msg_n: t_msg_n++, req_id, s, d, cmd,
    seq: {req: [], res: []}};
  if (!['req', 'req_start'].includes(type))
    t_msg[req_id].active = true;
  t_req_id_last = req_id; // XXX HACK: rm it
  let t;
  if (['req', 'req_start', 'req_next', 'req_end'].includes(type))
    t = 'req';
  else if (['res', 'res_start', 'res_next', 'res_end'].includes(type))
    t = 'res';
  if (!t_msg[req_id].seq[t].includes(seq))
    t_msg[req_id].seq[t].push(seq);
}

function get_req_id(o){
  let match;
  for (let req_id in t_msg){
    req_id = ''+req_id;
    let o2 = t_msg[req_id];
    if (o.cmd==o2.cmd && (o.s==o2.s&&o.d==o2.d ||
      // XXX HACK: hack for ring_join becaue when fuzzy dst, the response is
      // from another id
      o.cmd=='ring_join' && o2.s==o.s)){
      if (!match)
        match = o2;
      else if (match.msg_n < o2.msg_n)
        match = o2;
    }
  }
  return match && match.req_id || '';
}

function get_ack(o){
  let {type, req_id, keep} = o;
  req_id = ''+req_id;
  if (!t_msg[req_id])
    return;
  let ack = t_msg[req_id].seq[type];
  if (!ack || !ack.length)
    return;
  if (!keep)
    t_msg[req_id].seq[type] = [];
  return ack;
}

class FakeNode extends EventEmitter {
  constructor(opt){
    super();
    this.wallet = new Wallet({keys: opt.keys});
    this.id = NodeId.from(opt.keys.pub);
    this.msg_id_n = 0;
    this.wsConnector = new FakeWsConnector(this.id.b, opt.port, opt.host);
    this.wrtcConnector = new FakeWrtcConnector(this.id.b, null, opt.wrtc);
  }
  destroy(){}
  msgid(){ return ++this.msg_id_n; }
}

class FakeWsConnector extends EventEmitter {
  constructor(id, port, host){
    super();
    this.id = id;
    if (port || host){
      assert(host, 'missing host');
      assert(port, 'missing port');
      this.url = 'wss://'+host+':'+port;
    }
  }
  connect = url=>etask({_: this}, function*connect(){
    let _this = this._;
    let d = node_from_url(url), s = node_from_id(_this.id);
    assert(d, 'node not found for url '+url);
    let channel = new FakeChannel({local_id: s.id, id: d.id});
    channel.wsConnector = _this;
    channel.t.initiaor = true;
    assert(!s.t.fake, 'src must be real');
    yield s._onConnection(channel);
  });
  destroy(){}
}

class FakeWrtcConnector extends EventEmitter {
  constructor(id, router, wrtc){
    super();
    this.id = id;
    this.supported = wrtc;
  }
  connect = _d=>etask({_: this}, function*connect(){
    let _this = this._;
    let d = node_from_id(_d), s = node_from_id(_this.id);
    let channel = new FakeChannel({local_id: s.id, id: d.id});
    channel.wrtcConnector = _this;
    channel.t.initiaor = true;
    assert(!s.t.fake, 'src must be real');
    yield s._onConnection(channel);
  });
  destroy(){}
}

class FakeChannel extends EventEmitter {
  constructor(opt){
    super();
    this.id = opt.id;
    this.local_id = opt.local_id;
    this.t = {};
    if (!t_conf) // XXX HACK: rm it, needed for channels test
      return;
    if (!t_conf.msg_delay)
      this.rtt = conf_rtt_from_id(this.id, this.local_id);
  }
  send = data=>etask(function*send(){
    let lbuffer = LBuffer.from(data); // XXX WIP
    let msg = lbuffer.msg(), msg0 = lbuffer.get_json(0);
    assert(!t_pre_process, 'invalid send during pre_process');
    // XXX: need to filter out only test commands, other should fail test
    if (!t_mode.msg)
      return;
    let from0 = node_from_id(msg0.from), to0 = node_from_id(msg0.to);
    let e = event_from_lbuffer(lbuffer);
    xerr.notice('*** channel.send %s', event_from_lbuffer(lbuffer));
    if (msg.type!='ack') // XXX: review
      t_msgid[msgid_hash(msg)] = msg.msgid;
    track_msg(lbuffer);
    let ack_connect = t_msg[msg.req_id]?.cmd=='connect';
    if (msg.type=='ack' && !t_conf.no_autoack && !ack_connect)
      return;
    assert(!from0.t.fake);
    let dur = conf_rtt_from_node(from0, to0)/2;
    push_event(e);
    if (t_no_events_allowed_ts){
      assert.equal(Date.now(), t_no_events_allowed_ts,
        'unexpected event while sleeping: '+e);
    }
    if (t_conf.msg_delay)
      yield etask_sleep(dur);
    if (!t_pending)
      return;
    xerr.notice('FakeChannel send resume pending t_i %s', t_i);
    let pending = t_pending;
    t_pending = null;
    pending.continue();
  });
  destroy(){}
}

function event_from_lbuffer(lbuffer, extra){
  let msg = lbuffer.msg();
  let from = node_from_id(msg.from), to = node_from_id(msg.to);
  let fwd = fwd_from_lbuffer(lbuffer);
  let {fuzzy, req_id, type, cmd, ack, seq, dir, vv, body} = msg;
  cmd = cmd||'';
  fuzzy = fuzzy||'';
  // XXX: why missing msgid for type=='ack'?
  assert(msg.type=='ack' || msg.msgid, 'missing msg msgid');
  switch (type){
  case 'req':
    switch (cmd){
    case 'conn_info': body= ''; break;
    case 'ring_join': body= ''; break;
    case 'ping': body= ''; break;
    case 'connect': body= ''; break;
    case '': break;
    default: assert(0, 'invalid cmd '+cmd);
    }
    break;
  case 'res':
    switch (cmd){
    case 'conn_info': body = conn_opts(body); break;
    case 'ring_join': body= ''; break;
    case 'ping': body= ''; break;
    case '': break;
    default: assert(0, 'invalid cmd ', cmd);
    }
    break;
  case 'ack':
    body = body && 'rt:'+path_to_str(body.rt);
    break;
  default: assert(['req', 'res', 'req_start', 'res_start', 'req_next',
    'res_next', 'req_end', 'res_end', 'ack'].includes(type),
    'unexpected msg type '+type);
  }
  let e = build_cmd_o(from.t.name+fuzzy+to.t.name+'>msg',
    assign({id: req_id, type, cmd, seq, ack: ack && ack.join(','), dir, vv,
    body}, extra));
  if (fwd){
    let path = [msg.from];
    let i = lbuffer.size()-2;
    Array.from(fwd).reverse().forEach(f=>{
      let m = lbuffer.get_json(i);
      i--;
      let srt = t_conf.rt&&fwd&&m.rt ?
        build_cmd('rt', rt_to_str(m.rt)) : '';
      if (!t_conf.rt && m.rt)
        srt = build_cmd('rt', rt_to_str(m.rt));
      let srange = m.range && build_cmd('range',
        range_to_str(NodeId.range_from_msg(m.range)));
      e = build_cmd(f+'fwd', e+
        (srt ? ' '+srt : '')+(srange ? ' '+srange : ''));
      path.push(fwd_d_id(f));
    });
  }
  return e;
}

/* XXX: rm?
const cmd_run_if_next_fake = ()=>etask(function*send(){
  while (t_i<t_cmds.length){
    if (t_pending)
      break;
    let c = t_cmds[t_i];
    let s = c.s && N(c.s);
    let d = c.d && N(c.d);
    if (s && !s?.t.fake)
      break;
    if (d && !d?.t.fake)
      break;
    yield cmd_run();
  }
});
*/

function do_autoack(lbuffer, vv){
  let msg = lbuffer.msg(), msg0 = lbuffer.get_json(0);
  let from0 = node_from_id(msg0.from), to0 = node_from_id(msg0.to);
  let from = node_from_id(msg.from), to = node_from_id(msg.to);
  let dur_ms = t_conf.msg_delay ? conf_rtt_from_node(from0, to0)/2 : undefined;
  let rt = msg0.rt, path = rt?.path, msgid;
  if (!msg.req_id || msg.cmd=='connect')
    return;
  let dir = Router.type_to_dir(msg.type);
  if (!dir)
    return;
  if (vv || !path && msg.to==to0.id.s && lbuffer.size()>1){
    let msg2 = {msgid, to: from.id.s, from: to.id.s, type: 'ack',
      req_id: msg.req_id, seq: msg.seq, dir, vv: true};
    let lbuffer2 = new LBuffer(msg2);
    let path2 = Array.from(lbuffer.path());
    path2.reverse();
    let from2 = to0.id.s, to2;
    dur_ms = 0;
    while (path2.length){
      to2 = path2.shift();
      lbuffer2.add_json(assign({from: from2, to: to2, type: 'fwd'},
        path2.length ? {rt: {path: path2}} : undefined));
      if (t_conf.msg_delay)
          dur_ms += conf_rtt_from_id(from2, to2)/2;
      if (!node_from_id(to2).t.fake){
        return etask(function*do_autoack(){
          if (t_conf.msg_delay)
            yield etask_sleep(dur_ms);
          return send_msg(node_from_id(from2).t.name, node_from_id(to2).t.name,
            lbuffer2);
        });
      }
      from2 = to2;
    }
    return;
  }
  if (from0.t.fake)
    return;
  msgid = to0.msgid();
  let msg2 = {msgid, to: from0.id.s, from: to0.id.s, type: 'ack',
    req_id: msg.req_id, seq: msg.seq, dir, vv: msg.to==to0.id.s};
  let lbuffer2 = new LBuffer(msg2);
  return etask(function*do_autoack(){
    if (t_conf.msg_delay)
      yield etask_sleep(dur_ms);
    return send_msg(to0.t.name, from0.t.name, lbuffer2);
  });
}

function req_hook(lbuffer){
  let msg = lbuffer.msg(), msg0 = lbuffer.get_json(0);
  // XXX: need to filter out only test commands, other should fail test
  if (!t_mode.req || !t_mode.msg)
    return;
  assert(!t_pre_process, 'invalid send during pre_process');
  let {fuzzy, type, req_id, seq, ack, cmd, body} = msg, e;
  assert(['req', 'req_start', 'req_next', 'req_end'].includes(type),
    'invalid msg type '+type);
  ack = undefined; // XXX HACK: rm
  cmd = cmd||'';
  let from = node_from_id(msg.from), to = node_from_id(msg.to);
  let to0 = node_from_id(msg0.to);
  xerr.notice('*** req_hook %s %s',
    from.t.name+to.t.name+'>'+cmd, stringify(msg));
  switch (cmd){
  case 'conn_info':
    e = build_cmd(from.t.name+to.t.name+'>*conn_info', '');
    break;
  case 'ring_join':
    assert(fuzzy, 'ring_join must be fuzzy');
    e = build_cmd(from.t.name+to0.t.name+'>*ring_join', '');
    break;
  case '':
  case 'test':
  case 'ping':
    e = build_cmd_o(from.t.name+to.t.name+'>*'+type,
      {id: req_id, seq, ack: ack && ack.join(','), cmd, body});
    break;
  default: assert(0, 'invalid cmd '+cmd);
  }
  assert(msg.msgid, 'missing msg msgid '+stringify(msg));
  push_event(e);
}

function new_res_hook(res){
  let s = res.node;
  res.on('fail', o=>push_event(build_cmd_o(s.t.name+'>*fail',
      {id: o.req_id, seq: o.seq, error: o.error})));
}
function fail_hook(o){
  let id = typeof o.req_id=='string' && +o.req_id<1000 ? o.req_id :
    undefined;
  let seq = o.req.stream ? o.seq : undefined;
  push_event(build_cmd_o(o.req.node.t.name+'>*fail',
    {id, seq, error: o.error}));
}

function res_hook(msg){
  if (!t_mode.req || !t_mode.msg)
    return;
  assert(!t_pre_process, 'invalid send during pre_process');
  let {type, req_id, seq, ack, cmd, body} = msg, e;
  assert(['res', 'res_start', 'res_next', 'res_end'].includes(type),
    'invalid msg type '+type);
  cmd = cmd||'';
  ack = undefined; // XXX HACK: rm
  let from = node_from_id(msg.from), to = node_from_id(msg.to);
  xerr.notice('*** res_hook %s %s',
    from.t.name+to.t.name+'>'+cmd, stringify(msg));
  switch (cmd){
  case 'conn_info':
    e = build_cmd(from.t.name+to.t.name+'>*conn_info_r', conn_opts(body));
    break;
  case 'ring_join':
    e = build_cmd(from.t.name+to.t.name+'>*ring_join_r', body);
    break;
  case 'test':
  case 'ping':
  case '':
    e = build_cmd_o(from.t.name+to.t.name+'>*'+type, {id: req_id,
      seq, ack: ack && ack.join(','), cmd, body});
    break;
  default: assert(0, 'invalid cmd '+cmd);
  }
  assert(msg.msgid, 'missing msg msgid %s', stringify(msg));
  push_event(e);
}

function parse_path(s, dir){
  let a = (s||'').split(''), ret = [];
  a.forEach(name=>{
    if (dir=='<')
      ret.unshift(name_to_id(name));
    else
      ret.push(name_to_id(name));
  });
  return ret;
}

function path_to_str(path, dir){
  let a = [];
  path.forEach(id=>{
    if (dir=='<')
      a.unshift(id_to_name(id));
    else
      a.push(id_to_name(id));
  });
  return a.join('');
}

// XXX: cleanup all code
function id_to_name(id){ return node_from_id(id).t.name; }

// XXX: cleanup all code
function name_to_id(name){ return N(name).id.s; }

/* XXX: decide if to remove
function array_id_to_name(a){
  let ret = [];
  a.forEach(id=>ret.push(node_from_id(xutil.buf_from_str(id)).t.name));
  return ret;
}

function array_name_to_id(a){
  let ret = [];
  a.forEach(name=>{
    assert_exist(name);
    ret.push(xutil.buf_to_str(N(name).id));
  });
  return ret;
}
*/

function node_get_channel(_s, _d){
  let s = N(_s), d = N(_d);
  return d && d.peers && d.peers.get(s.id.b);
}

const send_msg = (s, d, lbuffer)=>etask(function*send_msg(){
  let channel = node_get_channel(s, d);
  if (!channel)
    return xerr('no channel '+s+d+'>');
  yield N(d).router._on_msg(lbuffer.to_str(), channel);
});

function fake_emit(c, msg){
  if (!t_mode.req)
    return;
  if (t_mode.msg) // XXX: TODO
    return;
  let s = N(c.s), d = N(c.d), to = d.id.s, from = s.id.s;
  msg.to = to;
  msg.from = from;
  let msgid = t_msgid[msgid_hash(msg)];
  assign(msg, {to, from, msgid});
  if (!msg.seq && ['req', 'res'].includes(msg.type))
    msg.seq = 0;
  assert(!c.fwd, 'fwd not allowed in fake_emit');
  assert(msg.req_id, 'missing req_id');
  if (!d.t.fake)
  {
    let lbuffer = new LBuffer(msg); // XXX WIP
    if (['req', 'req_start', 'req_next', 'req_end'].includes(msg.type))
      ReqHandler.t.req_handler_cb.call(d.router, lbuffer);
    else
      Req.t.res_handler(lbuffer);
  }
}

function fake_send_msg(c, msg, dur_ms){
  let s = N(c.s), d = N(c.d), f = s, t = d, fuzzy = get_fuzzy(c.d);
  let to = d.id.s, from = s.id.s;
  msg.to = to;
  msg.from = from;
  if (fuzzy)
    msg.fuzzy = fuzzy;
  assign(msg, {to, from});
  if (c.fwd){
    s = N(fwd_s(c.fwd, 0));
    d = N(fwd_d(c.fwd, 0));
  }
  if (['req', 'req_start', 'req_next', 'req_end'].includes(msg.type)){
    let id = msg.req_id||get_req_id({s: f.t.name, d: t.t.name,
      cmd: msg.cmd});
    if (!id || ['req', 'req_start'].includes(msg.type) && t_msg[id] &&
      t_msg[id].active){
      if (id)
        delete t_msg[id];
      id = ++t_req_id+'';
    }
    msg.req_id = id;
  } else if (['res', 'res_start', 'res_next', 'res_end'].includes(msg.type)){
    msg.req_id = msg.req_id||get_req_id({s: t.t.name, d: f.t.name,
      cmd: msg.cmd});
    assert(msg.req_id, 'missing req_id');
  }
  if (msg.type!='ack'){ // XXX TODO
    msg.msgid = t_msgid[msgid_hash(msg)] = t_msgid[msgid_hash(msg)]||
      ''+s.msgid();
  }
  let lbuffer = new LBuffer(msg);
  if (c.fwd){
    for (let i=c.fwd.length-1; i>=0; i--){
      let rtt = conf_rtt(fwd_s(c.fwd, i), fwd_d(c.fwd, i));
      let msg2 = {from: fwd_s_id(c.fwd, i), to: fwd_d_id(c.fwd, i),
        type: 'fwd', rtt, rt: c.rt2[i],
        range: NodeId.range_to_msg(c.range2[i])};
      lbuffer.add_json(msg2);
    }
  }
  track_msg(lbuffer);
  // XXX: setTimeout - > etask
  if (!d.t.fake){
    if (dur_ms)
      setTimeout(()=>send_msg(s.t.name, d.t.name, lbuffer), dur_ms);
    else
      send_msg(s.t.name, d.t.name, lbuffer);
  }
  if (msg.type!='ack' && !t_conf.no_autoack){
    if (dur_ms)
      setTimeout(()=>do_autoack(lbuffer, c.vv), dur_ms);
    else
      do_autoack(lbuffer, c.vv);
  }
}

const cmd_ensure_no_events = opt=>etask(function*cmd_ensure_no_events(){
  if (t_pre_process)
    return;
  yield this.wait_ext(t_pause);
  let pause = t_pause = etask.wait();
  yield xsinon.wait();
  yield this.wait_ext(t_pending);
  assert(!t_event.length, 'got unexpected event '+events_str());
  t_pause = null;
  if (pause)
    pause.continue();
});

function cmd_mode(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg);
  let event = shift_event(c);
  let mode = {req: false, msg: false}, pop;
  assert(!event, 'got unexpected '+event);
  xutil.forEach(arg, m=>{
    switch (m.cmd){
    case 'req': mode.req = true; break;
    case 'msg': mode.msg = true; break;
    case 'pop': pop = true; break;
    default: assert(0, 'invalid mode '+m.cmd);
    }
  });
  assert(!pop || !mode.req && !mode.msg, 'invalid pop '+c.orig);
  assert(mode.msg, 'mode msg must be specified');
  if (pop){
    assert(t_mode_prev.length>0, 'invalid pop');
    t_mode = t_mode_prev.pop();
  } else {
    t_mode_prev.push(t_mode);
    t_mode = mode;
  }
  test_setup_mode();
}

function cmd_conf(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg);
  let event = shift_event(c);
  let ids, no_node=false;
  assert(!event, 'got unexpected '+event);
  // XXX conf(id:a-mXYZn-z)
  // XXX conf(id:a-mXYZn-z !node) - in order NOT to create the nodes
  // XXX conf(id:a-mXYZn-z node:wrtc) - create wrtc nodes
  // XXX a,b,c=node === a,b,c=node:wss
  xutil.forEach(arg, a=>{
    let cmd = a.cmd, arg2 = a.arg;
    switch (cmd){
    case 'id_bits': set_id_bits(assert_int(arg2)); break;
    case 'id': ids = assign(ids||{}, assert_node_ids(arg2)); break;
    case 'rt': t_conf.rt = assert_bool(arg2); break;
    case 'rtt': assert_rtt(arg2); break;
    case '!node': no_node = assert_bool(arg2); break;
    case '!autoack': t_conf.no_autoack = assert_bool(arg2); break;
    case 'emit_ack': t_conf.emit_ack = assert_bool(arg2); break;
    case 'msg_delay': t_conf.msg_delay = assert_bool(arg2); break;
    case '!msg_delay': t_conf.msg_delay = !assert_bool(arg2); break;
    case 'auto_time':
      t_conf.auto_time = assert_bool(arg2);
      xsinon.clock_set({now: Date.now(), auto_inc: true});
      break;
    case '!auto_time':
      t_conf.auto_time = !assert_bool(arg2);
      xsinon.clock_set({now: Date.now(), auto_inc: true});
      break;
    case 'xerr': xtest.xerr_level(arg2); break;
    default:
      if (/:/.test(cmd)){ // XXX HACK: bug in parser
        let aa = xtest.test_parse_no_dir(cmd);
        assert(aa.length==1, 'invalid conf '+cmd);
        cmd = aa[0].cmd;
        arg2 = build_cmd(aa[0].arg, arg2);
      }
      if (/^[a-zA-Z]-[a-zA-Z]$/.test(cmd))
        ids = assign(ids||{}, gen_ids(cmd[0], cmd[2], arg2));
      else
        assert(0, 'invalid conf '+cmd);
    }
  });
  if (ids)
    set_node_ids(ids);
  if (!t_pre_process)
    return;
  // XXX: rm
  if (ids && !no_node){ let s = '';
    for (let name in ids)
      s += (s ? ' ' : '')+name+'=node:wss';
    push_cmd(s);
  }
}

function setup_ring(arg){
  let arr = arg.match(/^([a-zA-Z])-([a-zA-Z])$/);
  assert.equal(arr?.length, 3, 'invalid arg '+arg);
  let a = arr[1], b = arr[2], s = '', is_upper = /[A-Z]/.test(a);
  assert(!is_upper && /[a-z]/.test(b) ||
    is_upper && /[A-Z]/.test(b), 'invalid arg '+arg);
  assert(a!=b, 'invalid arg '+arg);
  if (!t_pre_process)
    return;
  for (let ch=a, next; ch!=b; ch=next){
    next = String.fromCharCode(ch<(is_upper ? 'Z' : 'z') ? ch.charCodeAt(0)+1 :
      (is_upper ? 'A' : 'a').charCodeAt(0));
    s += (s ? ' ': '')+ch+next+'>!connect';
  }
  s += (s ? ' ': '')+b+a+'>!connect';
  return s;
}

function cmd_ring(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg), s='';
  let event = shift_event(c);
  assert(!event, 'got unexpected '+event);
  if (!t_pre_process)
    return;
  xutil.forEach(arg, a=>{
    if (/^([a-zA-Z])-([a-zA-Z])$/.test(a.cmd))
      s += setup_ring(a.cmd);
    else if (/^([a-zA-Z])([a-zA-Z])$/.test(a.cmd))
      s += ' '+a.cmd+'>!connect';
  });
  set_push_cmd(c, s);
}

function cmd_sp(opt){
  let {c} = opt, s = c.s && N(c.s);
  let event = shift_event(c);
  assert(!event, 'got unexpected '+event);
  assert(!c.arg, 'invalid arg '+c.orig);
  assert(!c.d, 'invalid arg '+c.orig);
  if (t_pre_process || s&&s.t.fake)
    return;
  if (s)
    s.router.node_map.build_rtt_graph();
  for (let name in t_nodes){
    let node = t_nodes[name];
    if (!node.t.fake)
      node.router.node_map.build_rtt_graph();
  }
}

function cmd_test_node_conn(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg), s, exp = {};
  let event = shift_event(c);
  assert(!event, 'got unexpected '+event);
  xutil.forEach(arg, a=>{
    if (!s)
      s = N(a.cmd);
    exp[a.cmd] = a.arg||'';
  });
  if (t_pre_process || s.t.fake)
    return;
  s.router.node_map.map.forEach(node=>{
    let n = node_from_id(node.id.s), n2 = exp[n.t.name];
    // XXX: fix node_map.get to work also with strings
    // XXX: check also node_map.avl
    assert(n2!==undefined, 'node '+n.t.name+' not found');
    let s = '', a = Array.from(node.conn.keys());
    a.sort((a, b)=>NodeId.from(a).cmp(NodeId.from(b)));
    a.forEach(id=>{
      let conn = node.get_conn(NodeId.from(id));
      assert(conn.ids[0].eq(n.id) ? conn.ids[1].s==id :
        conn.ids[1].eq(n.id) && conn.ids[0].s==id);
      let d = node_from_id(id);
      s += (s ? ' ' : '')+d.t.name+':'+(conn.rtt||'na');
    });
    assert.equal(s, n2, 'conn mismatch for '+n.t.name);
    delete exp[n.t.name];
  });
  assert(!Object.keys(exp).length, 'missing nodes '+Object.keys(exp));
}

function cmd_test_node_find(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg);
  let event = shift_event(c);
  let s, target, next, prev, bidi;
  assert(!event, 'got unexpected '+event);
  xutil.forEach(arg, a=>{
    if (!s){
      s = N(a.cmd);
      target = parseFloat(a.arg);
      return;
    }
    switch (a.cmd){
    case 'next': next = a.arg; break;
    case 'prev': prev = a.arg; break;
    case 'bidi': bidi = a.arg; break;
    default: assert.fail('unknown arg '+a.cmd);
    }
  });
  if (t_pre_process || s.t.fake)
    return;
  if (next!==undefined){
    let found = s.router.node_map.find_next(NodeId.from(target));
    assert.equal(node_from_id(found.id.s).t.name, next, 'next mismatch '+
      c.orig);
  }
  if (prev!==undefined){
    let found = s.router.node_map.find_prev(NodeId.from(target));
    assert.equal(found && node_from_id(found.id.s).t.name, prev,
      'prev mismatch '+c.orig);
  }
  if (bidi!==undefined){
    let found = s.router.node_map.find_bidi(NodeId.from(target));
    assert.equal(found && node_from_id(found.id.s).t.name, bidi,
      'bidi mismatch '+c.orig);
  }
}

function cmd_test_node_graph(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg), s, exp = {};
  let event = shift_event(c);
  assert(!event, 'got unexpected '+event);
  xutil.forEach(arg, a=>{
    if (!s){
      s = N(a.cmd);
      assert(!a.arg);
      exp[a.cmd] = '0';
      return;
    }
    exp[a.cmd] = a.arg;
  });
  if (t_pre_process || s.t.fake)
    return;
  let ret = {};
  for (let [, node] of s.router.node_map.map){
    let p = path_to_str(node.graph.path, '<')+s.t.name;
    ret[p] = ''+(node.graph.rtt||0);
  }
  assert.deepEqual(ret, exp);
}

function cmd_test(opt){
  // XXX: wrap logic. similar in cmd_dbg, cmd_comment
  let {c} = opt;
  let arg = xtest.test_parse_plugin(c.arg, null, {no_dir: true});
  if (t_pre_process)
    return;
  assert(arg.length==1, 'invalid '+c.orig);
  if (arg[0].cmd=='rtt')
    cmd_test_rtt(c.s, arg[0].arg);
  else if (/(^\d*)ms$/.test(arg[0].cmd))
    cmd_test_time(c, arg[0]);
  else
    cmd_test_state(c, arg[0]);
}

function cmd_test_rtt(s, arg){
  let a = arg.match(/^([a-zA-Z]):([0-9]+$)/);
  if (a?.length==3){ // a#rtt(b:200)
    let node = N(s), dst = N(a[1]), exp = +a[2];
    if (node.t.fake)
      return;
    let conn = node.router.node_map.get_conn({ids: [node.id, dst.id]});
    let channel = node.router.get_channel_from_id(dst.id);
    assert.equal(conn?.rtt, exp, 'invalid rtt '+s+'#'+arg);
    assert.equal(channel.rtt, exp, 'invalid channel rtt '+s+'#'+arg);
    return;
  }
  a = arg.match(/^([<>][0-9]+\.[0-9]+) ([0-9]+$)/);
  assert.equal(a?.length, 3, 'invalid cmd_test_rtt '+arg);
  let node = N(s), id = id_from_req_id(a[1]);
  let seq = seq_from_req_id(a[1]), dir = dir_from_req_id(a[1]);
  let rtt = assert_int(a[2]);
  if (node.t.fake)
    return;
  let state_o = node.router.state[id];
  assert(state_o, 'req not found '+arg);
  assert(state_o[dir], 'req not found '+arg);
  assert(state_o[dir][seq], 'req not found '+arg);
  let seq_o = node.router.state[id][dir][seq];
  assert.equal(seq_o.rtt, rtt ? rtt : undefined, 'rtt mismatch '+s+' '+arg);
}

function cmd_test_time(c, arg){
  let a = arg.cmd.match(/(^\d*)ms$/);
  let ms = a[1];
  if (ms=='')
    t_prev_time = Date.now();
  else {
    assert(t_prev_time!==undefined, 't_prev_time not defined, use #ms');
    assert.equal(Date.now()-t_prev_time, ms, 'expected time mismatch');
    t_prev_time = Date.now();
  }
}

function cmd_test_state(c, arg){
  let node = N(c.s);
  let state, src, dst, id, seq, dir, v, curr;
  curr = arg?.cmd=='same' ? t_test_prev[node.t.name] : arg;
  t_test_prev[node.t.name] = assign({}, curr);
  if (curr?.cmd=='!id'){ // eg. !id(1)
    id = id_from_req_id(curr.arg);
    if (!node.t.fake)
      assert.equal(node.router.state[id], undefined);
  } else if (curr){ // eg. ac>opening(...)
    let o = xtest.parse_cmd_dir(curr.cmd);
    state = o.cmd;
    src = N(o.s);
    dst = N(o.d);
    let not_exist;
    xutil.forEach(xtest.test_parse_plugin(curr.arg, null, {no_dir: true}), a=>{
      switch (a.cmd){
      case 'id':
        dir = dir_from_req_id(a.arg);
        id = id_from_req_id(a.arg);
        seq = seq_from_req_id(a.arg);
        v = v_from_req_id(a.arg);
        break;
      case '!id':
        dir = dir_from_req_id(a.arg);
        id = id_from_req_id(a.arg);
        seq = seq_from_req_id(a.arg);
        not_exist = true;
        break;
      default:
        assert(!a.arg, 'unknown arg '+a.arg);
        dir = dir_from_req_id(a.cmd);
        id = id_from_req_id(a.cmd);
        seq = seq_from_req_id(a.cmd);
        v = v_from_req_id(a.cmd);
      }
      if (!node.t.fake){
        assert.equal(node.router.state[id]?.src.s, src?.id.s, 'at '+c.orig);
        assert.equal(node.router.state[id]?.dst.s, dst?.id.s, 'at '+c.orig);
        assert.equal(node.router.state[id]?.state, state, 'at '+c.orig);
        if (not_exist){
          assert(!node.router.state[id][dir][seq], 'must not exists '+seq);
        } else {
          assert(!!node.router.state[id][dir][seq], 'missing seq '+seq);
          let seq_state = node.router.state[id][dir][seq].state;
          assert(v=='vv' ? seq_state=='done' : v=='v' ? seq_state=='ack' :
            ['in', 'out'].includes(seq_state), 'wrong state '+seq_state+
            (v ? ' '+v : '')+' '+c.orig);
        }
      }
    });
  } else if (0){ // XXX: TODO
    if (!node.t.fake)
      assert.equal(node.router.state[id]?.state, undefined);
  }
}

function cmd_rt_add(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg);
  let event = shift_event(c);
  let routes = {};
  assert(!event, 'got unexpected '+event);
  xutil.forEach(arg, a=>{
    let node = N(a.cmd);
    assert(node, 'invalid rt_add '+a.cmd);
    let path = assert_path(a.arg);
    assert(path[0]!=node.id.s, 'route cannot contain node '+node.t.name);
    if (is_fake(node.t.name))
      return;
    routes[node.t.name] = routes[node.t.name]||[];
    routes[node.t.name].push(path);
  });
  if (t_pre_process)
    return;
  xutil.forEach(routes, (o, n)=>{
    o.forEach(path=>N(n).router.add_route(path));
  });
}

function cmd_comment(opt){
  let {c} = opt;
  if (t_pre_process)
    return set_orig(c, c.cmd+c.arg+'\r');
}

function cmd_dbg(opt){
  if (t_pre_process)
    return;
  debugger; // eslint-disable-line no-debugger
}

function cmd_setup(opt){
  let {c} = opt, arg = xtest.test_parse_no_dir(c.arg);
  let event = shift_event(c);
  let M = s=>push_cmd(s+' - ');
  assert(!event);
  if (!t_pre_process)
    return;
  // XXX: proper assert setup params
  xutil.forEach(arg, m=>{
    switch (m.cmd){
    case '2_nodes':
      M(`a=node(id:10) b=node(id:20 wss) ab>!connect`);
      break;
    case '2_nodes_wss':
      M(`a,b=node:wss ab>!connect()`);
      break;
    case '3_nodes_linear':
      M(`setup:2_nodes c=node(wss) bc>!connect`);
      break;
    case '3_nodes_wss':
      M(`setup:2_nodes_wss c=node(wss) bc,ac>!connect`);
      break;
    case '4_nodes_wss':
      M(`setup(3_nodes_wss) d=node(wss) cd,db,da>!connect`);
      break;
    default: assert(false, 'unknown macro '+m.cmd);
    }
  });
}

function cmd_node(opt){
  let {c} = opt, name, wss, wrtc, bootstrap, id, key;
  let arg = xtest.test_parse_no_dir(c.arg);
  if (c.dir=='=')
    name = c.s;
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'wss': wss = assert_wss(a.arg); break;
    case 'wrtc': wrtc = assert_wrtc(a.arg); break;
    case 'boot': bootstrap = assert_bootstrap(a.arg); break;
    case 'id': id = assert_int(a.arg); break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert_name_new(name);
  if (id)
    id = NodeId.from(hash_from_int(id, t_conf.id_bits, NodeId.bits));
  else
    id = t_conf.node_ids[name];
  assert(id, 'no id for '+name);
  assert(!t_ids[id.s], name+' id already used by '+t_ids[id.s]?.t.name);
  let fake = is_fake(name);
  key = {pub: id.b, priv: '00'};
  assert(!wss || !node_from_url(wss.url), wss?.url+' already used');
  let node = new (fake ? FakeNode : Node)(assign(
    {keys: {priv: s2b(key.priv), pub: s2b(key.pub)}, bootstrap, wrtc},
    wss));
  node.t = {id: node.id.s, name, fake, wss};
  xerr.notice('new node %s id %%s', name, node.id.s);
  t_nodes[name] = node;
  t_ids[node.id.s] = node;
  if (t_conf.emit_ack && !node.t.fake)
    node.router.on('msg', emit_ack_on_msg);
}

function emit_ack_on_msg(lbuffer){
  let msg = lbuffer.msg();
  let ack_connect = t_msg[msg.req_id]?.cmd=='connect';
  if (msg.type!='ack' || ack_connect)
    return;
  let e = event_from_lbuffer(lbuffer, {rx: true});
  e = event_from_lbuffer(lbuffer, {rx: true});
  xerr.notice('*** emit_ack '+e);
  push_event(e);
}

const cmd_connect = opt=>etask(function*(){
  let {c} = opt, s = N(c.s), d = N(c.d);
  let wss, wrtc, arg = xtest.test_parse_no_dir(c.arg), call = c.cmd[0]=='!';
  assert(call, 'only !connect is supported');
  let e = true;
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'wss': wss = assert_wss_url(c.d, a.arg); break;
    case 'wrtc': wrtc = assert_support_wrtc(d.t.name); break;
    case '!!': e = false; break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert(e || call, '!! can only be used in !connect');
  assert(d, 'unknown node '+c.d);
  assert(!node_get_channel(c.s, c.d), 'connection already exists '+c.s+c.d);
  if (!wss && !wrtc && xutil.xor(support_wss(d), support_wrtc(d))){
    wss = wss_from_node(d);
    wrtc = support_wrtc(d);
  }
  assert_exist(c.s);
  assert(wss || wrtc, 'must specify wss or wrtc');
  if (t_pre_process){
    if (call)
    {
      if (e){
        let {msg_delay, auto_time} = t_conf;
        let dur_ms = msg_delay && conf_rtt_from_node(s, d)/2;
        push_cmd(
          c.s+c.d+'>msg(type:req cmd:connect)'+
          (msg_delay&&auto_time ? ' + ' : ' ')+
          c.s+c.d+'<msg(type:req cmd:connect)'+
          (msg_delay&&!auto_time ? ' '+dur_ms+'ms ' : ' ')+
          c.s+c.d+'<ack'+
          (msg_delay&&auto_time ? ' + ' : ' ')+
          c.s+c.d+'>ack'+
          (msg_delay&&!auto_time ? ' '+dur_ms+'ms ' : ' ')
        );
      }
      set_orig(c, build_cmd(dir_c(c)+c.cmd, wss&&'wss', wrtc&&'wrtc', '!!'));
    }
    else
      set_orig(c, build_cmd(dir_c(c)+c.cmd, wss&&'wss', wrtc&&'wrtc'));
    return;
  }
  if (call){
    if (!s.t.fake){
      if (wss)
        yield s.wsConnector.connect(wss);
      else if (wrtc)
        yield s.wrtcConnector.connect(d.id.b);
    } else {
      if (s.t.fake && d.t.fake)
        return;
      let channel = new FakeChannel({local_id: d.id, id: s.id});
      if (wss)
        channel.wsConnector = d.wsConnector;
      else
        channel.wrtcConnector = d.wrtcConnector;
      yield d._onConnection(channel);
    }
  }
});

function cmd_conn_info(opt){
  let {c} = opt, r, nr, basic = !/[*!]/.test(c.cmd[0]);
  let event = shift_event(c);
  let arg = xtest.test_parse_no_dir(c.arg);
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case '!r': nr = true; break;
    case 'r':
      assert(!r, 'invalid '+c.orig);
      r = a.arg||'';
      break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  if (t_pre_process){
    if (basic){
      let s = '';
      if (c.loop){
        s += t_mode.msg ? build_cmd(loop_str(c.loop)+'>fwd',
          build_cmd_o(dir_c(c)+'msg', {type: 'req', cmd: 'conn_info'})) : '';
      } else {
        s += t_mode.msg ? build_cmd_o(dir_c(c)+'msg',
          {type: 'req', cmd: 'conn_info'}) : '';
      }
      s += t_mode.req ? (s ? ' ' : '')+build_cmd_o(c.s+c.d+'>*conn_info') : '';
      if (!nr && r===undefined)
        r = conn_opts_from_node(c.d);
      if (c.loop && r!==undefined){
        s += (s ? ' ': '')+
          build_cmd(rev_loop_str(c.loop)+'>conn_info_r', r);
      }
      set_push_cmd(c, s);
    } else
      set_orig(c, build_cmd(dir_c(c)+c.cmd));
    return;
  }
  assert_event_c(c, event);
  fake_emit(c, {type: 'req', cmd: 'conn_info', body: {}});
}

function cmd_conn_info_r(opt){
  let {c} = opt, s = N(c.s), basic = !/[*!]/.test(c.cmd[0]);
  let event = shift_event(c);
  let arg = xtest.test_parse_no_dir(c.arg), ws, wrtc;
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    // XXX: assert and verify ws is correct url
    case 'ws': ws = wss_from_node(s); break;
    case 'wrtc': wrtc = assert_wrtc(a.arg); break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  if (t_pre_process){
    if (basic){
      let o = {ws: !!ws, wrtc: !!wrtc};
      let s = '';
      if (c.loop){
        s += t_mode.msg ? build_cmd(loop_str(c.loop)+'>fwd',
          build_cmd_o(dir_c(c)+'msg', {type: 'res', cmd: 'conn_info',
          body: conn_opts(o)})) : '';
      } else {
       s += t_mode.msg ? build_cmd_o(dir_c(c)+'msg',
         {type: 'res', cmd: 'conn_info', body: conn_opts(o)}) : '';
     }
     s += t_mode.req ? (s ? ' ' : '')+build_cmd_o(c.s+c.d+'>*conn_info_r', o)
       : '';
     set_push_cmd(c, s);
     } else
       set_orig(c, build_cmd(dir_c(c)+c.cmd, c.arg));
     return;
  }
  assert_event_c(c, event);
  fake_emit(c, {type: 'res', cmd: 'conn_info', body: {ws, wrtc}});
}

function cmd_ping(opt){
  let {c} = opt, basic = !/[*!]/.test(c.cmd[0]);
  let event = shift_event(c);
  assert(!event, 'unexpected event '+event);
  let call = c.cmd[0]=='!', s = N(c.s), d = N(c.d), e = true, rt, id, seq;
  let arg = xtest.test_parse_no_dir(c.arg);
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case '!!': e = !assert_bool(a.arg); break;
    case 'rt': rt = assert_rt(s, a.arg, c.dir); break;
    case 'id':
      id = id_from_req_id(a.arg);
      seq = seq_from_req_id(a.arg);
      break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert(!rt || call, 'rt can only be used with call');
  if (t_pre_process){
    let str;
    if (c.fwd){
      str = build_fwd(c.fwd, c.rt2, c.range2,
        build_cmd_o(normalize(dir_c(c))+'msg',
        {id, seq, type: 'req', cmd: 'ping'}));
    } else if (basic){
      str = build_cmd_o(c.loop ? loop_str(c.loop)+'>msg' : dir_c(c)+'msg',
        {id, seq, type: 'req', cmd: 'ping'});
      set_push_cmd(c, str);
    } else if (call && e){
      let {msg_delay, auto_time} = t_conf;
      let dur_ms = msg_delay && !auto_time && conf_rtt_from_node(s, d)/2;
      str = build_cmd_o(c.s+c.d+'>!ping', {'!!': e,
        'rt': rt && rt_to_str(rt)});
      str += t_mode.msg ? ' '+build_cmd_o(
        c.loop ? loop_str(c.loop)+'>msg' : dir_c(c)+'msg',
        {id, seq, type: 'req', cmd: 'ping'})+
        (!c.loop&&msg_delay&&!auto_time ? ' '+dur_ms+'ms ' : ' ') : '';
      str += build_cmd_o(dir_c(c)+'*req', {id, seq, cmd: 'ping'});
      str += t_mode.msg ? ' '+build_cmd_o(
        c.loop ? rev_loop_str(c.loop)+'>msg' : rev_c(c)+'msg',
        {id, seq, type: 'res', cmd: 'ping'})+
        (!c.loop&&msg_delay&&!auto_time ? ' '+dur_ms+'ms ' : ' ') : '';
      str += build_cmd_o(rev_c(c)+'*res', {id, seq, cmd: 'ping'});
    } else if (c.cmd[0]=='*')
      str = build_cmd_o(dir_c(c)+'*req', {id, seq, cmd: 'ping'});
    if (str)
      set_push_cmd(c, str);
    return;
  }
  if (!call)
    return;
  if (!s.t.fake)
    s.ping(d.id, {req_id: id, rt});
}

function cmd_ping_r(opt){
  let {c} = opt, basic = !/[*!]/.test(c.cmd[0]);
  let event = shift_event(c);
  assert(!event, 'unexpected event '+event);
  let arg = xtest.test_parse_no_dir(c.arg), id, seq;
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'id':
      id = id_from_req_id(a.arg);
      seq = seq_from_req_id(a.arg);
      break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  if (t_pre_process){
    let s = '';
    if (c.fwd){
      s = build_fwd(c.fwd, c.rt2, c.range2,
        build_cmd_o(normalize(dir_c(c))+'msg',
        {id, seq, type: 'res', cmd: 'ping'}));
    } else if (basic){
      s = t_mode.msg ? build_cmd_o(c.loop ? loop_str(c.loop)+'>msg' :
        dir_c(c)+'msg', {id, seq, type: 'res', cmd: 'ping'}) : '';
    } else if (c.cmd[0]=='*')
      s = build_cmd_o(dir_c(c)+'*res', {id, seq, cmd: 'ping'});
    if (s)
      set_push_cmd(c, s);
    return;
  }
}

function cmd_ack(opt){
  let {c} = opt;
  let event = shift_event(c);
  assert(!event, 'unexpected event');
  let arg = xtest.test_parse_no_dir(c.arg), seq, id, dir, vv, body, rx;
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'vv': vv = assert_bool(a.arg); break;
    case 'rx': rx = assert_bool(a.arg); break;
    case 'id':
      dir = dir_from_req_id(a.arg);
      id = id_from_req_id(a.arg);
      seq = seq_from_req_id(a.arg);
      break;
    case 'body': body = a.arg; break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert(t_pre_process, 'should never happen');
  let s;
  if (c.fwd){
    s = build_fwd(c.fwd, c.rt2, c.range2, build_cmd_o(
      normalize(dir_c(c))+'msg', {id, type: 'ack', seq, dir, vv, body, rx}));
  } else {
    s = build_cmd_o(c.loop ? loop_str(c.loop)+'>msg' :
      dir_c(c)+'msg', {id, type: 'ack', seq, dir, vv, body, rx});
  }
  set_push_cmd(c, s);
}

function cmd_node_ring_join(opt){
  let {c} = opt;
  let event = shift_event(c);
  let s = N(c.s);
  assert(!c.d, 'dst not allowed '+c.orig);
  assert(!c.arg, 'arg not allowed '+c.orig);
  assert.equal(event, undefined, 'unexpected event');
  if (t_pre_process)
    return;
  if (!s.t.fake)
    s.ring_join({n: 2});
}

function cmd_ring_join(opt){
  let {c} = opt;
  let event = shift_event(c);
  let call = c.cmd[0]=='!', s = N(c.s), d = N(c.d, {fuzzy: call});
  let fuzzy = get_fuzzy(c.d), r = true, e = true, id;
  let arg = xtest.test_parse_no_dir(c.arg);
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'id': id = id_from_req_id(a.arg); break;
    case '!r': r = false; break;
    case '!!': e = false; break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert(!call || !event, 'unexpected event for ring_join '+event);
  if (t_pre_process){
    if (c.loop){
      let s = call ? build_cmd_o(c.s+c.d+'>!ring_join') : '';
      const sp = ()=>s ? ' ' : '';
      s += t_mode.msg ? sp()+build_cmd(loop_str(c.loop)+'>fwd',
        build_cmd_o(dir_c(c)+'msg', {type: 'req', cmd: 'ring_join'})) : '';
      let loop = Array.from(c.loop).splice(0, c.loop.length-1);
      let sd = c.s+c.loop[loop.length-1].d+'>';
      s += t_mode.req && e ? sp()+build_cmd_o(sd+'*ring_join') : '';
      s += t_mode.msg && r ?
        sp()+build_cmd(rev_loop_str(loop)+'>ring_join_r') : '';
      s += t_mode.req && r && e ?
        sp()+build_cmd_o(rev_trim(sd)+'*ring_join_r') : '';
      set_push_cmd(c, s);
    }
    return;
  }
  if (call){
    id = id||get_req_id({s: s.t.name, d: d.t.name, cmd: 'ring_join'});
    if (id && t_msg[id] && t_msg[id].active)
      delete t_msg[id];
    if (!s.t.fake)
      s.ring_join_single(d.id, {req_id: id, fuzzy});
    return;
  }
  assert_event_c(c, event);
  fake_emit(c, {type: 'req', cmd: 'ring_join', body: {}});
}

function cmd_ring_join_r(opt){
  let {c} = opt, basic = !/[*!]/.test(c.cmd[0]);
  let event = shift_event(c);
  let arg = xtest.test_parse_no_dir(c.arg);
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  if (t_pre_process){
    if (basic){
      let s;
      if (c.loop){
        s = build_cmd(loop_str(c.loop)+'>fwd',
          build_cmd_o(dir_c(c)+'msg', {type: 'res', cmd: 'ring_join'}));
      } else
        s = build_cmd_o(dir_c(c)+'msg', {type: 'res', cmd: 'ring_join'});
      set_push_cmd(c, s);
    }
    return;
  }
  assert_event_c(c, event);
  fake_emit(c, {type: 'res', cmd: 'ring_join_r', body: ''});
}

const cmd_msg = opt=>etask(function*cmd_msg(){
  let {c} = opt, s = N(c.s), d = N(c.d), event;
  assert(s && d, 'invalid event '+c.orig);
  let arg = xtest.test_parse_no_dir(c.arg), body;
  let id, type, cmd, seq, dir, ack, a, vv, rx;
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'id':
      id = id_from_req_id(a.arg);
      seq = seq_from_req_id(a.arg);
      break;
    case 'type': type = a.arg; break;
    case 'vv': vv = assert_bool(a.arg); break;
    case 'rx': rx = assert_bool(a.arg); break;
    case 'cmd': cmd = a.arg||''; break;
    case 'ack': ack = assert_ack(a.arg); break;
    case 'seq': seq = assert_int(a.arg); break;
    case 'dir': dir = a.arg; break;
    case 'body': body = a.arg; break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  cmd = cmd||'';
  if (t_pre_process){
    if (c.loop)
      c = expand_loop_fwd(c);
    else {
      set_orig(c, build_cmd_o(dir_c(c)+c.cmd, {id, type, cmd, seq, ack, dir,
        vv, body, rx}));
    }
    return;
  }
  let _s = s, _d = d;
  if (c.fwd){
    _s = N(fwd_s(c.fwd, 0));
    _d = N(fwd_d(c.fwd, 0));
  }
  let dur_ms = t_conf.msg_delay ? conf_rtt_from_node(_s, _d)/2 : undefined;
  if (!_s.t.fake && !rx){
    assert(!event || !t_event.length, 'queue:\n'+events_str()+
      '\ngot:\n'+event);
    if (!(event = event||shift_event(c))){
      assert(!t_pending, 'already pending for event');
      xerr.notice('waiting for event %s%s t_i %s',
        c.fwd?.length ? 'fwd '+c.fwd+' ' : '', c.orig, t_i);
      yield t_pending = etask.wait();
      event = shift_event(c);
      assert(event, 'no event after pending');
    }
  }
  if (['req', 'req_start', 'req_next', 'req_end'].includes(type)){
    id = id||get_req_id({s: s.t.name, d: d.t.name, cmd});
    if (!id && s.t.fake)
      id = ++t_req_id+'';
  } else if (['res', 'res_start', 'res_next', 'res_end'].includes(type)){
    // XXX HACK: we use t_req_id_last to handle fuzzy. in fuzzy a-a>req
    // but the response is sent from uknown node.
    id = id||get_req_id({s: d.t.name, d: s.t.name, cmd})||t_req_id_last;
  } else if (type=='ack'){
    if (!id){ // XXX HACK for connect (need to support for any ack)
      id = get_req_id({s: d.t.name, d: s.t.name, cmd: 'connect'});
      if (id){
        dir = '>';
        seq = 0;
        vv = true;
      }
    }
  }
  assert(id, 'missing req_id');
  if (ack===undefined && ['req_next', 'req_end', 'res', 'res_start',
    'res_next', 'res_end'].includes(type)){
    ack = get_ack({req_id: id,
      type: ['req_next', 'req_end'].includes(type) ? 'res' : 'req',
      keep: t_mode.req && t_mode.msg || !c.fwd || fwd_d(c.fwd, 0)!=d.t.name});
  }
  if (['req', 'res', 'req_start', 'res_start'].includes(type)) // XXX HACK: rm
    seq = seq||0;
  if (type=='res') // XXX HACK: rm
    ack = ack||0;
  let expected = build_cmd_o(dir_c(c)+c.cmd,
    {id, type, cmd, seq, ack, dir, vv, body, rx});
  if (rx){
    if (!_d.t.fake){
      if (c.fwd)
        expected = build_fwd(c.fwd, c.rt2, c.range2, normalize(expected));
      event = shift_event(c);
      assert_event(event, expected, 'event rx mismatch');
    }
    return;
  }
  assert_event_c2(c, expected, c.fwd, event, false);
  if (type=='req'){
    switch (cmd){
    case 'conn_info': break;
    case 'ring_join': break;
    case 'ping': break;
    case 'connect': break;
    case '': break;
    default: assert(0, 'invalid cmd '+cmd);
    }
  } else if (type=='res'){
    switch (cmd){
    case 'conn_info':
      a = body ? body.split(' ') : [];
      body = {};
      a.forEach(connector=>{
        if (connector=='wrtc')
          body.wrtc = true;
        else if (connector=='ws')
          body.ws = wss_from_node(s);
        else
          assert(0, 'invalid connector '+connector);
      });
      break;
    case 'ring_join': body= ''; break;
    case 'ping': body= ''; break;
    case '': break;
    default: assert(0, 'invalid cmd '+cmd);
    }
  } else if (type=='ack'){
    if (body)
      body = {rt: parse_path(body.replace('rt:', ''))};
  } else if (!['req_start', 'req_next', 'req_end', 'res_start', 'res_next',
      'res_end'].includes(type)){
    assert.fail('invalid type '+type);
  }
  let rt; // XXX: rm this logic. just pass c.rt
  if (c.rt)
    rt = {path: parse_path(path_to_str(c.rt), c.dir)};
  fake_send_msg(c, {rt, req_id: id, type, seq, ack, dir, cmd, vv, body},
    dur_ms);
  if (t_conf.msg_delay && t_conf.auto_time)
    t_sleep.push(dur_ms);
});

function dir_from_req_id(s){
  let a = s.match(/^([<>]?)([^.]+).([0-9]+)([v]*)$/);
  return a?.length==5 ? a[1] : undefined;
}

function id_from_req_id(s){
  let a = s.match(/^([<>]?)([^.]+).([0-9]+)([v]*)$/);
  return a?.length==5 ? ''+a[2] : s;
}

function seq_from_req_id(s){
  let a = s.match(/^([<>]?)([^.]+).([0-9]+)([v]*)$/);
  return a?.length==5 ? a[3] : undefined;
}

function v_from_req_id(s){
  let a = s.match(/^([<>]?)([^.]+).([0-9]+)([v]*)$/);
  return a?.length==5 ? a[4] : undefined;
}

function cmd_req(opt){
  let {c} = opt, s = N(c.s), d = N(c.d), seq, ack;
  let event = shift_event(c);
  assert(t_pre_process||!c.loop);
  let ooo=false, dup=false, close=false, rt;
  let call = c.cmd[0]=='!', body, id, res;
  let arg = xtest.test_parse_no_dir(c.arg), cmd;
  let type = c.cmd.replace(/[!*]/, ''), e=call, basic = !/[*!]/.test(c.cmd[0]);
  assert(['req', 'req_start', 'req_next', 'req_end'].includes(type),
    'invalid type '+c.cmd);
  xutil.forEach(arg, a=>{ // XXX: proper assert of values
    switch (a.cmd){
    case 'id':
      id = id_from_req_id(a.arg);
      seq = seq_from_req_id(a.arg);
      break;
    case 'body': body = a.arg; break;
    case '!!': e = !assert_bool(a.arg); break;
    case 'ooo': ooo = assert_bool(a.arg); break;
    case 'dup': dup = assert_bool(a.arg); break;
    case 'close': close = assert_bool(a.arg); break;
    case 'cmd': cmd = a.arg; break;
    case 'seq': seq = assert_int(a.arg); break;
    case 'ack': ack = assert_ack(a.arg); break;
    case 'rt': rt = assert_rt(s, a.arg, c.dir); break;
    case 'res':
      assert(call, 'res only valid for !req');
      res = a.arg||'';
      break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert(call || !e, '!! only avail for call mode');
  cmd = cmd||'';
  if (t_pre_process){
    if (basic){
      s = build_cmd_o(c.loop ? loop_str(c.loop)+'>msg' : dir_c(c)+'msg',
        {id, type, cmd, seq, ack, body});
      if (c.fwd)
        set_orig(c, s);
      else
        set_push_cmd(c, s);
      return;
    }
    set_orig(c, build_cmd_o(dir_c(c)+c.cmd, {id, cmd, seq, ack, body, res,
      rt: call && rt ? rt_to_str(rt, c.dir) : undefined,
      '!!': !call ? undefined : true, ooo, dup, close}));
    if (e){
      let s = '';
      if (c.loop){
        s += t_mode.msg ? build_cmd(loop_str(c.loop)+'>fwd',
          build_cmd_o(dir_c(c)+'msg', {type, id, cmd, seq, ack, body})) : '';
      } else {
       s += t_mode.msg ? build_cmd_o(dir_c(c)+'msg',
         {type, id, cmd, seq, ack, body}) : '';
     }
     s += t_mode.req ? (s ? ' ' : '')+build_cmd_o(dir_c(c)+'*'+type,
       {id, cmd, seq, ack, body, close}) : '';
     if (res!==undefined){
        if (c.loop){
          s += t_mode.msg ? (s ? ' ' : '')+
            build_cmd(rev_loop_str(c.loop)+'>fwd', build_cmd_o(rev_c(c)+'msg',
            {type: 'res', id, cmd, body: res})) : '';
        } else {
          s += t_mode.msg ? (s ? ' ' : '')+build_cmd_o(rev_c(c)+'msg',
            {type: 'res', id, cmd, body: res}) : '';
        }
        s += t_mode.req ? (s ? ' ' : '')+build_cmd_o(rev_c(c)+'*res',
          {id, cmd, body: res}) : '';
      }
      push_cmd(s);
    }
    return;
  }
  id = id||get_req_id({s: s.t.name, d: d.t.name, cmd});
  if (call){
    if (!id || ['req', 'req_start'].includes(type) && t_msg[id] &&
      t_msg[id].active){
      if (id)
        delete t_msg[id];
      id = ++t_req_id+'';
    }
  }
  if (!call && ack===undefined){
    ack = get_ack({req_id: id||get_req_id({s: d.t.name, d: s.t.name, cmd}),
      type: 'res'});
  }
  ack = undefined; // XXX HACK: rm
  seq = track_seq_req(s.t.name, d.t.name, id, cmd, type, seq, call);
  cmd = cmd || t_req[id].cmd;
  assert_event_c2(c, build_cmd_o(dir_c(c)+c.cmd,
    {id, seq, ack, cmd, body}), c.fwd, event, call);
  if (!call)
    return fake_emit(c, {type, req_id: id, seq, ack, cmd, body});
  seq = t_req[id].seq;
  if (!s.t.fake){
    if (type=='req'){
      assert(!Req.t.reqs[id], 'req already exists '+id);
      let req = new Req({node: s, dst: d.id.s, req_id: id, cmd, rt});
      assert.equal(req.req_id, id, 'req_id mismatch');
      req.send({seq, ack}, body);
    } else if (type=='req_start'){
      assert(!Req.t.reqs[id], 'req already exists '+id);
      let req = new Req({node: s, stream: true, dst: d.id.s, req_id: id,
        cmd, rt});
      assert.equal(req.req_id, id, 'req_id mismatch');
      req.send({seq, ack}, body);
    } else if (type=='req_next')
      Req.t.reqs[id].req.send({seq, ack}, body);
    else if (type=='req_end'){
      if (close)
          Req.t.reqs[id].req.send_close({seq, ack}, body);
      else
        Req.t.reqs[id].req.send_end({seq, ack}, body);
    } else
      assert(0, 'invalid type '+type);
  }
  if (!d.t.fake){
    let req_handler = d.t.req_handler; // XXX: need to hash it by cmd
    if (!req_handler){
      req_handler = ReqHandler.get(d.id, cmd) ||
        new ReqHandler({node: d, cmd});
      d.t.req_handler = req_handler;
    }
    if (res){
      req_handler.on('req', t_req[id].cb = (msg, _res)=>{
        // XXX: need req_handler.destroy();
        req_handler.off('req', t_req[id].cb);
        delete t_req[id].cb;
        _res.send(res);
      });
    }
  }
}

function cmd_res(opt){
  let {c} = opt, s = N(c.s), d = N(c.d);
  let event = shift_event(c);
  assert(t_pre_process||!c.loop);
  let call = c.cmd[0]=='!', body, id, _id;
  let arg = xtest.test_parse_no_dir(c.arg);
  let type = c.cmd.replace(/[!*]/, ''), cmd='', seq, ack, e=call;
  let ooo=false, dup=false, close=false, basic = !/[*!]/.test(c.cmd[0]);
  assert(s, 'invalid event '+c.orig);
  assert(['res', 'res_start', 'res_next', 'res_end'].includes(type),
    'invalid type '+c.cmd);
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'id':
      id = id_from_req_id(a.arg);
      seq = seq_from_req_id(a.arg);
      break;
    case '!!': e = !assert_bool(a.arg); break;
    case 'ooo': ooo = assert_bool(a.arg); break;
    case 'dup': dup = assert_bool(a.arg); break;
    case 'close': close = assert_bool(a.arg); break;
    case 'body': body = a.arg; break;
    case 'cmd': cmd = a.arg; break;
    case 'seq': seq = assert_int(a.arg); break;
    case 'ack': ack = assert_ack(a.arg); break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert(call || !e, '!! only avail for call mode');
  if (t_pre_process){
    if (basic){
      s = build_cmd_o(c.loop ? loop_str(c.loop)+'>msg' : dir_c(c)+'msg',
        {id, type, cmd, seq, ack, body});
      if (c.fwd)
        set_orig(c, s);
      else
        set_push_cmd(c, s);
      return;
    }
    set_orig(c, build_cmd_o(dir_c(c)+c.cmd, {id, cmd, seq, ack,
      body, '!!': !call ? undefined : true, ooo, dup, close}));
    if (e){
      let s = '';
      if (c.loop){
        s = t_mode.msg ? build_cmd(loop_str(c.loop)+'>fwd',
          build_cmd_o(dir_c(c)+'msg', {type, id, cmd, seq, ack, body})) : '';
      } else {
        s = t_mode.msg ? build_cmd_o(dir_c(c)+'msg',
          {type, id, cmd, seq, ack, body}) : '';
      }
      s += t_mode.req ? (s ? ' ' : '')+
        build_cmd_o(dir_c(c)+'*'+type, {id, cmd, seq, ack, body, close}) : '';
      push_cmd(s);
    }
    return;
  }
  id = id||get_req_id({s: d.t.name, d: s.t.name, cmd});
  if (!d){
    assert_event_c2(c, build_cmd_o(dir_c(c)+c.cmd,
      {id, cmd, seq, ack, body, ooo, dup, close}), c.fwd, event, call);
    return;
  }
  _id = id||get_req_id({s: d.t.name, d: s.t.name, cmd});
  if (!call && ack===undefined)
    ack = get_ack({req_id: _id, type: 'req'});
  ack = undefined; // XXX HACK: rm
  seq = track_seq_res(s.t.name, d.t.name, id, type, seq, call);
  cmd = cmd || t_req[id].cmd;
  assert(seq!==undefined, 'must have seq cmd '+c.orig);
  assert_event_c2(c, build_cmd_o(dir_c(c)+c.cmd,
    {id, seq, ack, cmd, body}), c.fwd, event, call);
  id = _id;
  if (!call)
    return fake_emit(c, {type, req_id: id, seq, ack, cmd, body});
  if (!s.t.fake){
    if (type=='res_end'){
      if (close){
        ReqHandler.t.nodes[s.id.s].req_id[id].res.send_close({seq, ack},
          body);
      } else {
        ReqHandler.t.nodes[s.id.s].req_id[id].res.send_end({seq, ack},
          body);
      }
    } else
      ReqHandler.t.nodes[s.id.s].req_id[id].res.send({seq, ack}, body);
  }
}

function cmd_fail(opt){
  let {c} = opt, s = N(c.s), d = N(c.d);
  let event = shift_event(c);
  assert(s && !d, 'invalid event '+c.orig);
  let error, id, seq, arg = xtest.test_parse_no_dir(c.arg);
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    case 'id': id = a.arg; break;
    case 'seq': seq = assert_int(a.arg); break;
    case 'error': error = a.arg; break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  assert(error, 'fail missing error');
  if (t_pre_process)
    return set_orig(c, build_cmd_o(dir_c(c)+c.cmd, {id, seq, error}));
  assert_event_c(c, event);
}

function fill_rtt(c, rt){
  if (!rt?.path)
    return;
  assert(!rt.rtt);
  let s0 = N(c.s), d0 = N(c.d), path = rt.path;
  rt.rtt = [];
  for (let i=0, prev=d0; i<path.length; i++){
    let curr = node_from_id(path[i]);
    let rtt = 1000;
    if (s0.t.rtt)
      rtt = s0.t.rtt[rtt_hash(prev.t.name, curr.t.name)]||1000;
    rt.rtt.push(rtt);
    prev = curr;
  }
}

const cmd_fwd = opt=>etask(function*cmd_fwd(){
  let {c} = opt;
  let arg = xtest.test_parse_no_dir(c.arg), f = arg.shift(), rt, range, vv;
  xutil.forEach(arg, a=>{
    switch (a.cmd){
    // XXX: replace null with correct src in assert_rt
    case 'rt': rt = assert_rt(null, a.arg, c.dir); break;
    case 'range': range = assert_range(a.arg); break;
    case 'vv': vv = assert_bool(a.arg); break;
    default: assert(0, 'unknown arg '+a.cmd);
    }
  });
  if (t_pre_process){
    if (c.loop)
      return expand_loop_fwd(c);
  }
  f.vv = vv||c.vv;
  f.fwd = Array.from(c.fwd||[]);
  f.fwd.push(dir_c(c));
  f.rt2 = Array.from(c.rt2||[]); // XXX: rm from here!
  fill_rtt(c, rt);
  f.rt2.push(rt);
  f.range2 = Array.from(c.range2||[]); // XXX: rm from here!
  f.range2.push(range);
  yield cmd_run_single({c: f});
  if (!t_pre_process)
    return;
  set_orig(c, _build_cmd(f.orig+
    (rt ? ' '+build_cmd('rt', rt_to_str(rt, c.dir)) : '')+
    (range ? ' '+build_cmd('range', range_to_str(range, c.dir)) : '')+
    (vv ? ' vv' : ''), [dir_c(c)]));
});

function cmd_time(opt){
  assert(t_conf.auto_time, '+ allowed only in auto_time');
  if (t_pre_process)
    return;
}

const cmd_run_single = opt=>etask(function*cmd_run_single(){
  let c = opt.c;
  if (t_pre_process){
    let a;
    // XXX: remove from  here
    if ('<>'.includes(c.cmd[2])){
      // XXX fixme:
      // build_cmd(c.s+c.d+c.dir+'fwd', build_cmd(c.cmd, c.arg)))[0]);
      assign(c, xtest.test_parse(
        build_cmd(c.orig.slice(0, 3)+'fwd', c.orig.slice(3)))[0]);
    }
    // XXX: remove from  here
    if (a = c.cmd.match(/(^\d+)ms$/))
      assign(c, xtest.test_parse(build_cmd('ms', a[1]))[0]);
    // XXX: remove from  here
    if (a = c.cmd.match(/(^\d+)s$/))
      assign(c, xtest.test_parse(build_cmd('ms', +a[1]*date.ms.SEC))[0]);
    if (c.loop && c.comma){
      expand_loop_repeat(c);
      return;
    }
  }
  switch (c.cmd){
  case '-': yield cmd_ensure_no_events(opt); break;
  case '//': yield cmd_comment(opt); break;
  case 'dbg': yield cmd_dbg(opt); break;
  case 'setup': yield cmd_setup(opt); break;
  case 'mode': yield cmd_mode(opt); break;
  case 'conf': yield cmd_conf(opt); break;
  case '!ring': yield cmd_ring(opt); break;
  case 'rt_add': yield cmd_rt_add(opt); break;
  case 'node': yield cmd_node(opt); break;
  case '!connect': yield cmd_connect(opt); break;
  case 'conn_info': yield cmd_conn_info(opt); break;
  case '*conn_info': yield cmd_conn_info(opt); break;
  case 'conn_info_r': yield cmd_conn_info_r(opt); break;
  case '*conn_info_r': yield cmd_conn_info_r(opt); break;
  case '!node.ring_join': yield cmd_node_ring_join(opt); break;
  case 'ring_join': yield cmd_ring_join(opt); break;
  case '!ring_join': yield cmd_ring_join(opt); break;
  case '*ring_join': yield cmd_ring_join(opt); break;
  case 'ring_join_r': yield cmd_ring_join_r(opt); break;
  case '*ring_join_r': yield cmd_ring_join_r(opt); break;
  case '*ping': yield cmd_ping(opt); break;
  case 'ping': yield cmd_ping(opt); break;
  case '!ping': yield cmd_ping(opt); break;
  case '*ping_r': yield cmd_ping_r(opt); break;
  case 'ping_r': yield cmd_ping_r(opt); break;
  case 'ack': yield cmd_ack(opt); break;
  case 'msg': yield cmd_msg(opt); break;
  case 'fwd': yield cmd_fwd(opt); break;
  case 'req': yield cmd_req(opt); break;
  case '!req': yield cmd_req(opt); break;
  case '*req': yield cmd_req(opt); break;
  case 'req_start': yield cmd_req(opt); break;
  case '!req_start': yield cmd_req(opt); break;
  case '*req_start': yield cmd_req(opt); break;
  case 'req_next': yield cmd_req(opt); break;
  case '!req_next': yield cmd_req(opt); break;
  case '*req_next': yield cmd_req(opt); break;
  case 'req_end': yield cmd_req(opt); break;
  case '!req_end': yield cmd_req(opt); break;
  case '*req_end': yield cmd_req(opt); break;
  case 'res': yield cmd_res(opt); break;
  case '!res': yield cmd_res(opt); break;
  case '*res': yield cmd_res(opt); break;
  case 'res_start': yield cmd_res(opt); break;
  case '!res_start': yield cmd_res(opt); break;
  case '*res_start': yield cmd_res(opt); break;
  case 'res_next': yield cmd_res(opt); break;
  case '!res_next': yield cmd_res(opt); break;
  case '*res_next': yield cmd_res(opt); break;
  case 'res_end': yield cmd_res(opt); break;
  case '!res_end': yield cmd_res(opt); break;
  case '*res_end': yield cmd_res(opt); break;
  case '*fail': yield cmd_fail(opt); break;
  case 'ms': break; // handled in _test_run
  case '+': yield cmd_time(opt); break;
  case '!sp': yield cmd_sp(opt); break;
  case 'test_node_conn': yield cmd_test_node_conn(opt); break;
  case 'test_node_find': yield cmd_test_node_find(opt); break;
  case 'test_node_graph': yield cmd_test_node_graph(opt); break;
  case 'test': yield cmd_test(opt); break;
  default: assert(false, 'unknown cmd '+c.cmd+ ' '+c.orig);
  }
});

// XXX NOW: need test
function expand_loop_fwd(c){
  assert(c.loop);
  assert(t_pre_process);
  let a = [], l = c.loop, dir = l[0].dir, prev = c.arg;
  let fuzzy = get_fuzzy(l[l.length-1].d);
  let to = N(l[l.length-1].d).id;
  assert(['fwd', 'msg'].includes(c.cmd), 'invalid loop '+c.cmd);
  if (c.cmd=='msg')
    prev = build_cmd(dir_str(l[0].s, l[l.length-1].d, l[0].dir)+c.cmd, c.arg);
  let range;
  for (let i=0; i<(fuzzy ? l.length-1 : l.length); i++){
    let o = assign({}, c, l[i]), rt='';
    delete o.loop;
    o.cmd = 'fwd';
    let end = i+1;
    for (; end<(fuzzy ? l.length-1 : l.length) && !l[end].dot; end++);
    let j;
    for (j=i+1; j<end && !l[j].dot; j++)
      rt += (!rt ? l[j].rt_opt||'' : '')+l[j].d;
    rt += l[j-1].rt_path||'';
    if (fuzzy){
      if (!rt){
        let next = t_conf.node_ids[l[i].d];
        assert(next, l[i].d+' missing id');
        if (!range)
          range = {min: next, max: next};
        else {
          let range2 = {min: next, max: range.max};
          if (to.in_range(range2))
            range = range2;
          else
            range = {min: range.min, max: next};
        }
      }
    }
    o.arg = prev+(rt ? ' rt('+
      (dir=='>' ? rt : rt.split('').reverse().join(''))+')' : '')+
      (fuzzy && !rt ? ' range('+range_to_str(range)+')' : '');
    prev = _build_cmd(o.arg, [dir_c(o)]);
    set_orig(o, prev);
    a.push(o);
    let {msg_delay, auto_time} = t_conf;
    let dur_ms = msg_delay && !auto_time && conf_rtt_from_name(o.s, o.d)/2;
    if (msg_delay && !auto_time){
      a.push({cmd: 'ms', arg: ''+dur_ms, orig: 'ms('+dur_ms+')'});
    }
  }
  return _set_push_cmd(c, a);
}

// XXX NOW: need test
function expand_loop_repeat(c){
  assert(c.loop);
  assert(c.comma);
  assert(t_pre_process);
  let a = [];
  for (let i=0; i<c.loop.length; i++){
    let o = assign({}, c, c.loop[i]);
    delete o.loop;
    set_orig(o, build_cmd(dir_c(o)+o.cmd, o.arg));
    a.push(o);
  }
  return _set_push_cmd(c, a);
}

let t_depth = 0;
const cmd_run = ()=>etask(function*cmd_run(){
  assert(!t_pending, 'cmd_run while pending with event '+events_str());
  assert(t_cmds && t_i<t_cmds.length, t_event.length ?
    'unexpected event '+events_str() : 'invalid t_i '+t_i+' event');
  let c = t_cmds[t_i];
  assert(!t_pause);
  if (t_pause)
    return;
  t_i++;
  t_depth++;
  assert.equal(t_depth, 1);
  xerr.notice('%scmd %s: %s%s', ''.repeat(t_depth), t_i,
    c.s ? build_cmd(c.s+c.d+'>'+c.cmd, c.arg) : c.orig,
    t_event.length ? ' event '+events_str() : '');
  t_reprocess = false;
  yield cmd_run_single({c});
  if (t_pre_process){
    if (t_reprocess)
      t_i--;
    else
      t_cmds_processed.push(assign({}, c));
  }
  t_depth--;
});

function set_id_bits(bits){ t_conf.id_bits = bits; }
function set_node_ids(ids){ t_conf.node_ids = ids||{}; }

function test_start(role){
  xerr.notice('test start role %s pre_process %s', role, t_pre_process);
  t_role = role;
  t_port = 4000;
  assert(!Object.keys(t_nodes).length, 'nodes exists on test start '+
    stringify(Object.keys(t_nodes)));
  t_mode = {msg: true, req: true};
  t_mode_prev = [];
  t_req_id = 1000;
  t_msg = {};
  t_cmds = undefined;
  t_cmds_processed = [];
  t_msgid = {};
  t_req = {};
  t_test_prev = {};
  t_sleep = [];
  t_conf = {rtt: {def: DEF_RTT, conn: {}}, msg_delay: true, auto_time: true};
  t_prev_time = undefined;
  t_event = [];
  t_no_events_allowed_ts = undefined;
  NodeMap.t.t_conf = Router.t.t_conf = t_conf;
  set_id_bits(10);
  set_node_ids(assert_node_ids('a-mXYZn-z'));
}

function test_setup_mode(){
  if (t_mode.req){
    Req.t.res_hook = res_hook;
    ReqHandler.t.req_hook = req_hook;
  } else {
    delete Req.t.res_hook;
    delete ReqHandler.t.req_hook;
  }
  Req.t.fail_hook = fail_hook;
  ReqHandler.t_new_res_hook = new_res_hook;
}

const test_sleep = ms=>etask(function*(){
  if (ms===undefined)
    return;
  assert(!t_no_events_allowed_ts);
  xerr.notice('test_sleep %sms', ms);
  t_no_events_allowed_ts = Date.now()+ms;
  xsinon.set_max_auto_inc(ms);
  yield etask_sleep(ms);
  yield xsinon.wait(); // XXX: needed?
  t_no_events_allowed_ts = undefined;
});

function get_next_sleep(min){
  if (!t_sleep.length)
    return min;
  if (min===undefined){
    min = t_sleep[0];
    t_sleep.forEach(ms=>min = Math.min(min, ms));
  }
  let a=[];
  t_sleep.forEach(ms=>{
    if (ms>min)
      a.push(ms-min);
  });
  t_sleep = a;
  return min;
}

const _test_run = (role, cmds)=>etask(function*_test_run(){
  assert(!t_cmds && !t_i && !t_role, 'test already running');
  test_start(role);
  t_cmds = cmds;
  let exp_time = Date.now(), prev_plus;
  for (t_i=0; t_i<t_cmds.length;){
    assert(!t_event[0] || t_event[0].ts>=Date.now(),
      'event not handled on time '+events_str());
    let c = t_cmds[t_i];
    if (!t_pre_process){
      if (t_pending)
        yield this.wait_ext(t_pending);
      if (t_conf.auto_time){
        let ms;
        if (c.cmd=='ms')
          ms = get_next_sleep(+c.arg);
        else if (c.cmd!='+' && !prev_plus)
          ms = get_next_sleep();
        prev_plus = c.cmd=='+';
        yield test_sleep(ms);
      } else if (!t_conf.auto_time){
        assert.equal(Date.now(), exp_time, 'time moved without explicit cmd');
        if (c.cmd=='ms'){
          let ms = get_next_sleep(+c.arg);
          yield test_sleep(ms);
          exp_time += ms;
        }
      }
      if (t_pause)
        yield this.wait_ext(t_pause);
    }
    cmd_run();
  }
  yield test_end();
});

const test_to_str = cmds=>{
  let a = [];
  cmds.forEach(cmd=>a.push(cmd.orig));
  return a.join(' ');
};

// XXX: copy of xtest.plugin_cmd_dir
function plugin_cmd_dir(o){
  o = xtest.test_parse_cmd_single(test_transform(o.orig));
  let t = xtest.parse_cmd_dir(o.cmd);
  let o2 = assign({}, o);
  assign(o, t, {arg: o2.arg, orig: o2.orig});
  o.meta = assign(o.meta||{}, o2.meta);
  return o;
}

function test_parse(s){
  return xtest.test_run_plugin(xtest.test_parse_cmd_multi(s), plugin_cmd_dir);
}
const test_pre_process = test=>etask(function*test_preprocess(){
  assert(!t_pre_process, 'already in pre_process');
  t_pre_process = true;
  yield _test_run('fake', test_parse(test));
  t_pre_process = false;
  return t_cmds_processed;
});

let in_assert_hook;
const test_run = (role, test, exp_err)=>etask(function*test_run(){
  let _this = this;
  assert(!xtest.assert_hook, 'assert_hook already assigned');
  if (exp_err){
    xtest.assert_hook = function(err, print){
      if (in_assert_hook){
        console.log('assert in assert_hook');
        process.exit(1);
        return;
      }
      in_assert_hook = true;
      // XXX HACK: due to zerr CRIT handling
      if (/xerr L.CRIT in mocha/.test(err)){
        xtest.assert_hook = null;
        in_assert_hook = false;
        return console.log('skip assert in assert');
      }
      console.log('assert_hook %s', err);
      etask(function*(){
        _this.return();
        if (0) // XXX
          yield test_cleanup();
        in_assert_hook = false;
      });
      if (exp_err instanceof RegExp && exp_err.test(err))
        return;
      print(err);
      console.error('expected error %s did not match error:\n%s',
        exp_err, err);
      process.exit(1);
    };
  }
  xerr.notice('pre_process run');
  let cmds = yield test_pre_process(test);
  cmds = xtest.test_parse(test_to_str(cmds));
  xerr.notice('real run');
  xsinon.clock_set({now: 1, auto_inc: true});
  xsinon.set_max_auto_inc(0);
  test_setup_mode();
  yield _test_run(role, cmds);
  xsinon.uninit();
  xtest.assert_hook = null;
  assert(!exp_err, 'FAILED: test PASS but expected to FAIL with '+exp_err);
});

const test_cleanup = ()=>etask(function*test_cleanup(){
  for (let n in t_nodes){
    delete t_ids[t_nodes[n].id.s];
    yield t_nodes[n].destroy();
    delete t_nodes[n];
  }
  t_cmds = t_role = t_i = undefined;
});

const test_end = ()=>etask(function*(){
  xerr.notice('*** test_end');
  yield cmd_ensure_no_events();
  assert(t_cmds, 'test not running');
  assert.equal(t_i, t_cmds.length, 'not all cmds run: '+t_cmds[t_i]);
  if (!t_pre_process){
    xsinon.set_max_auto_inc();
    yield etask_sleep(date.ms.YEAR);
    yield xsinon.wait();
  }
  yield cmd_ensure_no_events();
  assert(xsinon.next()===undefined, 'timers still pending on test end');
  yield test_cleanup();
  assert(!t_event.length, 'test ended while events not recieved yet '
    +events_str());
  assert(!t_pending, 'test ended while t_pending '+t_pending?.expected);
  assert(!Object.keys(Req.t.reqs).length, 'req exists on test end '+
    stringify(Object.keys(Req.t.reqs)));
  assert(!Object.keys(ReqHandler.t.nodes).length,
    'req handler node exists on test end '+
    stringify(Object.keys(ReqHandler.t.nodes)));
  assert(!t_pause, 'test is paused');
  assert.equal(t_depth, 0, 'invalid t_depth');
  xerr.notice('*** test_done');
  xtest.xerr_level(xerr.L.ERR);
});

function test_transform_hash(s){
  let i = s.search('#');
  if (i==-1)
    return s;
  let pre = s.substr(0, i), post = s.substr(i+1);
  if (!pre)
    return 'test('+post+')';
  return pre+'>test('+post+')';
}

function test_transform(s){
  if (s.substr(0, 2)=='//')
    return s;
  if (s.search('#')!=-1)
    return test_transform_hash(s);
  let _d = s.search(/[<>]/);
  if (_d==-1)
    return s;
  let dd = s.search(/[(]/);
  if (dd!=-1 && dd < _d)
    return s;
  let dir = s[_d], pre = s.substr(0, _d), post = s.substr(_d+1, Infinity);
  let a = [], p='', rt='', range='';
  if (!/:/.test(pre))
    return s;
  for (let i=0, open=false; i<pre.length; i++){
    let ch = s[i];
    if (['[', '{'].includes(ch))
      open = ch;
    else if ([']', '}'].includes(ch)){
      assert(open=='[' && ch==']' || open=='{' && ch=='}');
      open = false;
    } else if (open=='[')
      rt += ch;
    else if (open=='{')
      range += ch;
    else if (ch==':'){
      assert(!open, 'missing '+open+' close for '+s);
      let m = rt.split(','), extra;
      assert(m.length<3, 'invalid '+rt);
      rt = m[0];
      extra = m[1] ? ' '+m[1] : '';
      m = range.split(',');
      assert(m.length<3, 'invalid '+range);
      range = m[0];
      extra += m[1] ? ' '+m[1] : '';
      a.push({pre: p+dir, rt: rt ? ' rt('+rt+')' : '',
        range: range ? ' range('+range+')' : '',
        extra});
      p = rt = range = '';
    } else
      p += ch;
  }
  rt = rt ? ' rt('+rt+')' : '';
  range = range ? ' range('+range+')' : '';
  let ret = '';
  a.push({pre: p+dir+post, rt, range});
  a = a.reverse();
  a.forEach((c, i)=>ret = !i ? c.pre :
    c.pre+'fwd('+ret+c.rt+c.range+c.extra+')');
  return ret;
}

describe('buf_util', ()=>{
  it('hash_from_int', function(){
    const _t = (val, bits, max_bits, exp)=>{
      assert.equal(hash_from_int(val, bits, max_bits), exp);
      assert.equal(int_from_hash(exp, bits, max_bits), val);
    };
    const t = (val, bits, exp)=>_t(val, bits, 40, exp);
    t(1, 8, '0100000000');
    t(2, 8, '0200000000');
    t(255, 8, 'ff00000000');
    t(1, 9, '0080000000');
    t(2, 9, '0100000000');
    t(3, 9, '0180000000');
    t(1, 8, '0100000000');
    t(1, 16, '0001000000');
    t(1, 24, '0000010000');
    t(2, 8, '0200000000');
    t(15, 8, '0f00000000');
    t(255, 8, 'ff00000000');
    t(1023, 16, '03ff000000');
    t(1, 10, '0040000000');
    t(1023, 10, 'ffc0000000');
    t(1, 40, '0000000001');
    _t(1, 256, 256,
      '0000000000000000000000000000000000000000000000000000000000000001');
    _t(bigInt(2).pow(256).minus(1).toString(10), 256, 256,
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  });
  it('gen_ids', function(){
    let t=(s, e, mode, exp)=>{
      let ids = gen_ids(s, e, mode), ret = {};
      for (let ch2 in ids)
        ret[ch2] = +ids[ch2].d.toFixed(5);
      assert.deepEqual(ret, exp);
    };
    t('a', 'd', 'head(.1-.5)', {a: 0.1, b: 0.2, c: 0.3, d: 0.4});
    t('a', 'd', '.1-.5', {a: 0.1, b: 0.2, c: 0.3, d: 0.4});
    t('a', 'd', 'tail(.1-.5)', {a: 0.2, b: 0.3, c: 0.4, d: 0.5});
    t('a', 'd', 'mid(.1-.5)', {a: 0.15, b: 0.25, c: 0.35, d: 0.45});
    t('a', 'd', 'exact(.1-.4)', {a: 0.1, b: 0.2, c: 0.3, d: 0.4});
    t('a', 'd', 'head(.9-.3)', {a: 0.9, b: 1, c: 0.1, d: 0.2});
    t('b', 'e', 'head(.1-.5)', {b: 0.1, c: 0.2, d: 0.3, e: 0.4});
    t('y', 'b', 'head(.1-.5)', {y: 0.1, z: 0.2, a: 0.3, b: 0.4});
    t('A', 'D', 'head(.1-.5)', {A: 0.1, B: 0.2, C: 0.3, D: 0.4});
    t('Y', 'B', 'head(.1-.5)', {Y: 0.1, Z: 0.2, A: 0.3, B: 0.4});
  });
});

describe('util', function(){
  it('fold', function(){
    const t = (s, exp)=>{
      let a = s.split('');
      let ret = util.path_fold(a);
      assert.equal(ret.join(''), exp);
      if (s==exp)
        assert.equal(ret, a);
      else
        assert(ret!==a);
    };
    t('', '');
    t('a', 'a');
    t('aa', 'a');
    t('ab', 'ab');
    t('aab', 'ab');
    t('aba', 'a');
    t('abc', 'abc');
    t('aXbXdefdg', 'aXdg');
    t('bXaX', 'bX');
    t('bXaXa', 'bXa');
    t('cXaXbX', 'cX');
    t('cXbXaXb', 'cXb');
    t('dXaXbXcX', 'dX');
    t('dXcXbXaXc', 'dXc');
  });
});
describe('node_id', function(){
  it('basic', function(){
    const i2b = val=>s2b(hash_from_int(val, 80, 80));
    const t = (val, exp)=>{
      let id = NodeId.from(i2b(val));
      assert.equal(id.s, exp);
      assert.equal(id.b.toString('hex'), exp);
      id = new NodeId(Buffer.from(exp, 'hex'));
      assert.equal(id.s, exp);
      assert.equal(id.b.toString('hex'), exp);
    };
    t(1, '00000000000000000001');
    t(2, '00000000000000000002');
    t(8, '00000000000000000008');
    t(15, '0000000000000000000f');
    t(16, '00000000000000000010');
    t(bigInt(2).pow(48).minus(1).toString(10), '00000000ffffffffffff');
    t('281474976710655', '00000000ffffffffffff');
    t(bigInt(2).pow(52).minus(1).toString(10), '0000000fffffffffffff');
    t(bigInt(2).pow(56).minus(1).toString(10), '000000ffffffffffffff');
    t(bigInt(2).pow(80).minus(1).toString(10), 'ffffffffffffffffffff');
    t(bigInt(2).pow(80).minus(2).toString(10), 'fffffffffffffffffffe');
    t(bigInt(2).pow(80).minus(15).toString(10), 'fffffffffffffffffff1');
    t(bigInt(2).pow(80).minus(16).toString(10), 'fffffffffffffffffff0');
  });
  it('buffer', function(){
    const t = (s, exp)=>{
      let id = NodeId.from(s);
      assert.equal(id.s, exp);
    };
    t('00000000000000000000', '00000000000000000000');
    // XXX: fixme: it should be 00000000000000000000
    t('00000000000000', '00000000000000');
  });
  it('number', function(){
    const t = (s, exp, exp_f)=>{
      let id = NodeId.from(s);
      assert.equal(''+id.i, exp);
      assert.equal(!id.d ? '0' : ''+id.d, exp_f);
    };
    t('00000000000000000000', '0', '0');
    t('00000000000000000001', '0', '0');
    t('00000000000000f00000', '0', '0');
    t('00000000000001000000', '1', '1.3877787807814457e-17');
    t('00000000000002000000', '2', '2.7755575615628914e-17');
    t('fffffffffff000000000', '9007199254736896', '0.9999999999999432');
    t('ffffffffffff00000000', '9007199254740736', '0.9999999999999964');
    t('fffffffffffff0000000', '9007199254740976', '0.9999999999999998');
    t('fffffffffffff8000000', '9007199254740984', '0.9999999999999999');
    t('fffffffffffff9000000', '9007199254740985', '0.9999999999999999');
    t('fffffffffffffe000000', '9007199254740990', '1');
    t('ffffffffffffff000000', '9007199254740991', '1');
    t('ffffffffffffff100000', '9007199254740991', '1');
    t('ffffffffffffffffffff', '9007199254740991', '1');
    t('1ffffffffffff0000000', 9007199254740976, '0.12499999999999978');
    t('20000000000000000000', 0, '0.125');
  });
  it('from_double', function(){
    const t = (d, exp_s, exp_d)=>{
      let id = NodeId.from(d);
      assert.equal(''+id.s, exp_s);
      assert.equal(''+id.d, exp_d);
    };
    t(0, '0000000000000000000000000000000000000000', '0');
    t(0.125, '1ffffffffffff000000000000000000000000000',
      '0.12499999999999978');
    t(0.25, '3ffffffffffff000000000000000000000000000', '0.24999999999999978');
    t(0.5, '7ffffffffffff000000000000000000000000000', '0.4999999999999998');
    t(0.75, 'bffffffffffff000000000000000000000000000', '0.7499999999999998');
    t(1, 'ffffffffffffffffffffffffffffffffffffffff', '1');
    t('0', '0000000000000000000000000000000000000000', '0');
    t('1', 'ffffffffffffffffffffffffffffffffffffffff', '1');
    t('.0', '0000000000000000000000000000000000000000', '0');
    t('0.5', '7ffffffffffff000000000000000000000000000', '0.4999999999999998');
    t('.5', '7ffffffffffff000000000000000000000000000', '0.4999999999999998');
    t('.145e-10', '000000000ff16000000000000000000000000000',
      '1.4499956790814394e-11');
  });
  it('cmp', function(){
    const t = (a, b, exp)=>{
      assert.equal(NodeId.from(a).cmp(NodeId.from(b)), exp);
      assert.equal(NodeId.from(a).eq(NodeId.from(b)), !exp);
    };
    t('00000000000000000000', '00000000000000000000', 0);
    t('00000000000000000000', '00000000000000000001', -1);
    t('00000000000000000001', '00000000000000000000', 1);
    t('00000000000001000000', '00000000000001000000', 0);
    t('00000000000001000000', '00000000000002000000', -1);
    t('00000000000002000000', '00000000000001000000', 1);
    t('fffffffffffff0000000', 'fffffffffffff0000000', -0);
    t('fffffffffffff0000000', 'fffffffffffff8000000', -1);
    t('fffffffffffff8000000', 'fffffffffffff0000000', 1);
    t('fffffffffffff9000000', 'fffffffffffff9000000', 0);
    t('fffffffffffff9000000', 'fffffffffffffe000000', -1);
    t('fffffffffffffe000000', 'fffffffffffff9000000', 1);
    t('fffffffffffffffffffe', 'fffffffffffffffffffe', 0);
    t('fffffffffffffffffffe', 'ffffffffffffffffffff', -1);
    t('ffffffffffffffffffff', 'fffffffffffffffffffe', 1);
    t('ffffffffffffffffffff', 'ffffffffffffffffffff', 0);
  });
  it('in_range', ()=>{
    let t = (range, id, exp)=>{
      range = NodeId.range_from_msg(range);
      id = NodeId.from(id);
      assert.equal(id.in_range(range), exp);
    };
    t({min: 0.10, max: 0.20}, 0.9, false);
    t({min: 0.10, max: 0.20}, 0.10, false);
    t({min: 0.10, max: 0.20}, 0.11, true);
    t({min: 0.10, max: 0.20}, 0.19, true);
    t({min: 0.10, max: 0.20}, 0.20, false);
    t({min: 0.10, max: 0.20}, 0.21, false);
    t({min: 0.20, max: 0.10}, 0.19, false);
    t({min: 0.20, max: 0.10}, 0.20, false);
    t({min: 0.20, max: 0.10}, 0.21, true);
    t({min: 0.20, max: 0.10}, 0.9, true);
    t({min: 0.20, max: 0.10}, 0.10, false);
    t({min: 0.20, max: 0.10}, 0.11, false);
    t({min: 0.10, max: 0.10}, 0.9, true);
    t({min: 0.10, max: 0.10}, 0.10, false);
    t({min: 0.10, max: 0.10}, 0.11, true);
    t({min: 0.25, max: 0.30}, 0.50, false);
    t({min: 0.30, max: 0.40}, 0.50, false);
    t({min: 0.40, max: 0.10}, 0.50, true);
    t({min: 0.10, max: 0.20, inc_max: true}, 0.9, false);
    t({min: 0.10, max: 0.20, inc_max: true}, 0.10, false);
    t({min: 0.10, max: 0.20, inc_max: true}, 0.11, true);
    t({min: 0.10, max: 0.20, inc_max: true}, 0.19, true);
    t({min: 0.10, max: 0.20, inc_max: true}, 0.20, true);
    t({min: 0.10, max: 0.20, inc_max: true}, 0.21, false);
    t({min: 0.20, max: 0.10, inc_max: true}, 0.19, false);
    t({min: 0.20, max: 0.10, inc_max: true}, 0.20, false);
    t({min: 0.20, max: 0.10, inc_max: true}, 0.21, true);
    t({min: 0.20, max: 0.10, inc_max: true}, 0.9, true);
    t({min: 0.20, max: 0.10, inc_max: true}, 0.10, true);
    t({min: 0.20, max: 0.10, inc_max: true}, 0.11, false);
    t({min: 0.10, max: 0.10, inc_max: true}, 0.9, true);
    t({min: 0.10, max: 0.10, inc_max: true}, 0.10, true);
    t({min: 0.10, max: 0.10, inc_max: true}, 0.11, true);
    t({min: 0.25, max: 0.30, inc_max: true}, 0.50, false);
    t({min: 0.30, max: 0.40, inc_max: true}, 0.50, false);
    t({min: 0.40, max: 0.10, inc_max: true}, 0.50, true);
    t({min: 0.10, max: 0.20, inc_min: true}, 0.9, false);
    t({min: 0.10, max: 0.20, inc_min: true}, 0.10, true);
    t({min: 0.10, max: 0.20, inc_min: true}, 0.11, true);
    t({min: 0.10, max: 0.20, inc_min: true}, 0.19, true);
    t({min: 0.10, max: 0.20, inc_min: true}, 0.20, false);
    t({min: 0.10, max: 0.20, inc_min: true}, 0.21, false);
    t({min: 0.20, max: 0.10, inc_min: true}, 0.19, false);
    t({min: 0.20, max: 0.10, inc_min: true}, 0.20, true);
    t({min: 0.20, max: 0.10, inc_min: true}, 0.21, true);
    t({min: 0.20, max: 0.10, inc_min: true}, 0.9, true);
    t({min: 0.20, max: 0.10, inc_min: true}, 0.10, false);
    t({min: 0.20, max: 0.10, inc_min: true}, 0.11, false);
    t({min: 0.10, max: 0.10, inc_min: true}, 0.9, true);
    t({min: 0.10, max: 0.10, inc_min: true}, 0.10, true);
    t({min: 0.10, max: 0.10, inc_min: true}, 0.11, true);
    t({min: 0.25, max: 0.30, inc_min: true}, 0.50, false);
    t({min: 0.30, max: 0.40, inc_min: true}, 0.50, false);
    t({min: 0.40, max: 0.10, inc_min: true}, 0.50, true);
  });
  it('dist', function(){
    const t = (a, b, exp)=>{
      assert.equal(NodeId.from(a).dist(NodeId.from(b)), exp);
      assert.equal(NodeId.from(b).dist(NodeId.from(a)), exp);
    };
    t('00000000000000000000', '00000000000000000000', 0);
    t('00000000000000000000', 'ffffffffffffffffffff', 0);
    t('00000000000000000000', '3fffffffffffffffffff', 0.25);
    t('00000000000000000000', '7fffffffffffffffffff', 0.5);
    t('00000000000000000000', 'bfffffffffffffffffff', 0.25);
    t('3fffffffffffffffffff', '3fffffffffffffffffff', 0);
    t('3fffffffffffffffffff', '7fffffffffffffffffff', 0.25);
    t('3fffffffffffffffffff', 'bfffffffffffffffffff', 0.5);
    t('3fffffffffffffffffff', '00000000000000000000', 0.25);
    t('3fffffffffffffffffff', 'ffffffffffffffffffff', 0.25);
  });
  it('dist_bits', function(){
    const t = (a, b, exp)=>{
      assert.equal((''+NodeId.from(a).dist_bits(NodeId.from(b)).toFixed(3))
        .replace('.000', ''), exp);
      assert.equal((''+NodeId.from(b).dist_bits(NodeId.from(a)).toFixed(3))
        .replace('.000', ''), exp);
    };
    t('00000000000000000000', '00000000000000000000', 0);
    t('00000000000000000000', '00000000000001000000', 0);
    t('00000000000000000000', '00000000000010000000', 1);
    t('00000000000000000000', '00000000000100000000', 5);
    t('00000000000000000000', '00000000001000000000', 9);
    t('00000000000000000000', '00000000010000000000', 13);
    t('00000000000000000000', '00000000100000000000', 17);
    t('00000000000000000000', '01000000000000000000', 45);
    t('00000000000000000000', '10000000000000000000', 49);
    t('00000000000000000000', '5fffffffffffffffffff', 51.585);
    t('00000000000000000000', '7fffffffffffffffffff', 52);
    t('00000000000000000000', '6fffffffffffffffffff', 51.807);
    t('00000000000000000000', 'ffffffffffffffffffff', 0);
    t('0', '.125', 50);
    t('0', '.25', 51);
    t('0', '.37', '51.566');
    t('0', '.375', '51.585');
    t('0', '.38', '51.604');
    t('0', '.4999', '52');
    t('0', '.5', 52);
    t('0', '.75', 51);
    let a=0.1, b=0.2, c=0.3, d=0.4, e=0.5, f=0.6, j=1;
    t(a, a, 0);
    t(a, b, 49.678);
    t(a, c, 50.678);
    t(a, d, 51.263);
    t(a, e, 51.678);
    t(a, f, 52);
    t(a, j, 49.678);
    t(a, '0.11', 46.356);
    t('0', 0, 0);
    t('0', '.1', 49.678);
    t('0', '.2', 50.678);
    t('0', '.3', 51.263);
    t('0', '.4', 51.678);
    t('0', '.5', 52);
    t('0', '.6', 51.678);
    t('0', '.7', 51.263);
    t('0', '.8', 50.678);
    t('0', '.9', 49.678);
    t('0', '1', 0);
    t('0', '0.99', 46.356);
    t('0', '0.999', 43.034);
    t('0', '0.01', 46.356);
    t('0', '0.001', 43.034);
  });
  it('rtt_pb_via', function(){
    const t = (o, exp)=>{
      let s = NodeId.from(o.s), d = NodeId.from(o.d), v = NodeId.from(o.v);
      let ret = NodeId.rtt_pb_via(s, d, v, o.rtt);
      if (exp.good===false)
        return assert.deepEqual(ret, exp);
      assert(ret.good);
      assert.equal(ret.bits_done.toFixed(3), exp.done);
      assert.equal(ret.rtt_pb.toFixed(3), exp.rtt_pb);
    };
    t({s: '0', d: '.5', v: '.001', rtt: 100}, {done: 0.003,
      rtt_pb: 34622.690, dist_bits_sd: 52, dist_bits_vd: 51.997});
    t({s: '0', d: '.5', v: '.125', rtt: 100}, {done: 0.415,
      rtt_pb: 240.942, dist_bits_sd: 52, dist_bits_vd: 51.585});
    t({s: '0', d: '.5', v: '.25', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '0', d: '.5', v: '.375', rtt: 100}, {done: 2,
      rtt_pb: 50, dist_bits_sd: 52, dist_bits_vd: 50});
    t({s: '0', d: '.5', v: '.4375', rtt: 100}, {done: 3,
      rtt_pb: 33.333, dist_bits_sd: 52, dist_bits_vd: 49});
    t({s: '0', d: '.5', v: '.46875', rtt: 100}, {done: 4,
      rtt_pb: 25, dist_bits_sd: 52, dist_bits_vd: 48});
    t({s: '0', d: '.5', v: '.499', rtt: 100}, {done: 8.966,
      rtt_pb: 11.154, dist_bits_sd: 52, dist_bits_vd: 43.034});
    t({s: '0', d: '.5', v: '.5', rtt: 100}, {done: 52,
      rtt_pb: 1.923, dist_bits_sd: 52, dist_bits_vd: 0});
    t({s: '0', d: '.5', v: '.75', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '.25', d: '.5', v: '.375', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 51, dist_bits_vd: 50});
    t({s: '.25', d: '.75', v: '.5', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '.25', d: '.75', v: '0', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '.0025', d: '.0075', v: '.005', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 45.356, dist_bits_vd: 44.356});
    t({s: '0', d: '0', v: '.25', rtt: 100}, {good: false});
    t({s: '0', d: '.5', v: '0', rtt: 100}, {good: false});
    t({s: '0', d: '.5', v: '1', rtt: 100}, {good: false});
    t({s: '.25', d: '.5', v: '.24', rtt: 100}, {good: false});
    t({s: '.25', d: '.5', v: '.76', rtt: 100}, {good: false});
    t({s: '0', d: '8000000000000000000', v: '4000000000000000000', rtt: 100},
      {done: 1, rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '0', d: '8000000000000000000', v: '6000000000000000000', rtt: 100},
      {done: 2, rtt_pb: 50, dist_bits_sd: 52, dist_bits_vd: 50});
    // when dist_bit is almost 0
    t({s: '0', d: '.5', v: '00000000000000000001', rtt: 100}, {done: 0.000,
      rtt_pb: 1000000000});
    t({s: '0', d: '0000000000000000002', v: '00000000000000000001', rtt: 100},
      {done: 0.000, rtt_pb: 1000000000});
    t({s: '0', d: '00000000000000000001', v: '0000000000000000002', rtt: 100},
      {good: false});
    t({s: '0000000000000000001', d: '0.5', v: '0', rtt: 100}, {good: false});
    t({s: '7ffffffffffffffffffd', d: '7fffffffffffffffffff',
      v: '7ffffffffffffffffffe', rtt: 100}, {done: 0.000, rtt_pb: 1000000000});
    t({s: '00000000000000000002', d: '0', v: '00000000000000000001', rtt: 100},
      {done: 0.000, rtt_pb: 1000000000});
    t({s: '00000000000000000001', d: '0', v: '00000000000000000002', rtt: 100},
      {good: false});
  });
  it('rtt_pb_via_fuzzy', function(){
    const t = (o, exp)=>{
      let s = NodeId.from(o.s), d = NodeId.from(o.d), v = NodeId.from(o.v);
      let ret = NodeId.rtt_pb_via_fuzzy(s, d, v, o.rtt);
      if (exp.good===false)
        return assert.deepEqual(ret, exp);
      assert(ret.good);
      assert.equal(ret.bits_done.toFixed(3), exp.done);
      assert.equal(ret.rtt_pb.toFixed(3), exp.rtt_pb);
    };
    t({s: '0', d: '.5', v: '.001', rtt: 100}, {done: 0.003,
      rtt_pb: 34622.690, dist_bits_sd: 52, dist_bits_vd: 51.997});
    t({s: '0', d: '.5', v: '.125', rtt: 100}, {done: 0.415,
      rtt_pb: 240.942, dist_bits_sd: 52, dist_bits_vd: 51.585});
    t({s: '0', d: '.5', v: '.25', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '0', d: '.5', v: '.375', rtt: 100}, {done: 2,
      rtt_pb: 50, dist_bits_sd: 52, dist_bits_vd: 50});
    t({s: '0', d: '.5', v: '.4375', rtt: 100}, {done: 3,
      rtt_pb: 33.333, dist_bits_sd: 52, dist_bits_vd: 49});
    t({s: '0', d: '.5', v: '.46875', rtt: 100}, {done: 4,
      rtt_pb: 25, dist_bits_sd: 52, dist_bits_vd: 48});
    t({s: '0', d: '.5', v: '.499', rtt: 100}, {done: 8.966,
      rtt_pb: 11.154, dist_bits_sd: 52, dist_bits_vd: 43.034});
    t({s: '0', d: '.5', v: '.5', rtt: 100}, {done: 52,
      rtt_pb: 1.923, dist_bits_sd: 52, dist_bits_vd: 0});
    t({s: '0', d: '.5', v: '.75', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '.25', d: '.5', v: '.375', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 51, dist_bits_vd: 50});
    t({s: '.25', d: '.75', v: '.5', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '.25', d: '.75', v: '0', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '.0025', d: '.0075', v: '.005', rtt: 100}, {done: 1,
      rtt_pb: 100, dist_bits_sd: 45.356, dist_bits_vd: 44.356});
    t({s: '0', d: '0', v: '.01', rtt: 100}, {done: 5.644, rtt_pb: 17.718});
    t({s: '0', d: '0', v: '.25', rtt: 100}, {done: 1, rtt_pb: 100});
    t({s: '0', d: '0', v: '.99', rtt: 100}, {done: 5.644, rtt_pb: 17.718});
    t({s: '0', d: '.5', v: '0', rtt: 100}, {good: false});
    t({s: '0', d: '.5', v: '1', rtt: 100}, {done: 0, rtt_pb: 1000000000});
    t({s: '.25', d: '.5', v: '.24', rtt: 100}, {done: 0.943, rtt_pb: 105.998});
    t({s: '.25', d: '.5', v: '.76', rtt: 100}, {done: 0.943, rtt_pb: 105.998});
    t({s: '0', d: '8000000000000000000', v: '4000000000000000000', rtt: 100},
      {done: 1, rtt_pb: 100, dist_bits_sd: 52, dist_bits_vd: 51});
    t({s: '0', d: '8000000000000000000', v: '6000000000000000000', rtt: 100},
      {done: 2, rtt_pb: 50, dist_bits_sd: 52, dist_bits_vd: 50});
    // when dist_bit is almost 0
    t({s: '0', d: '.5', v: '00000000000000000001', rtt: 100}, {done: 0.000,
      rtt_pb: 1000000000});
    t({s: '0', d: '0000000000000000002', v: '00000000000000000001', rtt: 100},
      {done: 52, rtt_pb: 1.923});
    t({s: '0', d: '00000000000000000001', v: '0000000000000000002', rtt: 100},
      {done: 52, rtt_pb: 1.923});
    t({s: '0000000000000000001', d: '0.5', v: '0', rtt: 100}, {
      done: 0, rtt_pb: 1000000000});
    t({s: '7ffffffffffffffffffd', d: '7fffffffffffffffffff',
      v: '7ffffffffffffffffffe', rtt: 100}, {done: 52, rtt_pb: 1.923});
    t({s: '00000000000000000002', d: '0', v: '00000000000000000001', rtt: 100},
      {done: 52, rtt_pb: 1.923});
    t({s: '00000000000000000001', d: '0', v: '00000000000000000002', rtt: 100},
      {done: 52, rtt_pb: 1.923});
  });
});

describe('api', function(){
  it('transform', ()=>{
   let t = (s, exp)=>assert.equal(test_transform(s), exp);
   t('ab:ad>msg', `ab>fwd(ad>msg)`);
   t('bc:ab:ad>msg', `bc>fwd(ab>fwd(ad>msg))`);
   t('cd:bc:ab:ad>msg', `cd>fwd(bc>fwd(ab>fwd(ad>msg)))`);
   t('ab[c]:ad>msg', `ab>fwd(ad>msg rt(c))`);
   t('ab[c,vv]:ad>msg', `ab>fwd(ad>msg rt(c) vv)`);
   t('ab{c-d}:ad>msg', `ab>fwd(ad>msg range(c-d))`);
   t('ab{c-d,vv}:ad>msg', `ab>fwd(ad>msg range(c-d) vv)`);
   t('ab[abc]{c-d}:ad>msg', `ab>fwd(ad>msg rt(abc) range(c-d))`);
   t('ab[cd]:ad>msg', `ab>fwd(ad>msg rt(cd))`);
   t('cd[x]:bc[y]:ab[z]:ad>msg',
     `cd>fwd(bc>fwd(ab>fwd(ad>msg rt(z)) rt(y)) rt(x))`);
   t('cd{e-f}:bc{g-h}:ab{i-j}:ad>msg',
     `cd>fwd(bc>fwd(ab>fwd(ad>msg range(i-j)) range(g-h)) range(e-f))`);
   t('ab:ad<msg', `ab<fwd(ad<msg)`);
   t('bc:ab:ad<msg', `bc<fwd(ab<fwd(ad<msg))`);
   t('cd:bc:ab:ad<msg', `cd<fwd(bc<fwd(ab<fwd(ad<msg)))`);
   t('da[c]:ba<msg', `da<fwd(ba<msg rt(c))`);
   t('da[cd]:ba<msg', `da<fwd(ba<msg rt(cd))`);
   t('da[z]:ba[y]:cb[x]:dc<msg',
     `da<fwd(ba<fwd(cb<fwd(dc<msg rt(x)) rt(y)) rt(z))`);
   t('ab[cd].e>msg', `ab[cd].e>msg`);
   t('ab[cd].e<msg', `ab[cd].e<msg`);
   t('#ms', `test(ms)`);
   t('#1ms', `test(1ms)`);
   t('a#bc>msg', `a>test(bc>msg)`);
   t('a#bc<msg', `a>test(bc<msg)`);
   t('a,b#bc>msg', `a,b>test(bc>msg)`);
   t('a#ab[c]:ac>opening(id:>1.1)', `a>test(ab[c]:ac>opening(id:>1.1))`);
   t('a>test(ab[c]:ac>opening(id:>1.1))', `a>test(ab[c]:ac>opening(id:>1.1))`);
   t('// a#ab[c]:ac>opening(id:>1.1)', `// a#ab[c]:ac>opening(id:>1.1)`);
   // XXX: add test for invalid
  });
  it('normalize', ()=>{
    let t = (cmd, exp)=>assert.equal(normalize(cmd), exp);
    t('ab>', 'ab>');
    t('ab<', 'ba>');
    t('a>', 'a>');
    t('a<', 'a<');
    t('a', 'a');
    t('ab>c', 'ab>c');
    t('ab<c', 'ba>c');
    t('ab<c(d)', 'ba>c(d)');
  });
  it('rev_trim', ()=>{
    let t = (cmd, exp)=>assert.equal(rev_trim(cmd), exp);
    t('a>', 'a<');
    t('a<', 'a>');
    t('ab>', 'ab<');
    t('ab<', 'ab>');
    t('a>c(d)', 'a<');
    t('ab>c(d)', 'ab<');
  });
  it('dir_str', ()=>{
    let t = (s, d, dir, exp)=>assert.equal(dir_str(s, d, dir), exp);
    t('a', 'b', '>', 'ab>');
    t('a', 'b', '<', 'ba<');
  });
  it('build_cmd', ()=>{
    let t = (arg, exp)=>assert.equal(_build_cmd.apply(this, arg), exp);
    t(['a'], 'a');
    t(['ab>'], 'ab>');
    t(['ab>msg'], 'ab>msg');
    t(['ab>msg', ['cd>']], 'cd>fwd(ab>msg)');
    t(['ab>msg', ['cd>', 'ef>']], 'cd>fwd(ef>fwd(ab>msg))');
    t(['ab>msg', '', 'x'], 'ab>msg(x)');
    t(['ab>msg', '', 'x', 'y'], 'ab>msg(x y)');
    t(['ab>msg', ['cd>'], 'x', 'y'], 'cd>fwd(ab>msg(x y))');
    t(['ab>msg', ['cd>', 'ef>'], 'x', 'y'], 'cd>fwd(ef>fwd(ab>msg(x y)))');
  });
  describe('lbuffer', ()=>{
    it('to_str', ()=>{
      const t = exp=>assert.equal(lbuffer.to_str(), exp);
      let lbuffer = new LBuffer();
      t('\0');
      lbuffer.add_data('a');
      t('\0a');
      lbuffer.add_data('bb');
      t('[2,1]\0bba');
      lbuffer.add_data('ccc');
      t('[3,2,1]\0cccbba');
      lbuffer.add_data('');
      t('[0,3,2,1]\0cccbba');
      lbuffer.add_data('abcdefghijk');
      t('[11,0,3,2,1]\0abcdefghijkcccbba');
    });
    it('from_str', ()=>{
      const t = (s, exp)=>{
        let lbuffer = LBuffer.from(s);
        exp.forEach((data, i)=>exp[i] = {data});
        assert.deepEqual(lbuffer.array, exp);
      };
      t('\0', ['']);
      t('\0a', ['a']);
      t('[]\0a', ['a']);
      t('[2]\0aa', ['aa']);
      t('[2,3]\0aabbb', ['aa', 'bbb']);
      t('[11,0,3,2,1]\0abcdefghijkcccbba',
        ['abcdefghijk', '', 'ccc', 'bb', 'a']);
    });
    if (0) // XXX: fixme
    it('invalid', ()=>{
      let t = (s, exp)=>assert.throws(()=>LBuffer.from(s), {message: exp});
      t(undefined, 'invalid buffer');
      t(null, 'invalid buffer');
      t([], 'invalid buffer');
      t({}, 'invalid buffer');
      t('', 'invalid buffer');
      t('[1]', 'invalid buffer');
      t('["2"]\0aa', 'invalid buffer');
      t('[a]\0abcdefghijk', 'invalid buffer');
      t('[1]\0', 'invalid buffer');
      t('[1]\0ab', 'invalid buffer');
      t('[1,2]\0ab', 'invalid buffer');
      t('[1,2]\0abcd', 'invalid buffer');
    });
  });
});

describe('wallet', ()=>{
  let key = {pub: 'aaec01a08b0640361bd3c0e327e3406255c301f5fe32305a2ca2a50803'+
    'af76fb',
    priv: 'ba186102e13ec32e5273a30df6da2b6c9428258b4ea83ac88df7322e7645b864a'+
    'aec01a08b0640361bd3c0e327e3406255c301f5fe32305a2ca2a50803af76fb'};
  let keys = {priv: s2b(key.priv), pub: s2b(key.pub)};
  let wallet = new Wallet({keys});
  const t = (o, exp)=>assert.deepEqual(wallet.hash_passthrough(o), exp);
  it('hash_obj', ()=>{
    t({}, 'object:0:');
    t({from: 'a'}, 'object:1:string:4:from:string:1:a,');
    t({from: 'a', body: undefined},
      'object:2:string:4:body:Null,string:4:from:string:1:a,');
    t({path: []}, 'object:0:');
    t({path: ['a']}, 'object:0:');
    t({sign: 's'}, 'object:0:');
  });
  it('sign', ()=>{
    const t = msg=>{
      msg.sign = wallet.sign(msg);
       assert(wallet.verify(msg));
       assert(wallet.verify(msg, msg.sign));
       assert(wallet.verify(msg, msg.sign, keys.pub));
    };
    t({});
    t({path: []});
    t({from: 'a'});
  });
  it('sign_fake', ()=>{
    let keys = {priv: '00', pub: 'ff000000'};
    let wallet = new Wallet({keys});
    const t = msg=>{
      msg.sign = wallet.sign(msg);
       assert(wallet.verify(msg));
       assert(wallet.verify(msg, msg.sign));
       assert(wallet.verify(msg, msg.sign, keys.pub));
    };
    t({});
    t({path: []});
    t({from: 'a'});
  });
});

describe('net', function(){
  beforeEach(function(){
    xtest.set(Node, 'WsConnector', FakeWsConnector);
    xtest.set(Node, 'WrtcConnector', FakeWrtcConnector);
  });
  describe('test_api', function(){
    describe('pre_process', function(){
      describe('shortcut', ()=>{
        const _t = (mode, test, exp, both)=>it(mode+(mode ? ' ': '')+test,
          ()=>etask(function*(){
          test_start();
          let setup = mode ? mode+' ' : '';
          let regex = new RegExp('^'+xescape.regex(setup));
          let res = yield test_pre_process(setup+test);
          if (both){
            let res_exp = yield test_pre_process(setup+exp);
            assert.equal(test_to_str(res).replace(regex, ''),
            test_to_str(res_exp).replace(regex, ''));
          } else {
            assert.equal(test_to_str(res).replace(regex, ''),
              string.split_ws(exp).join(' '));
          }
        }));
        const t = (test, exp)=>_t('conf(id:all)', test, exp, true);
        const T = (test, exp)=>_t('a=node:wss b=node:wss '+
          'c=node:wss d=node:wss f=node:wss', test, exp, false);
        describe('conf', ()=>{
          _t('', 'conf(id(Z:10 Y:20))',
            `conf(id(Z:10 Y:20)) Z=node:wss Y=node:wss`);
          _t('', 'conf(id(Z:10 Y:20) !node)', 'conf(id(Z:10 Y:20) !node)');
          _t('', 'conf(id(a-e:head(0-1)) !node)',
            `conf(id(a-e:head(0-1)) !node)`);
          _t('', 'conf(a-e(head(0-1)) !node)', `conf(a-e(head(0-1)) !node)`);
          _t('', 'conf(A-E(head(0-1)) !node)', `conf(A-E(head(0-1)) !node)`);
          _t('', 'conf(id(a-e:mid(0-1)) !node)',
            `conf(id(a-e:mid(0-1)) !node)`);
          _t('', 'conf(id(a-e:tail(0-1)) !node)',
            `conf(id(a-e:tail(0-1)) !node)`);
          _t('', 'conf(id(a-e:exact(0-1)) !node)',
            `conf(id(a-e:exact(0-1)) !node)`);
          _t('', 'conf(id:a-e !node)', `conf(id:a-e !node)`);
          _t('', 'conf(id:A-E !node)', `conf(id:A-E !node)`);
        });
        t('1ms', `ms(1)`);
        t('12ms', `ms(12)`);
        t('1s', `ms(1000)`);
        t('12s', `ms(12000)`);
        _t('', 's=node(wss)', `s=node(wss)`);
        _t('', 's=node(wss) // XXX', `s=node(wss) // XXX`, true);
        _t('a=node(wss) b=node(wss)', `s=node(wss) // XXX XXX(2)(
          ab>!connect:!!`, `s=node(wss) // XXX XXX(2)(\r ab>!connect(!! wss)`,
          true);
        t('bc>fwd(ab>msg(body:x))', `bc>fwd(ab>msg(body(x)))`);
        t('bc:ab>msg(body:x)', `bc>fwd(ab>msg(body(x)))`);
        t('bc>fwd(ab>msg(body:x) rt:d)', `bc>fwd(ab>msg(body(x)) rt(d))`);
        t('bc>fwd(ab>msg(body:x) rt:!d)', `bc>fwd(ab>msg(body(x)) rt(!d))`);
        t('bc>fwd(ab>msg(body:x) rt:?d)', `bc>fwd(ab>msg(body(x)) rt(?d))`);
        t('bc[d]:ab>msg(body:x)', `bc>fwd(ab>msg(body(x)) rt(d))`);
        t('bc>fwd(de>fwd(ab>msg(body:x)))', `bc>fwd(de>fwd(ab>msg(body(x))))`);
        t('bc>fwd(de>fwd(ab>msg(body:x) rt:c) rt:e)',
          `bc>fwd(de>fwd(ab>msg(body(x)) rt(c)) rt(e))`);
        t('ab.c>msg(body:x)', `ab>fwd(ac>msg(body(x)))
          bc>fwd(ab>fwd(ac>msg(body(x))))`);
        t('a.bcd>msg(body:x)', `ab>fwd(ad>msg(body(x)) rt(cd))
          bc>fwd(ab>fwd(ad>msg(body(x)) rt(cd)) rt(d))
          cd>fwd(bc>fwd(ab>fwd(ad>msg(body(x)) rt(cd)) rt(d)))`);
        t('ab.cd>msg(body:x)', `ab>fwd(ad>msg(body(x)))
          bc>fwd(ab>fwd(ad>msg(body(x))) rt(d))
          cd>fwd(bc>fwd(ab>fwd(ad>msg(body(x))) rt(d)))`);
        t('abc.d>msg(body:x)', `ab>fwd(ad>msg(body(x)) rt(c))
          bc>fwd(ab>fwd(ad>msg(body(x)) rt(c)))
          cd>fwd(bc>fwd(ab>fwd(ad>msg(body(x)) rt(c))))`);
        t('abc>msg(body:x)', `ab>fwd(ac>msg(body(x)) rt(c))
          bc>fwd(ab>fwd(ac>msg(body(x)) rt(c)))`);
        t('abc<msg(body:x)', `bc<fwd(ac<msg(body(x)) rt(a))
          ab<fwd(bc<fwd(ac<msg(body(x)) rt(a)))`);
        t('abc>fwd(ac>msg(body:x))', `ab>fwd(ac>msg(body(x)) rt(c))
          bc>fwd(ab>fwd(ac>msg(body(x)) rt(c)))`);
        t('abc<fwd(ac<msg(body:x))', `bc<fwd(ac<msg(body(x)) rt(a))
          ab<fwd(bc<fwd(ac<msg(body(x)) rt(a)))`);
        t('abc<fwd(ac>msg(body:x))', `bc<fwd(ac>msg(body(x)) rt(a))
          ab<fwd(bc<fwd(ac>msg(body(x)) rt(a)))`);
        t('abcd<fwd(ac>msg(body:x))', `cd<fwd(ac>msg(body(x)) rt(ab))
          bc<fwd(cd<fwd(ac>msg(body(x)) rt(ab)) rt(a))
          ab<fwd(bc<fwd(cd<fwd(ac>msg(body(x)) rt(ab)) rt(a)))`);
        t('conf(auto_time rtt:200) abc>msg(body:x)',
          `conf(auto_time rtt:200) ab>fwd(ac>msg(body(x)) rt(c))
          bc>fwd(ab>fwd(ac>msg(body(x)) rt(c)))`);
        t('conf(!auto_time rtt(200 ab:100)) abc>msg(body:x)',
          `conf(!auto_time rtt(200 ab:100)) ab>fwd(ac>msg(body(x)) rt(c)) 50ms
          bc>fwd(ab>fwd(ac>msg(body(x)) rt(c))) 100ms`);
        t('pX.n.o>fwd(p~p>msg)', `pX:p~p>msg Xn:pX:p~p>msg no:Xn:pX:p~p>msg`);
        t('pX.n.o~p>fwd(p~p>msg)', `pX{X-X}:p~p>msg Xn{n-X}:pX{X-X}:p~p>msg
          no{o-X}:Xn{n-X}:pX{X-X}:p~p>msg`);
        t('pX.n.o.a~p>fwd(p~p>msg)', `pX{X-X}:p~p>msg Xn{n-X}:pX{X-X}:p~p>msg
          no{o-X}:Xn{n-X}:pX{X-X}:p~p>msg
          oa{o-a}:no{o-X}:Xn{n-X}:pX{X-X}:p~p>msg`);
        t('p.X.no.abcd>fwd(pd>msg)', `pX:pd>msg Xn[o]:pX:pd>msg
          no:Xn[o]:pX:pd>msg oa[bcd]:no:Xn[o]:pX:pd>msg
          ab[cd]:oa[bcd]:no:Xn[o]:pX:pd>msg
          bc[d]:ab[cd]:oa[bcd]:no:Xn[o]:pX:pd>msg
          cd:bc[d]:ab[cd]:oa[bcd]:no:Xn[o]:pX:pd>msg`);
        t('pX.no.abcd~p>fwd(p~p>msg)', `pX{X-X}:p~p>msg Xn[o]:pX{X-X}:p~p>msg
          no{o-X}:Xn[o]:pX{X-X}:p~p>msg oa[bcd]:no{o-X}:Xn[o]:pX{X-X}:p~p>msg
          ab[cd]:oa[bcd]:no{o-X}:Xn[o]:pX{X-X}:p~p>msg
          bc[d]:ab[cd]:oa[bcd]:no{o-X}:Xn[o]:pX{X-X}:p~p>msg
          cd{o-d}:bc[d]:ab[cd]:oa[bcd]:no{o-X}:Xn[o]:pX{X-X}:p~p>msg`);
        t('ab>conn_info', `ab>msg(type(req) cmd(conn_info)) ab>*conn_info`);
        t('abc>conn_info(!r)', `ab>fwd(ac>msg(type(req) cmd(conn_info)) rt(c))
          bc>fwd(ab>fwd(ac>msg(type(req) cmd(conn_info)) rt(c)))
          ac>*conn_info`);
        t('abc>conn_info(r:ws)', `
          ab>fwd(ac>msg(type(req) cmd(conn_info)) rt(c))
          bc>fwd(ab>fwd(ac>msg(type(req) cmd(conn_info)) rt(c))) ac>*conn_info
          cb>fwd(ca>msg(type(res) cmd(conn_info) body(ws)) rt(a))
          ba>fwd(cb>fwd(ca>msg(type(res) cmd(conn_info) body(ws)) rt(a)))
          ca>*conn_info_r(ws)`);
        t('ab>conn_info_r(ws wrtc)', `ab>msg(type(res)
          cmd(conn_info) body(ws wrtc)) ab>*conn_info_r(ws wrtc)`);
        t('abc>conn_info_r(ws)', `
          ab>fwd(ac>msg(type(res) cmd(conn_info) body(ws)) rt(c))
          bc>fwd(ab>fwd(ac>msg(type(res) cmd(conn_info) body(ws)) rt(c)))
          ac>*conn_info_r(ws)`);
        t('cd>fwd(ab>msg)', `cd>fwd(ab>msg)`);
        t('cd>fwd(ab>msg rt:abc)', `cd>fwd(ab>msg rt(abc))`);
        t('cd>fwd(ab>msg rt(abc))', `cd>fwd(ab>msg rt(abc))`);
        if (0) // XXX NOW: TODO
        t(`abc>conn_info`, `abc>fwd(ac>msg(type:req cmd(conn_info)))
          ac>*conn_info`);
        if (0){ // XXX NOW: create similar tests for !req or rm
        t('ab>!msg(body:hi !msg)', `ab>!msg(body(hi) !msg)`);
        t('ab>!msg(body:hi)', `ab>!msg(body(hi) !msg) ab>msg(body(hi))`);
        t('ab>!msg(body:hi msg)', `ab>!msg(body(hi) !msg) ab>msg(body(hi))`);
        t('abc>!msg(body:hi)', `ac>!msg(body(hi) !msg) ab>fwd(ac>msg(body(hi)))
          bc>fwd(ac>msg(body(hi)))`);
        t('abc<!msg(body:hi)', `ac<!msg(body(hi) !msg) bc<fwd(ac<msg(body(hi)))
          ab<fwd(ac<msg(body(hi)))`);
        t('ab,bc>!msg(body:hi)', `ac>!msg(body(hi) !msg)
          ab>fwd(ac>msg(body(hi))) bc>fwd(ac>msg(body(hi)))`);
        }
        t('ab>cd>msg(body:hi)', `ab>fwd(cd>msg(body(hi)))`);
        t('ab>cd<msg(body:hi)', `ab>fwd(cd<msg(body(hi)))`);
        t('ab<cd>msg(body:hi)', `ab<fwd(cd>msg(body(hi)))`);
        t('ab<cd<msg(body:hi)', `ab<fwd(cd<msg(body(hi)))`);
        t('ab>msg(id:0 type:req_start cmd:test seq:0 body:b0)',
          `ab>msg(id(0) type(req_start) cmd(test) seq(0) body(b0))`);
        if (0) // XXX: fixme
        t('ab,cd>ef>msg(hi)', `ab>fwd(ef>msg(hi)) cd>fwd(msg(hi))`);
        // XXX TODO: dcb>fwd(da>msg(hi)) - db>!msg(hi) - dc>!msg(hi)`);
        t('ab>*req(id:1 body:ping)', `ab>*req(id(1) body(ping))`);
        t('ab>!req(body:hi !!)', `ab>!req(body(hi) !!)`);
        t('ab>!req(id(0) body:hi !!)', `ab>!req(id(0) body(hi) !!)`);
        if (0) // XXX: rm
        t('ab>!req(id:0 body:ping)', `ab>!req(id(0) body(ping) !!)
          ab>*req(id(0) body(ping))`);
        _t('conf(id(all)) mode(msg)', 'ab>!req(id:0 body:ping)',
          `ab>!req(id(0) body(ping) !!) ab>msg(id(0) type(req) body(ping))`,
          true);
        t('ab>!req(id:0 body:ping)', `ab>!req(id(0) body(ping) !!)
          ab>msg(id(0) type(req) body(ping)) ab>*req(id(0) body(ping))`);
        if (0) // XXX: rm
        t('ab>!req(id:1 body:ping res:ping_r)', `
          ab>!req(id(1) body(ping) res(ping_r) !!)
          ab>*req(id(1) body(ping)) ab<*res(id(1) body(ping_r))`);
        t('ab>!req(id:1 cmd:test seq:1 ack:2 body:ping res:ping_r)', `
          ab>!req(id(1) cmd(test) seq(1) ack(2) body(ping) res(ping_r) !!)
          ab>msg(id(1) type(req) cmd(test) seq(1) ack(2) body(ping))
          ab>*req(id(1) cmd(test) seq(1) ack(2) body(ping))
          ab<msg(id(1) type(res) cmd(test) body(ping_r))
          ab<*res(id(1) cmd(test) body(ping_r))`);
        t('abc>!req(id:0 !!)', `ac>!req(id(0) !!)`);
        t('abc<!req(id:0 !!)', `ac<!req(id(0) !!)`);
        t('abc>!req(id:0)', `ac>!req(id(0) !!)
          ab>fwd(ac>msg(id(0) type(req)) rt(c))
          bc>fwd(ab>fwd(ac>msg(id(0) type(req)) rt(c)))
          ac>*req(id(0))`);
        t('abc<!req(id:0)', `ac<!req(id(0) !!)
          cb>fwd(ac<msg(id(0) type(req)) rt(a))
          ba>fwd(cb>fwd(ac<msg(id(0) type(req)) rt(a)))
          ac<*req(id(0))`);
        t('abc>!req(id:0 cmd:test seq:1 ack:2 body:ping)',
          `ac>!req(id(0) cmd(test) seq(1) ack(2) body(ping) !!)
          ab>fwd(ac>msg(id(0) type(req) cmd(test) seq(1) ack(2) body(ping)) `+
          `rt(c))
          bc>fwd(ab>fwd(ac>msg(id(0) type(req) cmd(test) seq(1) `+
          `ack(2) body(ping)) rt(c)))
           ac>*req(id(0) cmd(test) seq(1) ack(2) body(ping))`);
        t('abc>!req(id:1 cmd:test seq:1 ack:2 body:ping res:ping_r)', `
          ac>!req(id(1) cmd(test) seq(1) ack(2) body(ping) res(ping_r) !!)
          ab>fwd(ac>msg(id(1) type(req) cmd(test) seq(1) ack(2) body(ping)) `+
          `rt(c)) bc>fwd(ab>fwd(ac>msg(id(1) type(req) cmd(test) seq(1) `+
          `ack(2) body(ping)) rt(c)))
          ac>*req(id(1) cmd(test) seq(1) ack(2) body(ping))
          cb>fwd(ac<msg(id(1) type(res) cmd(test) body(ping_r)) rt(a))
          ba>fwd(cb>fwd(ac<msg(id(1) type(res) cmd(test) body(ping_r)) rt(a)))
          ac<*res(id(1) cmd(test) body(ping_r))`);
         // XXX WIP: check why change cb> bc< and ba to ab< breaks test
         t('ab.c>!req(body:ping res:ping_r)', `
           ac>!req(body(ping) res(ping_r) !!)
           ab>fwd(ac>msg(type(req) body(ping)))
           bc>fwd(ab>fwd(ac>msg(type(req) body(ping))))
           ac>*req(body(ping))
           cb>fwd(ac<msg(type(res) body(ping_r)) rt(a))
           ba>fwd(cb>fwd(ac<msg(type(res) body(ping_r)) rt(a)))
           ac<*res(body(ping_r))
         `);
        t('ab>*res(id:1 body:ping)', `ab>*res(id(1) body(ping))`);
        t('ab>!res(body:hi !!)', `ab>!res(body(hi) !!)`);
        t('ab>!res(id(0) body:hi !!)', `ab>!res(id(0) body(hi) !!)`);
        if (0) // XXX: rm
        t('ab>!res(id:0 body:ping)', `ab>!res(id(0) body(ping) !!)
          ab>*res(id(0) body(ping))`);
        _t('conf(id(all)) mode(msg)', 'ab>!res(id:0 body:ping)',
          `ab>!res(id(0) body(ping) !!) ab>msg(id(0) type(res) body(ping))`,
          true);
        t('ab>!res(id:0 cmd:test seq:1 ack:2 body:ping)',
          `ab>!res(id(0) cmd(test) seq(1) ack(2) body(ping) !!)
          ab>msg(id(0) type(res) cmd(test) seq(1) ack(2) body(ping))
           ab>*res(id(0) cmd(test) seq(1) ack(2) body(ping))`);
        t('abc>!res(id:0 !!)', `ac>!res(id(0) !!)`);
        t('abc<!res(id:0 !!)', `ac<!res(id(0) !!)`);
        t('abc>!res(id:0)', `ac>!res(id(0) !!)
          ab>fwd(ac>msg(id(0) type(res)) rt(c))
          bc>fwd(ab>fwd(ac>msg(id(0) type(res)) rt(c))) ac>*res(id(0))`);
        t('abc<!res(id:0)', `ac<!res(id(0) !!)
          cb>fwd(ac<msg(id(0) type(res)) rt(a))
          ba>fwd(cb>fwd(ac<msg(id(0) type(res)) rt(a))) ac<*res(id(0))`);
        t('abc>!res(id:0 cmd:test seq:1 ack:2 body:ping)',
          `ac>!res(id(0) cmd(test) seq(1) ack(2) body(ping) !!)
          ab>fwd(ac>msg(id(0) type(res) cmd(test) seq(1) ack(2) body(ping)) `+
          `rt(c)) bc>fwd(ab>fwd(ac>msg(id(0) type(res) cmd(test) seq(1) `+
          `ack(2) body(ping)) rt(c)))
           ac>*res(id(0) cmd(test) seq(1) ack(2) body(ping))`);
        if (0) // XXX WIP
        t('abcd<*res(id:1 body:ping_r)', `
          cd<fwd(ad<msg(id:1 type:res body:ping_r) path:d rt:ab)
          bc<fwd(cd<fwd(ad<msg(id:1 type:res body:ping_r) path:d rt:ab)
            path:cd rt:a)
          ab<fwd(bc<fwd(cd<fwd(ad<msg(id:1 type:res body:ping_r) path:d rt:ab)
            path:cd rt:a) path:bcd)
          ad<*res(id:1 body:ping_r)`);
        t('a>*fail(id:1 error:timeout)', `a>*fail(id(1) error(timeout))`);
        t('a>*req_start(id:0 cmd:test seq:1 ack:2 body:b0)',
          `a>*req_start(id(0) cmd(test) seq(1) ack(2) body(b0))`);
        t('ab>!req_start(id:1 cmd:test !!)',
          `ab>!req_start(id(1) cmd(test) !!)`);
        if (0) // XXX: rm
        t('ab>!req_start(id:1 cmd:test)', `ab>!req_start(id(1) cmd(test) !!)
          ab>*req_start(id(1) cmd(test))`);
        if (0) // XXX: rm
        t('ab>!res_start(id:1 cmd:test !!)',
          `ab>!res_start(id(1) cmd(test) !!)`);
        if (0) // XXX: rm
        t('ab>!res_start(id:1 cmd:test)', `ab>!res_start(id(1) cmd(test) !!)
          ab>*res_start(id(1) cmd(test))`);
        _t('', 'x,y=node:wss', `x=node(wss) y=node(wss)`);
        t('ab,bc>!connect', `ab>!connect bc>!connect`);
        describe('connect', function(){
          t('ab>!connect(wss !!)', `ab>!connect(wss !!)`);
          t('ab>!connect(!!)', `ab>!connect(wss !!)`);
          t('conf(!msg_delay !auto_time) ab>!connect',
            `conf(!msg_delay !auto_time) ab>!connect(wss !!)
            ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect)
            ab<ack ab>ack`);
          t('conf(rtt:200) ab>!connect', `conf(rtt:200) ab>!connect(wss !!)
             ab>msg(type:req cmd:connect) + ab<msg(type:req cmd:connect)
             ab<ack + ab>ack`);
          t('conf(auto_time rtt:200) ab>!connect',
            `conf(auto_time rtt:200) ab>!connect(wss !!)
             ab>msg(type:req cmd:connect) + ab<msg(type:req cmd:connect)
             ab<ack + ab>ack`);
          t('conf(!auto_time rtt:200) ab>!connect',
            `conf(!auto_time rtt:200) ab>!connect(wss !!)
             ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect) 100ms
             ab<ack ab>ack 100ms`);
        });
        describe('ring', function(){
          t('!ring(a-c)', `ab>!connect bc>!connect ca>!connect`);
          t('!ring(l-o)', `lm>!connect mn>!connect no>!connect ol>!connect`);
          t('!ring(y-b)', `yz>!connect za>!connect ab>!connect by>!connect`);
          t('!ring(A-C)', `AB>!connect BC>!connect CA>!connect`);
          t('!ring(L-O)', `LM>!connect MN>!connect NO>!connect OL>!connect`);
          t('!ring(Y-B)', `YZ>!connect ZA>!connect AB>!connect BY>!connect`);
          t('!ring(a-c de)', `ab>!connect bc>!connect ca>!connect
            de>!connect`);
        });
        describe('ack', function(){
          T('ab>ack', `ab>msg(type(ack))`);
          T('ab<ack', `ab<msg(type(ack))`);
          t('abc>ack', `abc>msg(type(ack))`);
          t('ab<ack(id(>1.0))', `ab<msg(id:1 type:ack seq:0 dir(>))`);
          t('ab<ack(id:>1.0)', `ab<msg(id:1 type:ack seq:0 dir(>))`);
          t('bc[a]:ac<ack(id:>1.0 vv)',
            `cb[a]:ca>msg(type:ack id:1.0 dir:> vv)`);
          t('ab>ack(id:>1.0 body(rt:c) rx)',
            `ab>msg(id:1 type:ack seq:0 dir:> body(rt:c) rx)`);
          t('ab:bc[a]:ac<ack(id:>1.0 vv rx)', `ba>fwd(cb>fwd(ca>msg(id(1)
            type(ack) seq(0) dir(>) vv rx) rt(a)))`);
        });
        describe('fwd', function(){
          t('bc:ac>msg', `bc>fwd(ac>msg)`);
          t('bc:ac<msg', `bc<fwd(ac<msg)`);
          // XXX derry: idea for !msgack in this case?
          // ab[c]:ac>msg(type:req cmd:ping)
          // ab>fwd(ac>msg(type:req cmd:ping) rt:c !msgack)
          t('abc>msg(type:req cmd:ping)', `ab[c]:ac>msg(type:req cmd:ping)
            bc:ab[c]:ac>msg(type:req cmd:ping)`);
          t('!abc>msg(type:req cmd:ping)', `ab[!c]:ac>msg(type:req cmd:ping)
            bc:ab[!c]:ac>msg(type:req cmd:ping)`);
          t('?abc>msg(type:req cmd:ping)', `ab[?c]:ac>msg(type:req cmd:ping)
            bc:ab[?c]:ac>msg(type:req cmd:ping)`);
          t('abc.def>msg(type:req cmd:ping)', `ab[c]:af>msg(type:req cmd:ping)
            bc:ab[c]:af>msg(type:req cmd:ping)
            cd[ef]:bc:ab[c]:af>msg(type:req cmd:ping)
            de[f]:cd[ef]:bc:ab[c]:af>msg(type:req cmd:ping)
            ef:de[f]:cd[ef]:bc:ab[c]:af>msg(type:req cmd:ping)`);
          t('!abc.def>msg(type:req cmd:ping)',
            `ab[!c]:af>msg(type:req cmd:ping)
            bc:ab[!c]:af>msg(type:req cmd:ping)
            cd[ef]:bc:ab[!c]:af>msg(type:req cmd:ping)
            de[f]:cd[ef]:bc:ab[!c]:af>msg(type:req cmd:ping)
            ef:de[f]:cd[ef]:bc:ab[!c]:af>msg(type:req cmd:ping)`);
          t('abc.!def>msg(type:req cmd:ping)',
              `ab[c]:af>msg(type:req cmd:ping)
              bc:ab[c]:af>msg(type:req cmd:ping)
              cd[!ef]:bc:ab[c]:af>msg(type:req cmd:ping)
              de[!f]:cd[!ef]:bc:ab[c]:af>msg(type:req cmd:ping)
              ef:de[!f]:cd[!ef]:bc:ab[c]:af>msg(type:req cmd:ping)`);
          t('!abc.!def>msg(type:req cmd:ping)',
              `ab[!c]:af>msg(type:req cmd:ping)
              bc:ab[!c]:af>msg(type:req cmd:ping)
              cd[!ef]:bc:ab[!c]:af>msg(type:req cmd:ping)
              de[!f]:cd[!ef]:bc:ab[!c]:af>msg(type:req cmd:ping)
              ef:de[!f]:cd[!ef]:bc:ab[!c]:af>msg(type:req cmd:ping)`);
          t('abc<msg(type:req cmd:ping)', `bc[a]:ac<msg(type:req cmd:ping)
            ab:bc[a]:ac<msg(type:req cmd:ping)`);
          t('!abc<msg(type:req cmd:ping)', `bc[a!]:ac<msg(type:req cmd:ping)
            ab:bc[a!]:ac<msg(type:req cmd:ping)`);
          t('abc.def<msg(type:req cmd:ping)', `ef[d]:af<msg(type:req cmd:ping)
              de:ef[d]:af<msg(type:req cmd:ping)
              cd[ab]:de:ef[d]:af<msg(type:req cmd:ping)
              bc[a]:cd[ab]:de:ef[d]:af<msg(type:req cmd:ping)
              ab:bc[a]:cd[ab]:de:ef[d]:af<msg(type:req cmd:ping)`);
          t('!abc.def<msg(type:req cmd:ping)', `
              ef[d]:af<msg(type:req cmd:ping)
              de:ef[d]:af<msg(type:req cmd:ping)
              cd[ab!]:de:ef[d]:af<msg(type:req cmd:ping)
              bc[a!]:cd[ab!]:de:ef[d]:af<msg(type:req cmd:ping)
              ab:bc[a!]:cd[ab!]:de:ef[d]:af<msg(type:req cmd:ping)`);
          t('abc.!def<msg(type:req cmd:ping)', `
              ef[d!]:af<msg(type:req cmd:ping)
              de:ef[d!]:af<msg(type:req cmd:ping)
              cd[ab]:de:ef[d!]:af<msg(type:req cmd:ping)
              bc[a]:cd[ab]:de:ef[d!]:af<msg(type:req cmd:ping)
              ab:bc[a]:cd[ab]:de:ef[d!]:af<msg(type:req cmd:ping)`);
          t('!abc.!def<msg(type:req cmd:ping)', `
              ef[d!]:af<msg(type:req cmd:ping)
              de:ef[d!]:af<msg(type:req cmd:ping)
              cd[ab!]:de:ef[d!]:af<msg(type:req cmd:ping)
              bc[a!]:cd[ab!]:de:ef[d!]:af<msg(type:req cmd:ping)
              ab:bc[a!]:cd[ab!]:de:ef[d!]:af<msg(type:req cmd:ping)`);
          t('ab[cd].e>msg(type:req cmd:ping)', `
            ab[cd]:ae>msg(type:req cmd:ping)
            be:ab[cd]:ae>msg(type:req cmd:ping)`);
          t('abc[def].ef>msg(type:req cmd:ping)', `
            ab[cdef]:af>msg(type:req cmd:ping)
            bc[def]:ab[cdef]:af>msg(type:req cmd:ping)
            ce[f]:bc[def]:ab[cdef]:af>msg(type:req cmd:ping)
            ef:ce[f]:bc[def]:ab[cdef]:af>msg(type:req cmd:ping)`);
          if (0) // XXX: fixme
          t('fe.cba[fed]<msg(type:req cmd:ping)', `
            fa:ba[fedc]<msg(type:req cmd:ping)
            fa:ba[fedc]:cd[fed]<msg(type:req cmd:ping)
            fa:ba[fedc]:cd[fed]:ec[f]<msg(type:req cmd:ping)
            fa:ba[fedc]:cd[fed]:ec[f]:fe<msg(type:req cmd:ping)`);
          t('ab{c-d}:ef>msg(type:req cmd:ping)',
            `ab>fwd(ef>msg(type:req cmd:ping) range:c-d)`);
          t('ab{c-d,vv}:ef>msg(type:req cmd:ping)',
            `ab>fwd(ef>msg(type:req cmd:ping) range:c-d vv)`);
        });
        describe('req', function(){
          t('ab>req(id:1)', `ab>msg(type:req id:1)`);
          t('ab>req_start(id:1)', `ab>msg(type:req_start id:1)`);
          t('abc>req_start(id:1)', `abc>msg(type:req_start id:1)`);
          t('bc:ab>req_start(id:1)', `bc:ab>msg(type:req_start id:1)`);
          t('ab>req_start(id:1.2 cmd:test body:123)',
            `ab>msg(type:req_start id:1 seq:2 cmd:test body:123)`);
          t('ab>req_next', `ab>msg(type:req_next)`);
          t('abc>req_next', `abc>msg(type:req_next)`);
          t('bc:ab>req_next', `bc:ab>msg(type:req_next)`);
          t('ab>req_end', `ab>msg(type:req_end)`);
          t('abc>req_end', `abc>msg(type:req_end)`);
          t('bc:ab>req_end', `bc:ab>msg(type:req_end)`);
          t('abc>!req', `ac>!req(!!) abc>msg(type:req) ac>*req`);
          t('abc>!req(rt:bc)', `ac>!req(rt:bc !!) abc>msg(type:req) ac>*req`);
        });
        describe('res', function(){
          t('ab>res(id:1)', `ab>msg(type:res id:1)`);
          t('ab>res_start(id:1)', `ab>msg(type:res_start id:1)`);
          t('abc>res_start(id:1)', `abc>msg(type:res_start id:1)`);
          t('bc:ab>res_start(id:1)', `bc:ab>msg(type:res_start id:1)`);
          t('ab>res_start(id:1.2 cmd:test body:123)',
            `ab>msg(type:res_start id:1 seq:2 cmd:test body:123)`);
          t('ab>res_next', `ab>msg(type:res_next)`);
          t('abc>res_next', `abc>msg(type:res_next)`);
          t('bc:ab>res_next', `bc:ab>msg(type:res_next)`);
          t('ab>res_end', `ab>msg(type:res_end)`);
          t('abc>res_end', `abc>msg(type:res_end)`);
          t('bc:ab>res_end', `bc:ab>msg(type:res_end)`);
          t('abc>!res', `ac>!res(!!) abc>msg(type:res) ac>*res`);
        });
        describe('ping', function(){
          t('ab>*ping_r', `ab>*res(cmd:ping)`);
          t('ab>ping_r', `ab>msg(type:res cmd:ping)`);
          t('abc>ping_r', `abc>msg(type:res cmd:ping)`);
          t('ab>*ping', `ab>*req(cmd:ping)`);
          t('ab>ping', `ab>msg(type:req cmd:ping)`);
          t('abc>ping', `abc>msg(type:req cmd:ping)`);
          t('abc>ping', `abc>msg(type:req cmd:ping)`);
          t('abc<ping', `cba>msg(type:req cmd:ping)`);
          t('!abc>ping', `!abc>msg(type:req cmd:ping)`);
          t('!abc<ping', `!cba>msg(type:req cmd:ping)`);
          t('!abc.def>ping', `
            !abc.def>msg(type:req cmd:ping)`);
          t('abc.!def>ping', `abc.!def>msg(type:req cmd:ping)`);
          t('!abc.!def>ping', `!abc.!def>msg(type:req cmd:ping)`);
          t('abc.def<ping', `fed.cba>msg(type:req cmd:ping)`);
          t('abc.!def<ping', `!fed.cba>msg(type:req cmd:ping)`);
          t('!abc.def<ping', `fed.!cba>msg(type:req cmd:ping)`);
          t('!abc.!def<ping', `!fed.!cba>msg(type:req cmd:ping)`);
          t('bc[defg].g>ping', `bc[defg]:bg>msg(type:req cmd:ping)
            cg:bc[defg]:bg>msg(type:req cmd:ping)`);
          t('ab>!ping(!!)', `ab>!ping(!!)`);
          t('ab>!ping', `ab>!ping(!!) ab>ping ab>*ping ab<ping_r ab<*ping_r`);
          t('conf(auto_time rtt:200) ab>!ping', `conf(auto_time rtt:200)
            ab>!ping(!!) ab>ping ab>*ping ab<ping_r ab<*ping_r`);
          t('conf(!auto_time rtt:200) ab>!ping', `conf(!auto_time rtt:200)
            ab>!ping(!!) ab>ping 100ms ab>*ping ab<ping_r 100ms ab<*ping_r`);
          t('abc>!ping', `ac>!ping(!!) abc>ping ac>*ping abc<ping_r
            ac<*ping_r`);
          t('abc>!ping(rt:d)',
            `ac>!ping(!! rt(d)) abc>ping ac>*ping abc<ping_r ac<*ping_r`);
          t('!abc>!ping(rt:!bc)', `ac>!ping(!! rt(!bc)) !abc>ping ac>*ping
            abc<ping_r ac<*ping_r`);
          t('abc<!ping(rt:cd!)', `ca>!ping(!! rt(!dc)) cba>ping ac<*ping
            abc>ping_r ac>*ping_r`);
          t('abc[def].ef>!ping', `af>!ping(!!) abc[def].ef>ping af>*ping
            abcef<ping_r af<*ping_r`);
          t('bc[defg].g>!ping(rt(cdefg))', `bg>!ping(!! rt(cdefg))
            bc[defg].g>ping bg>*ping bcg<ping_r bg<*ping_r`);
          T('abc>!ping', `ac>!ping(!!)
            ab>fwd(ac>msg(type(req) cmd(ping)) rt(c))
            bc>fwd(ab>fwd(ac>msg(type(req) cmd(ping)) rt(c)))
            ac>*req(cmd(ping))
            cb>fwd(ca>msg(type(res) cmd(ping)) rt(a))
            ba>fwd(cb>fwd(ca>msg(type(res) cmd(ping)) rt(a)))
            ac<*res(cmd(ping))`);
          t('ab[c]:ac>ping_r(id:1.0)',
            `ab[c]:ac>msg(id:1.0 type:res cmd:ping)`);
          t('ab[c]:ac>ping(id:1.0)', `ab[c]:ac>msg(id:1.0 type:req cmd:ping)`);
          t('abc>!ping', `ac>!ping(!!) abc>ping ac>*ping abc<ping_r
            ac<*ping_r`);
          t('abc>!ping(rt:bc)', `ac>!ping(!! rt(bc)) abc>ping ac>*ping
            abc<ping_r ac<*ping_r`);
          t('conf(auto_time rtt:200) abc>!ping', `conf(auto_time rtt:200)
            ac>!ping(!!) abc>ping ac>*ping abc<ping_r ac<*ping_r`);
          t('conf(!auto_time rtt:200) abc>!ping', `conf(!auto_time rtt:200)
            ac>!ping(!!) ab[c]:ac>ping 100ms bc:ab[c]:ac>ping 100ms ac>*ping
            bc[a]:ac<ping_r 100ms ab:bc[a]:ac<ping_r 100ms ac<*ping_r`);
        });
        describe('ring_join', function(){
          t('bX.a~b>ring_join(!! !r)', `bX{X-X}:b~b>msg(type:req cmd:ring_join)
             Xa{a-X}:bX{X-X}:b~b>msg(type:req cmd:ring_join)`);
          t('p.Xno~p>fwd(p~p>msg)', `pX[no]:p~p>msg Xn[o]:pX[no]:p~p>msg
            no{o-o}:Xn[o]:pX[no]:p~p>msg`);
          t('p.Xno.abcd~p>fwd(p~p>msg)', `pX[no]:p~p>msg Xn[o]:pX[no]:p~p>msg
            no{o-o}:Xn[o]:pX[no]:p~p>msg oa[bcd]:no{o-o}:Xn[o]:pX[no]:p~p>msg
            ab[cd]:oa[bcd]:no{o-o}:Xn[o]:pX[no]:p~p>msg
            bc[d]:ab[cd]:oa[bcd]:no{o-o}:Xn[o]:pX[no]:p~p>msg
            cd{o-d}:bc[d]:ab[cd]:oa[bcd]:no{o-o}:Xn[o]:pX[no]:p~p>msg`);
          t('a~b>!ring_join', `a~b>!ring_join`);
          t('~ab<!ring_join', `~ab<!ring_join`);
          t('pX.n.o.a~p>!ring_join', `p~p>!ring_join
            pX{X-X}:p~p>msg(type:req cmd:ring_join)
            Xn{n-X}:pX{X-X}:p~p>msg(type:req cmd:ring_join)
            no{o-X}:Xn{n-X}:pX{X-X}:p~p>msg(type:req cmd:ring_join)
            oa{o-a}:no{o-X}:Xn{n-X}:pX{X-X}:p~p>msg(type:req cmd:ring_join)
            pa>*ring_join ao[nXp]:ap>msg(type:res cmd:ring_join)
            on[Xp]:ao[nXp]:ap>msg(type:res cmd:ring_join)
            nX[p]:on[Xp]:ao[nXp]:ap>msg(type:res cmd:ring_join)
            Xp:nX[p]:on[Xp]:ao[nXp]:ap>msg(type:res cmd:ring_join)
            pa<*ring_join_r`);
          t('ab.c~d>!ring_join', `a~d>!ring_join
            ab.c~d>fwd(a~d>msg(type:req cmd:ring_join))
            ac>*ring_join cba>fwd(ca>msg(type:res cmd:ring_join))
            ac<*ring_join_r`);
          t('ab.c~d>msg(type:req cmd:ring_join)',
            `ab.c~d>fwd(a~d>msg(type:req cmd:ring_join))`);
          t('~dc.ba<msg(type:req cmd:ring_join)',
            `~dc.ba<fwd(~da<msg(type:req cmd:ring_join))`);
          t('ab>ring_join_r', `ab>msg(type:res cmd:ring_join)`);
          t('ab.c~d>ring_join(!! !r)', `ab.c~d>msg(type:req cmd:ring_join)`);
          t('ab.c~d>ring_join(!! !r)', `ab{b-b}:a~d>msg(type:req cmd:ring_join)
            bc{c-b}:ab{b-b}:a~d>msg(type:req cmd:ring_join)`);
          t('ab.c>ring_join_r', `ab.c>msg(type:res cmd:ring_join)`);
          t('ab~d>ring_join(!! !r)',
            `ab{b-b}:a~d>msg(type:req cmd:ring_join)`);
          t('ab.c>ring_join_r', `ab.c>msg(type:res cmd:ring_join)`);
          t('ab~c>!ring_join', `a~c>!ring_join
            ab{b-b}:a~c>msg(type:req cmd:ring_join) ab>*ring_join
            ba>ring_join_r ab<*ring_join_r`);
          t('ab~c>!ring_join(!!)', `a~c>!ring_join
            ab{b-b}:a~c>msg(type:req cmd:ring_join) ba>ring_join_r`);
          t('ab~c>!ring_join(!r)', `a~c>!ring_join
            ab{b-b}:a~c>msg(type:req cmd:ring_join) ab>*ring_join`);
          if (0) // XXX: TODO
          t('ab.c>fwd(ac>ring_join_r)', `ab.c>ring_join_r`);
        });
        describe('test', ()=>{
          t('#ms', `test(ms)`);
          t('#1ms', `test(1ms)`);
          t('a#ac>opening(id:>1.1)', `a>test(ac>opening(id:>1.1))`);
          t('a#ab[c]:ac>opening(id:>1.1)',
            `a>test(ab[c]:ac>opening(id:>1.1))`);
          t('a,b#ac>opening(id:>1.1)', `a>test(ac>opening(id:>1.1))
            b>test(ac>opening(id:>1.1))`);
          t('a#ac>open(>1.0vv !id(<1.0))',
          `a>test(ac>open(>1.0vv !id(<1.0)))`);
          t('a#ac>open(>1.0vv !id:<1.0)', `a>test(ac>open(>1.0vv !id:<1.0))`);
        });
      });
    });
  });
  const xit = (name, role, test)=>it(name+'_'+role, ()=>test_run(role, test));
  // XXX TODO:
  // - check etask error handling of unchaught errors
  // - add test for failures (missing events, event mismatch etc)
  // - test.js code cleaup
  // - process init/unchaught handling
  // - random id -> priv/pub key (copy hypercore)
  //   - do we want to add cksm and sign it on each message
  //   - need to verify idendity of each other when direct connection created
  // - ack on each message
  // - add beep sound to ping script
  const t_roles = (name, roles, test)=>etask(function*t_roles(){
    assert(test);
    assert(roles);
    for (let i=0; i<roles.length; i++)
      yield xit(name, roles[i], test);
  });
  describe('node_conn', ()=>{
    let t = (name, test)=>t_roles(name, 'X', test);
    t('direct', `conf(id:a-mXYZn-z rtt(50 aX:10)) test_node_conn(X)
      Xa>!connect test_node_conn(X(a:10) a(X:10))
      Xb<!connect test_node_conn(X(a:10 b:50) a(X:10) b(X:50))
      Xy>!connect test_node_conn(X(a:10 b:50 y:50) a(X:10) b(X:50) y(X:50))
      Xz<!connect test_node_conn(X(a:10 b:50 y:50 z:50) a(X:10) b(X:50) y(X:50)
        z(X:50))`);
    t('from_fwd', ` conf(id:a-mXYZn-z rtt(ab:10 bc:20 db:30 zY:40))
      test_node_conn(X) aX>!connect test_node_conn(X(a:100) a(X:100))
      aX:ba:cb:cY>req test_node_conn(X(a:100) a(b:10 X:100) b(a:10 c:20)
        c(b:20))
      aX:ba:db:dY>req test_node_conn(X(a:100) a(b:10 X:100)
        b(a:10 c:20 d:30) c(b:20) d(b:30))
      zX>!connect test_node_conn(X(a:100 z:100) a(b:10 X:100) b(a:10 c:20 d:30)
        c(b:20) d(b:30) z(X:100))
      // XXX TODO: zX:Yz:Yc,Xa:zX:Yz:Yc>req
      zX:Yz:Yc>req Xa[bc]:zX:Yz:Yc>req
      test_node_conn(X(a:100 z:100) a(b:10 X:100) b(a:10 c:20 d:30) c(b:20)
        d(b:30) Y(z:40) z(X:100 Y:40)) `);
  });
  describe('node_map', ()=>{
    let t = (name, test)=>t_roles(name, 'X', test);
    t('find', `conf(id(a:0.1 b:0.2 X:0.25 c:0.3 d:0.4)) Xa,Xb,Xc,Xd>!connect
      test_node_find(X:0 next:a prev:d)
      test_node_find(X:0.09 next:a prev:d)
      test_node_find(X:0.1 next:b prev:d)
      test_node_find(X:0.19 next:b prev:a)
      test_node_find(X:0.2 next:c prev:a)
      test_node_find(X:0.21 next:c prev:b)
      test_node_find(X:0.25 next:c prev:b)
      test_node_find(X:0.29 next:c prev:b)
      test_node_find(X:0.3 next:d prev:b)
      test_node_find(X:0.39 next:d prev:c)
      test_node_find(X:0.4 next:a prev:c)
      test_node_find(X:0.49 next:a prev:d)
      test_node_find(X:0.24 next:c prev:b bidi:b)
      test_node_find(X:0.25 next:c prev:b bidi:b)
      test_node_find(X:0.26 next:c prev:b bidi:c)
      test_node_find(X:0.41 next:a prev:d bidi:d)
      test_node_find(X:0.91 next:a prev:d bidi:a)`);
    it('next_prev', ()=>{
      const t = (val, exp)=>assert.equal(val, exp);
      let node_map = new NodeMap(NodeId.from(0.44));
      let n1 = node_map.get({id: NodeId.from(0.43), create: true});
      let n2 = node_map.get({id: NodeId.from(0.42), create: true});
      let n3 = node_map.get({id: NodeId.from(0.41), create: true});
      t(n1.next(), n3);
      t(n2.next(), n1);
      t(n3.next(), n2);
      t(n1.prev(), n2);
      t(n2.prev(), n3);
      t(n3.prev(), n1);
    });
    it('node_itr', ()=>{
      const _t = (s, d, peers, exclude, range, exp)=>{
        let map = new NodeMap(NodeId.from(s));
        peers.split(' ')
        .forEach(p=>map.get({id: NodeId.from(p), create: true}));
        let itr = map.node_itr(NodeId.from(d),
          {exclude: exclude && NodeId.from(exclude),
          range: range && {min: NodeId.from(range[0]),
          max: NodeId.from(range[1])}});
        exp.split(' ').forEach(e=>{
          let n = itr.next();
          assert.equal(n && n.id.d, e ? NodeId.from(e).d : null);
        });
        let n = itr.next();
        assert.equal(n && n.id.d, null);
      };
      const t = (opt, exp)=>{
        _t('.1', opt.d, opt.peers, opt.exclude, opt.range, exp);
        _t('.5', opt.d, opt.peers, opt.exclude, opt.range, exp);
        _t('.9', opt.d, opt.peers, opt.exclude, opt.range, exp);
      };
      t({d: '.09', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.1 .2 .9 .3 .8 .4 .7 .5 .6');
      t({d: '.1', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.1 .2 .3 .9 .8 .4 .5 .7 .6');
      t({d: '.11', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.1 .2 .3 .9 .4 .8 .5 .7 .6');
      t({d: '.51', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.5 .6 .4 .7 .3 .8 .2 .9 .1');
      t({d: '.49', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.5 .4 .6 .3 .7 .2 .8 .1 .9');
      t({d: '.89', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.9 .8 .7 .1 .6 .2 .5 .3 .4');
      t({d: '.9', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.9 .8 .7 .1 .6 .2 .5 .3 .4');
      t({d: '.91', peers: '.1 .2 .3 .4 .5 .6 .7 .8 .9'},
        '.9 .8 .1 .7 .2 .6 .3 .5 .4');
      t({d: '.429', peers: '.1 .4 .41 .42 .43 .5 .9 .99'},
        '.43 .42 .41 .4 .5 .1 .99 .9');
      // aXY -> abXY~b a:0.1 b:0.2 X:0.5 Y:0.51
      // at b [any] !b
      // at a (a-a) !b
      // at X (a-X) !b
      // at b:.2
      t({d: '.2', peers: '.1'}, '.1');
      // at a:.1
      t({d: '.2', peers: '.5 .51', range: ['.1', '.1']}, '.5 .51');
      // at X:.5
      t({d: '.2', peers: '.1 .51', range: ['.1', '.5']}, '');
      // at X:.5
      // abXno~p a:0.05 b:0.1 X:0.5 n:0.55 o:0.6 p:0.65
      // at p: [any] !p [any]
      // at X: [X+1, X-1] !p (X,X)
      // at n: [n+1, X-1] !p (n,X)
      // at o: [o+1, X-1] !p (o,X)
      // at a: [o+1, a-1] !p (o,a): p is not in range - so END
      // at p:.65
      t({d: '.65', peers: '.5 .65'}, '.65 .5');
      t({d: '.65', peers: '.5 .65', exclude: '.65'}, '.5');
      t({d: '.65', peers: '.5 .65', exclude: '.5'}, '.65');
      // at X:.5
      t({d: '.65', peers: '.05 .55 .65'}, '.65 .55 .05');
      t({d: '.65', peers: '.05 .55 .65', exclude: '.65'}, '.55 .05');
      t({d: '.65', peers: '.05 .55 .65', range: ['.5', '.5']},
        '.65 .55 .05');
      t({d: '.65', peers: '.05 .55 .65', exclude: '.65',
        range: ['.5', '.5']}, '.55 .05');
      // at n:.55
      t({d: '.65', peers: '.5 .55 .6'}, '.6 .55 .5');
      t({d: '.65', peers: '.5 .55 .6', exclude: '.55'}, '.6 .5');
      t({d: '.65', peers: '.5 .55 .6', range: ['.55', '.5']}, '.6');
      // at o:.6
      t({d: '.65', peers: '.05 .55 .6'}, '.6 .55 .05');
      t({d: '.65', peers: '.05 .55 .6', exclude: '.6'}, '.55 .05');
      t({d: '.65', peers: '.05 .55 .6', range: ['.6', '.5']}, '.05');
      t({d: '.65', peers: '.05 .55 .6', exclude: '.6', range: ['.6', '.5']},
         '.05');
      // at a:.05
      t({d: '.65', peers: '.05 0.1 .6'}, '.6 .05 .1');
      t({d: '.65', peers: '.05 0.1 .6', exclude: '.65'}, '.6 .05 .1');
      t({d: '.65', peers: '.05 0.1 .6', range: ['.6', '.05']}, '');
    });
    describe('graph', ()=>{
      // XXX why we need !msg_delay
      t('basic', `conf(!msg_delay id:a-mXYZn-z rtt(100 zX:500)) aX>!connect
        999ms test_node_graph(X aX:100) 1ms test_node_graph(X aX:100)
        aX:ba:bX>req test_node_graph(X aX:100 baX:200)
        1s test_node_graph(X aX:100 baX:200)
        aX:ba:cb:cX>req test_node_graph(X aX:100 baX:200 cbaX:300)
        1s test_node_graph(X aX:100 baX:200 cbaX:300)
        aX:ca:cX>req test_node_graph(X aX:100 baX:200 caX:200)
        1s test_node_graph(X aX:100 baX:200 caX:200)
        zX>!connect test_node_graph(X aX:100 baX:200 caX:200 zX:500)
        1s test_node_graph(X aX:100 baX:200 caX:200 zX:500)
        aX:za:zX>req test_node_graph(X aX:100 baX:200 caX:200 zaX:200)
        1s test_node_graph(X aX:100 baX:200 caX:200 zaX:200)
      `);
      t('ring', `conf(id(a:0.1 b:0.2 X:0.3 c:0.4 d:0.5 e:0.6))
        ab,bX,Xc,cd,da,eX>!connect test_node_graph(X bX:100 cX:100 eX:100)
        1s test_node_graph(X bX:100 cX:100 eX:100) eX.c.d>!ping
        test_node_graph(X bX:100 cX:100 eX:100 dcX:200)
        1s test_node_graph(X bX:100 cX:100 eX:100 dcX:200)
        cX[e]:dc[Xe]:ad[cXe]:ae>msg(type:res body:ping_r)
        Xe:cX[e]:dc[Xe]:ad[cXe]:ae>msg(type:res body:ping_r)
        test_node_graph(X bX:100 cX:100 eX:100 dcX:200 adcX:300)
        1s test_node_graph(X bX:100 cX:100 eX:100 dcX:200 adcX:300)
        cX:dc:ad:ca:ac:aX>req
        test_node_graph(X bX:100 cX:100 eX:100 dcX:200 acX:200)
        !sp test_node_graph(X bX:100 cX:100 eX:100 dcX:200 acX:200)`);
      });
  });
  describe('router', ()=>{
    describe('connect', ()=>{
      let t = (name, test)=>t_roles(name, 'ab', test);
      t('2_nodes_long', `a=node(id:10) b=node(id:20 wss) - ab>!connect:!!
        ab>msg(type:req cmd:connect) + ab<msg(type:req cmd:connect)
        ab<ack + ab>ack`);
      t('2_nodes_short', `a=node(id:10) b=node(id:20 wss) - ab>!connect`);
      t('connect_no_msg_delay_manual_time', `conf(!msg_delay !auto_time)
        a=node(id:10 wss) b=node(id:20 wss) ab>!connect(!!)
        ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect) ab>ack
        ab<ack`);
      t('connect_no_msg_delay_auto_time', `conf(!msg_delay)
        a=node(id:10 wss) b=node(id:20 wss) ab>!connect(!!)
        ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect) ab>ack
        ab<ack`);
      t('connect_manual_time', `conf(!auto_time rtt:200)
        a=node(id:10 wss) b=node(id:20 wss) ab>!connect(!!)
        ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect) 100ms
        ab>ack ab<ack 100ms a#rtt(b:200) b#rtt(a:200)`);
      t('connect_auto_time', `conf(auto_time rtt:200)
        a=node(id:10 wss) b=node(id:20 wss) ab>!connect(!!) #ms
        ab>msg(type:req cmd:connect) + ab<msg(type:req cmd:connect) #100ms
        ab>ack + ab<ack #100ms a#rtt(b:200) b#rtt(a:200)`);
    });
    describe('ping', ()=>{
      let t = (name, test)=>t_roles(name, 'ab', test);
      t('2_nodes_raw', `
        setup:2_nodes ab>!req(cmd:ping !!)
        ab>msg(type:req cmd:ping) ab>*req(cmd:ping)
        ab<msg(type:res cmd:ping) ab<*res(cmd:ping)`);
      t('2_nodes_long', `setup:2_nodes ab>!ping(!!) ab>ping
        ab>*ping ab<ping_r ab<*ping_r`);
      t('2_nodes_short', `setup:2_nodes ab>!ping`);
      t('2_nodes_wss', `a,b=node:wss ab>!connect ab>!ping`);
      t = (name, test)=>t_roles(name, 'abc', test);
      t('3_nodes', `conf(id:a-mXYZn-z) !ring(a-c) !abc>!ping(rt:!bc)`);
      t = (name, test)=>t_roles(name, 'abcd', test);
      t('4_nodes_raw', `conf(id:a-mXYZn-z) !ring(a-d) ab.c>!ping abc>!ping
        ac>!ping(!! rt:!bc) ab[!c]:ac>msg(type:req cmd:ping)
        bc:ab[!c]:ac>msg(type:req cmd:ping) ac>*ping
        cb[a]:ca>msg(type:res cmd:ping) ba:cb[a]:ca>msg(type:res cmd:ping)
        ca>*ping_r ac>!ping(!! rt:!dc) ad[!c]:ac>msg(type:req cmd:ping)
        dc:ad[!c]:ac>msg(type:req cmd:ping) ac>*ping
        cd[a]:ca>msg(type:res cmd:ping) da:cd[a]:ca>msg(type:res cmd:ping)
        ca>*ping_r`);
       t('4_nodes_exact', `conf(id:a-mXYZn-z) !ring(a-d) !abc>!ping(rt:!bc)`);
    });
    describe('by_id', ()=>{
      let t = (name, test)=>t_roles(name, 'abc', test);
      t('3_nodes', `a,b,c=node:wss ab,ac>!connect ab>!ping ac>!ping`);
      t('3_nodes_route_b', `conf(id(a:10 b:20 c:30 d:21 e:31))
        ab,ac>!connect ad>!req(id:1 body:ping !!)
        ab>fwd(ad>msg(id:1 type:req body:ping)) -
        19950ms a>*fail(id:1 error:timeout)`);
      t('3_nodes_route_c', `conf(id(a:10 b:20 c:30 d:21 e:31))
        ab,ac>!connect ae>!req(id:1 body:ping !!)
        ac:ae>req(body:ping) - 19950ms a>*fail(id:1 error:timeout)`);
      t('3_nodes_ring', `conf(id(a:10 b:20 c:30)) !ring(a-c)
        ab>!ping ac>!ping -`);
      t('3_nodes_no_exit', `conf(a-c) ab>!connect bc>!connect ac>!req(!!)
        20s a>*fail(error:timeout)`);
      t = (name, test)=>t_roles(name, 'abcd', test);
      // XXX: check why if we change to ping it fails (req tracking bug)
      t('4_nodes_ring', `conf(id(a:10 b:20 c:30 d:40)) !ring(a-d) -
        ab>!ping 60s ab.c>!ping 60s ad>!ping 60s ba>!ping 60s bc>!ping 60s
        bc.d>!ping 60s cba>!ping 60s cb>!ping 60s cd>!ping 60s da>!ping
        60s dcb>!ping 60s dc>!ping 60s bcd>!ping dcb>!ping 60s dcb>!ping`);
      t('4_nodes_ring_rt', `conf(id(a:10 b:20 c:30 d:40))
        rt_add(a:dc b:ad c:da d:cb) !ring(a-d) - ab>!ping 60s
        adc>!ping 60s ad>!ping 60s ba>!ping 60s bc>!ping 60s bad>!ping 60s
        cda>!ping 60s cb>!ping 60s cd>!ping 60s da>!ping 60s dcb>!ping 60s
        dc>!ping`);
      t = (name, test)=>t_roles(name, 'abcde', test);
      t('5_nodes_ring', `conf(id(a:10 b:20 c:30 d:40 e:50))
        !ring(a-e) ae.d>!ping 59s - aed<!ping 60s - aed<!ping 60s`);
      t = (name, test)=>t_roles(name, 'abXz', test);
      t('best_path_circula1', `
        conf(id:a-mXYZn-z rtt(100 Xb:110)) ab,bX,Xz,za>!connect Xb.a>!ping`);
      t('best_path_circular2', `
         conf(id:a-mXYZn-z rtt(100 Xb:111)) ab,bX,Xz,za>!connect Xz.a>!ping`);
    });
    describe('rtt', ()=>{
      let t = (name, test)=>t_roles(name, 'abcdef', test);
      t('never_try_bigger_id', `conf(id:a-mXYZn-z rtt(2 de:999)) !ring(a-f)
        de.f>!ping`);
      t = (name, test)=>t_roles(name, 'abcdefghi', test);
      t('all_the_same', `conf(id:a-mXYZn-z) !ring(a-i) bc.d.e.f.g>!ping
        bcdefg>!ping !baihg>!ping(rt:!aihg) baihg>!ping(rt:aihg)
        baihg>!ping !bcdefg>!ping(rt:!cdefg) baihg>!ping
        !bcdefg>!ping(rt:!cdefg) baihg>!ping(rt:cdefg)`);
      t('shortcut', `conf(id:a-mXYZn-z) !ring(a-i) bc.d.e.f.g>!ping
        bcdefg>!ping cg>!connect !bcdefg>!ping(rt:!cdefg)
        bc[defg].g>!ping(rt:cdefg) bcg>!ping(rt:cdefg)`);
      t = (name, test)=>t_roles(name, 'abcdefghijkl', test);
      // XXX: check why test fail with msg_delay
      t('shortcut2', `conf(!msg_delay id:a-mXYZn-z rtt:100) !ring(a-l)
        bc.d.e.f.g.h.i.j.k>!ping bcdefghijk>!ping
        // create shortcut fa
        fa>!connect !falk>!ping(rt:!alk) bcdef[ghijk].alk>!ping bcdefalk>!ping
        // reduce rtt to minimum possible to keep using shortcut fa
        conf(rtt(fg:50 gh:50 ij:50 jk:50)) !kjihgf>!ping(rt:!jihgf)
        bcdefalk>!ping
        // reduce rtt so using shortcut fa takes longer
        conf(rtt(fg:49 gh:49 ij:49 jk:49)) !kjihgf>!ping(rt:!jihgf)
        bcdef[alk].ghijk>!ping bcdefghijk>!ping`);
      // XXX: check why test fail with msg_delay
      t('shortcut3', `conf(!msg_delay id:a-mXYZn-z rtt(100 ba:500)) !ring(a-l)
        bc.d.e.f.g.h.i.j.k>!ping bcdefghijk>!ping
        // create shortcut fa
        fa>!connect !falk>!ping(rt:!alk) bcdef[ghijk].alk>!ping bcdefalk>!ping
        // reduce rtt so using shortcut fa takes longer
        conf(rtt(gh:2 ij:2 jk:2)) !balkjihg>!ping(rt:!alkjihg) bcdefalk>!ping
        // verify path rtt of path is sent so f will not use fa as shortcut
        !sp // XXX: f needs to rebuild path to know there is better path now
        bcdefghijk>!ping`);
      t = (name, test)=>t_roles(name, 'abc', test);
      t('shortcut_connect', `conf(id:a-mXYZn-z rtt(2 ac:999))
        !ring(a-c)`);
      t = (name, test)=>t_roles(name, 'abcd', test);
      t('shortcut_connect2', `conf(id:a-mXYZn-z rtt(2 ad:999))
        !ring(a-d)`);
      t = (name, test)=>t_roles(name, 'abcde', test);
      t('shortcut_connect3', `conf(id:a-mXYZn-z rtt(2 ad:999))
        !ring(a-e da)`);
    });
  });
  describe('ring_join', ()=>{
    let t = (name, test)=>t_roles(name, 'abcdef', test);
    t('basic', `conf(id:a-mXYZn-z) !ring(a-f) ed.c.b.a.f~e>!ring_join`);
    t = (name, test)=>t_roles(name, 'abXYnopz', test);
    t('ring_long:abXno~p', `conf(id:a-mXYZn-z)
      ab,bX,Xn,no,oa,pX>!connect p~p>!ring_join
      pX{X-X}:p~p>msg(type:req cmd:ring_join)
      Xn{n-X}:pX{X-X}:p~p>msg(type:req cmd:ring_join)
      no{o-X}:Xn{n-X}:pX{X-X}:p~p>msg(type:req cmd:ring_join)
      oa{o-a}:no{o-X}:Xn{n-X}:pX{X-X}:p~p>msg(type:req cmd:ring_join)
      pa>*ring_join ao[nXp]:ap>msg(type:res cmd:ring_join)
      on[Xp]:ao[nXp]:ap>msg(type:res cmd:ring_join)
      nX[p]:on[Xp]:ao[nXp]:ap>msg(type:res cmd:ring_join)
      Xp:nX[p]:on[Xp]:ao[nXp]:ap>msg(type:res cmd:ring_join) ap>*ring_join_r`);
    t('ring_short:abXnop~p,pX>!connect', `conf(id:a-mXYZn-z)
      ab,bX,Xn,no,oa,pX>!connect pX.n.o.a~p>!ring_join`);
    t('ring_short:rtt_ok', `conf(id:a-mXYZn-z rtt(100 oa:223))
      ab,bX,Xn,no,oa,ob,pX>!connect pX.n.o.a~p>!ring_join`);
    t('ring_short:rtt_slow', `conf(id:a-mXYZn-z rtt(100 oa:224))
      ab,bX,Xn,no,oa,ob,pX>!connect pX.n.o.b.a~p>!ring_join`);
    t('ring_short:abXnop~p,po>!connect', `conf(id:a-mXYZn-z)
      ab,bX,Xn,no,oa,po>!connect po.n.X.b.a~p>!ring_join`);
    t('ring_step_by_step:abXnop~p', `conf(id:a-mXYZn-z)
      aX>!connect // XXX: fixme aX~X>!ring_join
      bX>!connect bX.a~b>!ring_join nX>!connect nX.b.Xa~n>!ring_join
      oX>!connect oX.n.Xa~o>!ring_join pX>!connect pX.o.Xa~p>!ring_join`);
    t('ring_step_by_step2:abXnop~p', `conf(id:a-mXYZn-z)
      aX>!connect // XXX: fixme aX~X>!ring_join
      bX>!connect bX.a~b>!ring_join nX>!connect nX.b.Xa~n>!ring_join !sp
      oX>!connect oX.n.Xa~o>!ring_join !sp pX>!connect pX.o.Xa~p>!ring_join`);
    t('ring_step_by_step3:abXnop~p', `conf(id:a-mXYZn-z)
      aX>!connect // XXX: fixme aX~X>!ring_join
      bX>!connect bX.a~b>!ring_join nX>!connect nX.b.Xa~n>!ring_join
      oX>!connect oX.n.Xa~o>!ring_join !sp oX.n.Xa~o>!ring_join !sp
      pX>!connect pX.o.Xa~p>!ring_join`);
    t('star:abXnop~p', `conf(id:a-mXYZn-z)
      ab,bX,Xn,no,oa,aX,oX,pX>!connect pX.o.a~p>!ring_join`);
    t('ring:abXnoz~z', `conf(id:a-mXYZn-z)
      ab,bX,Xn,no,oa,zX>!connect zX.b.a.o~z>!ring_join`);
    t = (name, test)=>t_roles(name, 'abcd', test);
    t('ring_rtt_same', `conf(id:a-mXYZn-z rtt(100 ac:270))
      !ring(a-c) da>!connect da.c~d>!ring_join`);
    t('ring_rtt_slow', `conf(id:a-mXYZn-z rtt(100 ac:271))
      !ring(a-c) da>!connect da.b.c~d>!ring_join`);
    t = (name, test)=>t_roles(name, 'abcdef', test);
    t('shortcut_fast', `conf(id:a-mXYZn-z rtt(999 da:2)) !ring(a-f da)
      ed.a.f~e>!ring_join`);
    t('shortcut_slow', `conf(id:a-mXYZn-z rtt(2 da:999)) !ring(a-f da)
      ed.c.b.a.f~e>!ring_join`);
    t = (name, test)=>t_roles(name, 'abcdXY', test);
    t('multi_path_rtt_same', `conf(id:a-mXYZn-z rtt(100 Xa:140))
      XY,aX>!connect aX.Y~a>!ring_join bY>!connect bY.Xa.X~b>!ring_join
      dY>!connect dY.b.YX~d>!ring_join cX>!connect cX.a.XYb.Yd~c>!ring_join`);
    // XXX: check why test fail with msg_delay
    t('multi_path_rtt_slow', `conf(!msg_delay id:a-mXYZn-z rtt(100 Xa:141))
      XY,aX>!connect aX.Y~a>!ring_join bY>!connect bY.Xa.X~b>!ring_join
      dY>!connect dY.b.YX~d>!ring_join cX>!connect cX.Yb.Yd~c>!ring_join`);
    t = (name, test)=>t_roles(name, 'aXbY', test);
    // XXX: check why test fail with msg_delay
    t('best_path_circular', `conf(!msg_delay id:a-mXYZn-z rtt:100)
      aX,Xb,bY,Ya>!connect aX.b.Y~a>!ring_join bXa.X~b>!ring_join
      XbY.b~X>!ring_join YbX.b.Xa~Y>!ring_join aXb>!ping aYb>!ping(rt:Yb)
      !sp aXb>!ping conf(rtt(100 Yb:2)) aYb>!ping(rt:Yb) !sp aYb>!ping`);
    t = (name, test)=>t_roles(name, 'abcXY', test);
    t('best_path_multi', `conf(!msg_delay id:a-mXYZn-z rtt:100)
      aX,bX,cX>!connect aX.b~a>!ring_join bXa.X.c~b>!ring_join
      c.Xb.Xa.X~c>!ring_join cXa>!ping cXb>!ping !sp cXa>!ping
      cXb>!ping Ya,Yb>!connect Yb.X.a~Y>!ring_join Yb.Xc>!ping YbXc>!ping
      YaXc>!ping(rt:aXc) YbXc>!ping !sp YaXc>!ping conf(rtt(100 Yb:10)) !sp
      YaXc>!ping YbXc>!ping(rt:bXc) Yb.Xc>!ping(rt:aXc) !YaXc>!ping(rt:!aXc)
      Yb.Xc>!ping`);
    t = (name, test)=>t_roles(name, 'bcXY', test);
    t('sub_rtt_is_not_ignored', `conf(id:a-mXYZn-z rtt:1000)
      Yb,Xb>!connect Xb.Y~X>!ring_join cX>!connect cX.b~c>!ring_join
      Yb.Xc>!ping YbXc>!ping !sp YbXc>!ping conf(rtt(1000 Yb:2))
      YbXc>!ping !sp Yb.Xc>!ping`);
    t = (name, test)=>t_roles(name, 'abcdefghijklm', test);
    // XXX: check why test is slow without !msg_delay
    t('complex1', `conf(!msg_delay id:a-mXYZn-z) !ring(a-l)
      bc.d.e.f.g.h.i.j.k>!ping bcdefghijk>!ping
      fa>!connect !falk>!ping(rt:!alk) bcdef[ghijk].alk>!ping bcdefalk>!ping
      mf>!connect mf.al.afe.d.c.b.a~m>!ring_join
      mfal.k.j.i.h.g.f.e.d.c.b.a~m>!ring_join
      mfal.k.j.i.h.g.f.e.d.c.b.a~m>!ring_join`);
    // XXX: check why test is slow without !msg_delay
    t('complex2', `conf(!msg_delay id:a-mXYZn-z) !ring(a-l)
      bc.d.e.f.g.h.i.j.k>!ping bcdefghijk>!ping
      ab.c.d.e.f.g.h.i.j.k.l~a>!ring_join ba.bc~b>!ring_join
      cb.a.bcde.d~c>!ring_join dc.b.a.l.kjihgfe~d>!ring_join
      ed.c.b.a.l.kjihgf~e>!ring_join
      // l learned a better path for e, so let's check again d~d
      dc.b.a.l.abcde~d>!ring_join fe.d.c.b.a.l.kjihg~f>!ring_join
      gf.e.d.c.b.a.lkjih~g>!ring_join hg.f.e.d.c.b.a.l.kji~h>!ring_join
      ih.g.f.e.d.c.b.a.l.kj~i>!ring_join j.i.h.g.f.e.d.c.b.alk~j>!ring_join
      k.j.i.h.g.f.e.d.c.bal~k>!ring_join lk.j.i.h.g.f.e.d.c.b.a~l>!ring_join
      fa>!connect mf>!connect mf.e.dcbal.abcd.c.b.a~m>!ring_join
      mf.e.dcbal.abcd.c.b.a~m>!ring_join !falk>!ping(rt:!alk)
      mf.al.abcde.d.c.b.a~m>!ring_join mfal.k.j.i.h.g.f.e.d.c.b.a~m>!ring_join
      !sp mfal.k.j.i.h.g.f.e.d.c.b.a~m>!ring_join
      kc>!connect kc>!ping !sp conf(rtt(100 kc:19)) !kcb>!ping(rt:!cb)
      mfal.k.j.i.h.g.f.e.d.c.b.a~m>!ring_join conf(rtt(100 kc:18))
      !kcb>!ping(rt:!cb) mfal.k.c.b.a~m>!ring_join
    `);
     // XXX: test behavior when distance is very close
    describe('neighbour', ()=>{
      t = (name, test)=>t_roles(name, 'abcde', test);
      t('ring_no_shortcut', `conf(a-e:mid(0-1))
        !ring(a-e) cb.a.e.d~c>!ring_join cbae.a.b~d>!ring_join
        cd.ea~e>!ring_join cba.e.d~b>!ring_join cb.ae~a>!ring_join`);
      t('ring_with_shortcut', `conf(a-e:mid(0-1)) !ring(a-e bd)
        cb.d~c>!ring_join cb.a.e~d>!ring_join cd.b.a~e>!ring_join
        cba.e.d~b>!ring_join cb.ae~a>!ring_join`);
      t('ring_with_shortcut2', `conf(id(a:.1 b:.4 c:.5 d:.501 e:.9))
        !ring(a-e bd) cd.b~c>!ring_join cb.a.e~d>!ring_join
        cba.b.d~e>!ring_join cd.ba~b>!ring_join cb.d.e~a>!ring_join`);
      t('ring_with_shortcut3', `conf(a-e:exact(.44-.56)) !ring(a-e bd)
        cb.d~c>!ring_join cd.e.a~b>!ring_join c.d.e~a>!ring_join`);
      t('ring_with_shortcut4', `conf(id(a:.1 b:.4 c:.5 d:.501 e:.9)) !ring(a-e)
        cd.e.a.b~c>!ring_join cd.ea~b>!ring_join cde.ab~a>!ring_join`);
      t('ring_with_shortcut5', `conf(id(a:.45 b:.49 c:.5 d:.53 e:.57))
        !ring(a-e) cb.a.e.d~c>!ring_join cd.e.a~b>!ring_join
        cd.e.ab~a>!ring_join`);
      // XXX: check why test fail with msg_delay
      t('minimal_peer_registration',
        `conf(!msg_delay id(a:.1 b:.11 c:.12 d:.13 e:.14) rtt(999 ce:2 ea:2))
        // we don't get to d because b is not aware of d
        !ring(a-e ce) ce.a.b~c>!ring_join
        // d properly register itself to network (ie. neighbours)
        dc.e~d>!ring_join de.a.b~c>!ring_join dc.ea~e>!ring_join
        // now we get to d because b learned about d
        ce.a.b.aed~c>!ring_join
      `);
      t = (name, test)=>t_roles(name, 'abBcdefghiXYZ', test);
      // nodes: abcdeXYZfghi B:.15 X:.49 Y:.5 Z:.51
      // a:0 b:.11 c:.22 d:.33 e.44 f:.55 g:.66 h:.77 i:.88
      // conn: adg -> X; beh -> Y cfi->Z
      // XXX: check why test fail with msg_delay (and very slow)
      t('complex', `conf(!msg_delay a-i:head(0-1) X-Z:exact(.49-.51)
        id(B:.15)) !ring(X-Z)
        XY.Z~X>!ring_join ZY.X~Z>!ring_join ZY.X~Z>!ring_join
        // aXYZ
        aX>!connect aX.Z~a>!ring_join aX.Y~Z>!ring_join aXY.Z~X>!ring_join
        // abXYZ
        bY>!connect bY.Xa.X~b>!ring_join bYX.Z~a>!ring_join
        bY.Z.Xa~X>!ring_join
        // abcXYZ
        cZ>!connect cZ.Yb.Y.X~c>!ring_join cZ.Xa.X~b>!ring_join
        cZ.Y.b~X>!ring_join
        // abcdXYZ
        dX>!connect dX.Y.Z.c~d>!ring_join dX.Y.b~c>!ring_join
        dXY.Z.c~X>!ring_join
        // abcdeXYZ
        eY>!connect eY.Z.c.ZX.d~e>!ring_join eY.Z.c.ZX~d>!ring_join
        eY.Z.c.ZXd~X>!ring_join
        // abcdeXYZf
        fZ>!connect fZ.Y.X.d.XZc.ZXa~f>!ring_join
        fZY.X.d.XZc.ZYb.YXa~Z>!ring_join
        // abcdeXYZfg
        gX>!connect gX.a.XZ.f~g>!ring_join gX.d.XZ.c.ZXa~f>!ring_join
        gXZc.ZYb.YXd.XZYe.YZ.f~a>!ring_join
        // abcdeXYZfgh
        hY>!connect hY.X.g.Xa~h>!ring_join hY.X.a.XZ.f~g>!ring_join
        hYXg.XZYb~a>!ring_join
        // abcdeXYZfghi
        iZ>!connect iZ.Xa.Xg.XYh~i>!ring_join iZ.Y.X.g.Xa~h>!ring_join
        iZXYh.Yb~a>!ring_join
        // get more neighbours of i
        iZ.Y.X.a.XYh.YXZf~g>!ring_join iZXa.XZc~b>!ring_join
        iZ.Y.X.g~f>!ring_join
        iZXYb.Y.Xd~c>!ring_join
        // B joins abBcdeXYZfghi
        BX>!connect BX.Yb.YZc~B>!ring_join BXYZc.Zi.ZXa~b>!ring_join
        BX.d.XYb~c>!ring_join`);
    });
  });
  describe('req_new', function(){
    // XXX: need auto
    describe('manual', ()=>{
      const t = (name, test)=>t_roles(name, 'ab', test);
      t('msg', `mode:msg setup:2_nodes
        ab>!req(id:0 body:ping !!) ab>msg(id:0 type:req body:ping)
        ab<!res(id:0 ack:0 body:ping_r !!)
        ab<msg(id:0 type:res ack:0 body:ping_r)
        20s ab>!req(id:1 body:ping !!) ab>msg(id:1 type:req body:ping)
        ab<!res(id:1 ack:0 body:ping_r !!)
        ab<msg(id:1 type:res ack:0 body:ping_r)`);
      t('msg,req', `setup:2_nodes
        ab>!req(id:0 body:ping !!) ab>msg(id:0 type:req body:ping)
        ab>*req(id:0 body:ping)
        ab<!res(id:0 ack:0 body:ping_r !!)
        ab<msg(id:0 type:res ack:0 body:ping_r)
        ab<*res(id:0 ack:0 body:ping_r) 20s
        ab>!req(id:1 body:ping !!) ab>msg(id:1 type:req body:ping)
        ab>*req(id:1 body:ping)
        ab<!res(id:1 ack:0 body:ping_r !!)
        ab<msg(id:1 type:res ack:0 body:ping_r)
        ab<*res(id:1 ack:0 body:ping_r)`);
    });
    describe('wrong_order', ()=>{
      const t = (name, test)=>t_roles(name, 'ab', test);
      t('msg', `mode(msg) setup:2_nodes ab>!req(id:0 body:ping)
        ab>!req(id:1 body:ping) ab<!res(id:1 body:ping_r)
        ab<!res(id:0 body:ping_r)`);
       t('msg,req', `setup:2_nodes ab>!req(id:0 body:ping)
        ab>!req(id:1 body:ping) ab<!res(id:1 body:ping_r)
        ab<!res(id:0 body:ping_r)`);
    });
    describe('2_nodes', ()=>{
      const t = (name, test)=>t_roles(name, 'ab', test);
      t('msg', `mode:msg a=node b=node(wss(port:4000)) ab>!connect(wss !!)
        ab>msg(type:req cmd:connect) + ab<msg(type:req cmd:connect)
        ab<ack + ab>ack -
        ab>!req(id:0 body:ping res:ping_r !!)
        ab>msg(type:req id:0 body:ping) ab<msg(type:res id:0 body:ping_r)`);
      t('msg,req', `a=node b=node(wss(port:4000))
        ab>!connect(wss !!) ab>msg(type:req cmd:connect) +
        ab<msg(type:req cmd:connect) ab<ack + ab>ack -
        ab>!req(id:0 body:ping res:ping_r !!) ab>msg(type:req id:0 body:ping)
        ab>*req(id:0 body:ping) ab<msg(type:res id:0 body:ping_r)
        ab<*res(id:0 body:ping_r)`);
    });
    describe('3_nodes', ()=>{
      const t = (name, test)=>t_roles(name, 'ab', test);
      t('msg', ` mode:msg a=node b=node(wss) ab>!connect(wss) c=node(wss)
        bc>!connect(wss) rt_add(a:bc) abc>!req(id:0 body:ping res:ping_r)`);
      t('msg,req', ` a=node b=node(wss) ab>!connect(wss) c=node(wss)
        bc>!connect(wss) rt_add(a:bc) abc>!req(id:0 body:ping res:ping_r)`);
    });
    describe('failure', ()=>{
      const t = (name, test)=>t_roles(name, 'ab', test);
      describe('timeout', ()=>{
        t('msg', `mode:msg setup:2_nodes ab>!req(id:0 body:ping) 20s
          a>*fail(id:0 error:timeout)`);
        t('msg,req', `setup:2_nodes ab>!req(id:0 body:ping) 19950ms
          a>*fail(id:0 error:timeout)`);
      });
      describe('timeout_wrong_id', ()=>{
        const t = (name, test)=>t_roles(name, 'a', test);
        t('msg', `mode:msg setup:2_nodes
          ab>!req(id:0 body:ping !!)
          ab>msg(id:0 type:req body:ping)
          ab>!req(id:1 body:ping !!)
          ab>msg(id:1 type:req body:ping)
          ab<msg(id:1 type:res body:ping_r) 50ms 19850ms
          a>*fail(id:0 error:timeout)`);
        t('msg,req', `setup:2_nodes
          ab>!req(id:0 body:ping !!)
          ab>msg(id:0 type:req body:ping) ab>*req(id:0 body:ping)
          ab>!req(id:1 body:ping !!)
          ab>msg(id:1 type:req body:ping) ab>*req(id:1 body:ping)
          ab<msg(id:1 type:res body:ping_r) ab<*res(id:1 body:ping_r) 19850ms
          a>*fail(id:0 error:timeout)`);
      });
      describe('no_route', ()=>{
        const t = (name, test)=>t_roles(name, 'ab', test);
        t('msg', `mode:msg setup:2_nodes c=node cb>!req(id:0 body:ping !!)
        20s c>*fail(id:0 error:timeout)`);
        if (0) // XXX: fixme
        t('msg,req', `setup:2_nodes c=node cb>!req(id:0 body:ping) - 19999ms -
        1ms c>*fail(id:0 error:timeout)`);
      });
    });
  });
  describe('stream', function(){
    const t = (name, test)=>t_roles(name, 'abc', test);
    // XXX: add msg and msg,req versions
    describe('manual', ()=>{
      t('msg', `mode:msg setup:2_nodes
        ab>!req_start(id:0 seq:0 cmd:test body:b0 !!)
        ab>msg(id:0 type:req_start cmd:test seq:0 body:b0)
        ab<!res_start(id:0 seq:0 ack:0 body:c0 !!)
        ab<msg(id:0 type:res_start cmd:test seq:0 ack:0 body:c0)
        ab>!req_next(id:0 seq:1 ack:0 body:b1 !!)
        ab>msg(id:0 type:req_next cmd:test seq:1 ack:0 body:b1)
        ab<!res_next(id:0 seq:1 ack:1 body:c1 !!)
        ab<msg(id:0 type:res_next cmd:test seq:1 ack:1 body:c1)
        ab>!req_end(id:0 seq:2 ack:1 body:b2 !!)
        ab>msg(id:0 type:req_end cmd:test ack:1 seq:2 body:b2)
        ab<!res_end(id:0 seq:2 ack:2 body:c2 !!)
        ab<msg(id:0 type:res_end cmd:test seq:2 ack:2 body:c2)`);
      t('msg,req', `setup:2_nodes ab>!req_start(id:0 seq:0 cmd:test body:b0 !!)
        ab>msg(id:0 type:req_start cmd:test seq:0 body:b0)
        ab>*req_start(id:0 seq:0 cmd:test body:b0)
        ab<!res_start(id:0 seq:0 ack:0 body:c0 !!)
        ab<msg(id:0 type:res_start cmd:test seq:0 ack:0 body:c0)
        ab<*res_start(id:0 seq:0 ack:0 cmd:test body:c0)
        ab>!req_next(id:0 seq:1 ack:0 body:b1 !!)
        ab>msg(id:0 type:req_next cmd:test seq:1 ack:0 body:b1)
        ab>*req_next(id:0 seq:1 ack:0 cmd:test body:b1)
        ab<!res_next(id:0 seq:1 ack:1 body:c1 !!)
        ab<msg(id:0 type:res_next cmd:test seq:1 ack:1 body:c1)
        ab<*res_next(id:0 seq:1 ack:1 cmd:test body:c1)
        ab>!req_end(id:0 seq:2 ack:1 body:b2 !!)
        ab>msg(id:0 type:req_end cmd:test ack:1 seq:2 body:b2)
        ab>*req_end(id:0 seq:2 ack:1 cmd:test body:b2)
        ab<!res_end(id:0 seq:2 ack:2 body:c2 !!)
        ab<msg(id:0 type:res_end cmd:test seq:2 ack:2 body:c2)
        ab<*res_end(id:0 seq:2 ack:2 cmd:test body:c2)`);
    });
    describe('auto', ()=>{
      t('msg', `mode:msg setup:2_nodes
        ab>!req_start(id:0 cmd:test body:b0 !!)
        ab>msg(id:0 type:req_start cmd:test seq:0 body:b0)
        ab<!res_start(id:0 ack:0 body:c0 !!)
        ab<msg(id:0 type:res_start cmd:test seq:0 ack:0 body:c0)
        ab>!req_next(id:0 ack:0 body:b1 !!)
        ab>msg(id:0 type:req_next cmd:test seq:1 ack:0 body:b1)
        ab<!res_next(id:0 ack:1 body:c1 !!)
        ab<msg(id:0 type:res_next cmd:test seq:1 ack:1 body:c1)
        ab>!req_end(id:0 ack:1 body:b2 !!)
        ab>msg(id:0 type:req_end cmd:test ack:1 seq:2 body:b2)
        ab<!res_end(id:0 ack:2 body:c2 !!)
        ab<msg(id:0 type:res_end cmd:test seq:2 ack:2 body:c2)`);
      t('msg,req', `setup:2_nodes ab>!req_start(id:0 cmd:test body:b0 !!)
        ab>msg(id:0 type:req_start cmd:test seq:0 body:b0)
        ab>*req_start(id:0 cmd:test body:b0)
        ab<!res_start(id:0 ack:0 body:c0 !!)
        ab<msg(id:0 type:res_start cmd:test seq:0 ack:0 body:c0)
        ab<*res_start(id:0 cmd:test body:c0)
        ab>!req_next(id:0 ack:0 body:b1 !!)
        ab>msg(id:0 type:req_next cmd:test seq:1 ack:0 body:b1)
        ab>*req_next(id:0 cmd:test body:b1)
        ab<!res_next(id:0 ack:1 body:c1 !!)
        ab<msg(id:0 type:res_next cmd:test seq:1 ack:1 body:c1)
        ab<*res_next(id:0 cmd:test body:c1)
        ab>!req_end(id:0 ack:1 body:b2 !!)
        ab>msg(id:0 type:req_end cmd:test ack:1 seq:2 body:b2)
        ab>*req_end(id:0 cmd:test body:b2)
        ab<!res_end(id:0 ack:2 body:c2 !!)
        ab<msg(id:0 type:res_end cmd:test seq:2 ack:2 body:c2)
        ab<*res_end(id:0 cmd:test body:c2)`);
    });
    t('res', `setup:2_nodes ab>!req_start(id:0 body:b0)
      ab<!res_start(id:0 body:c0) ab>!req_next(id:0.1 body:b1)
      ab<!res_next(id:0.1 body:c1) ab>!req_end(id:0.2 body:b2)
      ab<!res_end(id:0.2 body:c2)`);
    t('multi_res', `setup:2_nodes
      ab>!req_start(id:0 seq:0 body:b0)
      ab<!res_start(id:0 seq:0 body:c0) ab<!res_next(id:0 seq:1 body:c1)
      ab<!res_next(id:0 seq:2 body:c2) ab>!req_end(id:0 seq:1 body:b2)
      ab<!res_end(id:0 seq:3 body:c3)`);
    describe('timeout', function(){
      t('req_start', `setup:2_nodes
        ab>!req_start(id:0 seq:0) 19949ms
        1ms a>*fail(id:0 seq:0 error(timeout))`);
      // XXX: check why test fail with msg_delay
      t('res_start', `conf(!msg_delay) setup:2_nodes
        ab>!req_start(id:0 seq:0) 19999ms
        ab<!res_start(id:0 seq:0) 19999ms
        1ms b>*fail(id:0 seq:0 error:timeout)`);
      // XXX: check why test fail with msg_delay
      t('req_next', `conf(!msg_delay) setup:2_nodes ab>!req_start(id:0 seq:0)
        19999ms ab<!res_start(id:0 seq:0) ab>!req_next(id:0 seq:1) 20s
        a>*fail(id:0 seq:1 error(timeout))`);
      // XXX: check why test fail with msg_delay
      t('res_next', `conf(!msg_delay) setup:2_nodes ab>!req_start(id:0 seq:0)
        19999ms ab<!res_start(id:0 seq:0) ab>!req_next(id:0 seq:1)
        19999ms ab<!res_next(id:0 seq:1) 19999ms
        1ms b>*fail(id:0 seq:1 error:timeout)`);
      // XXX: check why test fail with msg_delay
      t('req_end', `conf(!msg_delay) setup:2_nodes ab>!req_start(id:0 seq:0)
        ab<!res_start(id:0 seq:0) 19999ms ab>!req_next(id:0 seq:1)
        ab<!res_next(id:0 seq:1) 19999ms ab>!req_end(id:0 seq:2) 19999ms
        1ms a>*fail(id:0 seq:2 error(timeout))`);
      let setup = `setup:2_nodes ab>!req_start(id:0 seq:0)
        ab<!res_start(id:0 seq:0) - ab>!req_next(id:0 seq:1) 5s -
        ab>!req_next(id:0 seq:2) 10s -`;
      t('multi_no_res', `${setup} 4899ms
        1ms a>*fail(id(0) seq:1 error(timeout)) 20s`);
      // XXX: check why test fail with msg_delay
      if (0) // XXX: FIXME
      t('multi_no_res_1st', `conf(!msg_delay)
        ${setup} ab<!res_next(id:0 seq:1 ack:2)
        5000ms a>*fail(id:0 seq:1 error:timeout)
        14999ms - 1ms b>*fail(id(0) seq:1 error:timeout)`);
      // XXX: check why test fail with msg_delay
      if (0) // XXX: FIXME
      t('multi_no_res_2nd', `conf(!msg_delay)
        ${setup} ab<!res_next(id:0 seq:1 ack:1)
        9999ms - 1ms a>*fail(id:0 seq:2 error:timeout) 9999ms - 1ms
        b>*fail(id(0) seq:1 error:timeout)`);
      // XXX: check why test fail with msg_delay
      setup = `conf(!msg_delay) setup:2_nodes ab>!req_start(id:0 seq:0)
        ab<!res_start(id:0 seq:0) ab>!req_next(id:0 seq:1)
        ab<!res_next(id:0 seq:1) 5s - ab<!res_next(id:0 seq:2) 10s`;
      t('multi_no_req', `${setup} 5s b>*fail(id(0) seq:1 error(timeout))`);
      if (0) // XXX: FIXME
      t('multi_no_req_1st', `${setup} 4999ms -
        ab>!req_next(id:0 seq:2 ack:2) -
        1ms b>*fail(id(0) seq:1 error(timeout)) -
        20s a>*fail(id:0 seq:2 error:timeout) -`);
      if (0) // XXX: FIXME
      t('multi_no_req_2nd', `${setup} 4999ms -
        ab>!req_next(id:0 seq:2 ack:1) -
        5s - 1ms b>*fail(id(0) seq:2 error(timeout)) -
        20s a>*fail(id:0 seq:2 error:timeout) -`);
    });
    describe('close', function(){
      // XXX: check why test fail with msg_delay (all tests below)
      t('req_start', `conf(!msg_delay !auto_time)
        setup:2_nodes ab>!req_start(id:0 seq:0)
        ab>!req_end(id:0 seq:1 close) 20s`);
      t('req_next', `conf(!msg_delay !auto_time)
        setup:2_nodes ab>!req_start(id:0 seq:0)
        ab>!req_next(id:0 seq:1) ab>!req_end(id:0 seq:2 close) - 20s`);
      t('res_start', `conf(!msg_delay !auto_time)
        setup:2_nodes ab>!req_start(id:0 seq:0)
        ab<!res_start(id:0 seq:0) ab<!res_end(id:0 seq:1 close) - 20s`);
      t('res_next', `conf(!msg_delay !auto_time)
        setup:2_nodes ab>!req_start(id:0 seq:0)
        ab<!res_start(id:0 seq:0) ab>!req_next(id:0 seq:1)
        ab<!res_end(id:0 seq:2 close) - 20s`);
      t('res_close', `conf(!msg_delay !auto_time)
        setup:2_nodes ab>!req_start(id:0 seq:0)
        ab<!res_start(id:0 seq:0) ab>!req_next(id:0 seq:1)
        ab<!res_end(id:0 seq:1 close) - 20s`);
      t('req_close', `conf(!msg_delay !auto_time)
        setup:2_nodes ab>!req_start(id:0 seq:0)
        ab<!res_start(id:0 seq:0) ab>!req_next(id:0 seq:1)
        ab>!req_end(id:0 seq:2 close) - 20s`);
    });
    describe('out_of_order', ()=>{
      if (true) return; // XXX: FIXME
      describe('req', ()=>{
        const t = (name, test)=>t_roles(name, 'a', test);
        t('req_normal', `setup:2_nodes
          ab<!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          a>*req_start(id:0 seq:0 cmd:test body:b0)
          ab<*req_next(id:0 seq:1 body:b1)
          a>*req_next(id:0 seq:1 cmd:test body:b1)
          ab<*req_next(id:0 seq:2 body:b2)
          a>*req_next(id:0 seq:2 cmd:test body:b2)
          ab<*req_end(id:0 seq:3 body:b3)
          a>*req_end(id:0 seq:3 cmd:test body:b3)`);
        // XXX: how to test req_start arriving last?
        t('req_rev', `setup:2_nodes
          ab<!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          a>*req_start(id:0 seq:0 cmd:test body:b0)
          ab<*req_end(id:0 seq:3 body:b3)
          a>*req_end(id:0 seq:3 cmd:test body:b3 ooo)
          ab<*req_next(id:0 seq:2 body:b2)
          a>*req_next(id:0 seq:2 cmd:test body:b2 ooo)
          ab<*req_next(id:0 seq:1 body:b1)
          a>*req_next(id:0 seq:1 cmd:test body:b1)
          a>*req_next(id:0 seq:2 cmd:test body:b2)
          a>*req_end(id:0 seq:3 cmd:test body:b3)`);
        t('req_multi_next', `setup:2_nodes
          ab<!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          a>*req_start(id:0 seq:0 cmd:test body:b0)
          ab<*req_next(id:0 seq:5 body:b5)
          a>*req_next(id:0 seq:5 cmd:test body:b5 ooo)
          ab<*req_next(id:0 seq:3 body:b3)
          a>*req_next(id:0 seq:3 cmd:test body:b3 ooo)
          ab<*req_next(id:0 seq:1 body:b1)
          a>*req_next(id:0 seq:1 cmd:test body:b1)
          ab<*req_next(id:0 seq:4 body:b4)
          a>*req_next(id:0 seq:4 cmd:test body:b4 ooo)
          ab<*req_next(id:0 seq:2 body:b2)
          a>*req_next(id:0 seq:2 cmd:test body:b2)
          a>*req_next(id:0 seq:3 cmd:test body:b3)
          a>*req_next(id:0 seq:4 cmd:test body:b4)
          a>*req_next(id:0 seq:5 cmd:test body:b5)
          ab<*req_end(id:0 seq:6 body:b6)
          a>*req_end(id:0 seq:6 cmd:test body:b6)`);
        // XXX: the last req_end(dup) should not be emitted. need to close
        // connection
        t('req_dup', `setup:2_nodes conf(xerr)
          ab<!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          a>*req_start(id:0 seq:0 cmd:test body:b0)
          ab<*req_start(id:0 seq:0 cmd:test body:b0)
          a>*req_start(id:0 seq:0 cmd:test body:b0 dup)
          ab<*req_next(id:0 seq:1 body:b1_1)
          a>*req_next(id:0 seq:1 cmd:test body:b1_1)
          ab<*req_next(id:0 seq:1 body:b1_2)
          a>*req_next(id:0 seq:1 cmd:test body:b1_2 dup)
          ab<*req_end(id:0 seq:2 body:b2)
          a>*req_end(id:0 seq:2 cmd:test body:b2)
          ab<*req_end(id:0 seq:2 body:b2)
          a>*req_end(id:0 seq:2 cmd:test body:b2 dup)
          `);
        t('req_dup_ooo', `setup:2_nodes conf(xerr)
          ab<!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          a>*req_start(id:0 seq:0 cmd:test body:b0)
          ab<*req_next(id:0 seq:2 body:b1)
          a>*req_next(id:0 seq:2 cmd:test body:b1 ooo)
          ab<*req_next(id:0 seq:2 body:b1)
          a>*req_next(id:0 seq:2 cmd:test body:b1 ooo dup)
        `);
        t('req_many', `setup:3_nodes_wss
          ab<!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          a>*req_start(id:0 seq:0 cmd:test body:b0)
          ac<!req_start(id:1 seq:0 cmd:test body:c0 emit_api)
          a>*req_start(id:1 seq:0 cmd:test body:c0)
          ab<*req_next(id:0 seq:2 body:b2)
          a>*req_next(id:0 seq:2 cmd:test body:b2 ooo)
          ac<*req_next(id:1 seq:2 body:c2)
          a>*req_next(id:1 seq:2 cmd:test body:c2 ooo)
          ab<*req_next(id:0 seq:1 body:b1)
          a>*req_next(id:0 seq:1 cmd:test body:b1)
          a>*req_next(id:0 seq:2 cmd:test body:b2)
          ac<*req_next(id:1 seq:1 body:c1)
          a>*req_next(id:1 seq:1 cmd:test body:c1)
          a>*req_next(id:1 seq:2 cmd:test body:c2)`);
      });
      describe('res', ()=>{
        const t = (name, test)=>t_roles(name, 'a', test);
        t('res_normal', `setup:2_nodes
          ab>!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          ab<*res_start(id:0 seq:0 ack:0 body:c0)
          a>*res_start(id:0 seq:0 ack:0 cmd:test body:c0)
          ab<*res_next(id:0 seq:1 ack body:c1)
          a>*res_next(id:0 seq:1 cmd:test body:c1)
          ab<*res_end(id:0 seq:2 ack body:c3)
          a>*res_end(id:0 seq:2 cmd:test body:c3)`);
        t('res_rev', `setup:2_nodes
          ab>!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          ab<*res_end(id:0 seq:2 ack body:c3)
          a>*res_end(id:0 seq:2 cmd:test body:c3 ooo)
          ab<*res_next(id:0 seq:1 ack body:c1)
          a>*res_next(id:0 seq:1 cmd:test body:c1 ooo)
          ab<*res_start(id:0 seq:0 ack:0 body:c0)
          a>*res_start(id:0 seq:0 ack:0 cmd:test body:c0)
          a>*res_next(id:0 seq:1 cmd:test body:c1)
          a>*res_end(id:0 seq:2 cmd:test body:c3)`);
        t('res_multi_next', `setup:2_nodes
          ab>!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          ab<*res_start(id:0 seq:0 ack:0 body:c0)
          a>*res_start(id:0 seq:0 ack:0 cmd:test body:c0)
          ab<*res_next(id:0 seq:5 ack body:c5)
          a>*res_next(id:0 seq:5 cmd:test body:c5 ooo)
          ab<*res_next(id:0 seq:3 ack body:c3)
          a>*res_next(id:0 seq:3 cmd:test body:c3 ooo)
          ab<*res_next(id:0 seq:1 ack body:c1)
          a>*res_next(id:0 seq:1 cmd:test body:c1)
          ab<*res_next(id:0 seq:4 ack body:c4)
          a>*res_next(id:0 seq:4 cmd:test body:c4 ooo)
          ab<*res_next(id:0 seq:2 ack body:c2)
          a>*res_next(id:0 seq:2 cmd:test body:c2)
          a>*res_next(id:0 seq:3 cmd:test body:c3)
          a>*res_next(id:0 seq:4 cmd:test body:c4)
          a>*res_next(id:0 seq:5 cmd:test body:c5)
          ab<*res_end(id:0 seq:6 ack body:c3)
          a>*res_end(id:0 seq:6 cmd:test body:c3)`);
        t('res_dup', `setup:2_nodes conf(xerr)
          ab>!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          ab<*res_start(id:0 seq:0 ack:0 body:c0)
          a>*res_start(id:0 seq:0 ack:0 cmd:test body:c0)
          ab<*res_start(id:0 seq:0 ack:0 body:c0)
          a>*res_start(id:0 seq:0 ack:0 cmd:test body:c0 dup)
          ab<*res_next(id:0 seq:1 ack body:c1)
          a>*res_next(id:0 seq:1 cmd:test body:c1)
          ab<*res_next(id:0 seq:1 ack body:c1)
          a>*res_next(id:0 seq:1 cmd:test body:c1 dup)
          ab<*res_end(id:0 seq:2 ack body:c3)
          a>*res_end(id:0 seq:2 cmd:test body:c3)
          ab<*res_end(id:0 seq:2 ack body:c3)
          a>*res_end(id:0 seq:2 cmd:test body:c3 dup)`);
        t('res_dup_ooo', `setup:2_nodes conf(xerr)
          ab>!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          ab<*res_start(id:0 seq:0 ack:0 body:c0)
          a>*res_start(id:0 seq:0 ack:0 cmd:test body:c0)
          ab<*res_next(id:0 seq:2 ack body:c1)
          a>*res_next(id:0 seq:2 cmd:test body:c1 ooo)
          ab<*res_next(id:0 seq:2 ack body:c1)
          a>*res_next(id:0 seq:2 cmd:test body:c1 ooo dup)`);
        t('res_many', `setup:3_nodes_wss
          ab>!req_start(id:0 seq:0 cmd:test body:b0 emit_api)
          ab<*res_start(id:0 seq:0 ack:0 body:b0)
          a>*res_start(id:0 seq:0 ack:0 cmd:test body:b0)
          ac>!req_start(id:1 seq:0 cmd:test body:c0 emit_api)
          ac<*res_start(id:1 seq:0 ack:0 body:c0)
          a>*res_start(id:1 seq:0 ack:0 cmd:test body:c0)
          ab<*res_next(id:0 seq:2 ack body:b2)
          a>*res_next(id:0 seq:2 cmd:test body:b2 ooo)
          ac<*res_next(id:1 seq:2 ack body:c2)
          a>*res_next(id:1 seq:2 cmd:test body:c2 ooo)
          ab<*res_next(id:0 seq:1 ack body:b1)
          a>*res_next(id:0 seq:1 cmd:test body:b1)
          a>*res_next(id:0 seq:2 cmd:test body:b2)
          ac<*res_next(id:1 seq:1 ack body:c1)
          a>*res_next(id:1 seq:1 cmd:test body:c1)
          a>*res_next(id:1 seq:2 cmd:test body:c2)`);
      });
    });
  });
  // XXX: add boostrap support
  describe('2_nodes_ws', function(){
    const t = (name, test)=>t_roles(name, 'ab', test);
    t('long', `a=node b=node(wss(port:4000)) ab>!connect(wss !!)
      ab>msg(type:req cmd:connect) + ab<msg(type:req cmd:connect) ab<ack +
      ab>ack`);
    t('short', `a=node b=node(wss) ab>!connect`);
    t('msg', `mode:msg setup:2_nodes ab>!req(id:0 body:ping res:ping_r)
      ab<!req(id:1 body:ping res:ping_r)`);
    t('msg,req', `setup:2_nodes
      ab>!req(id:0 body:ping res:ping_r) - ab<!req(id:1 body:ping res:ping_r)
    `);
  });
  describe('2_nodes_wrtc', function(){
    const t = (name, test)=>t_roles(name, 'ab', test);
    t('msg', `mode:msg a=node(wrtc) b=node(wrtc wss) -
      ab>!connect(wrtc) - ab>!req(id:0 body:ping res:ping_r)
      ab<!req(id:1 body:ping res:ping_r)`);
    t('msg,req', `a=node(wrtc) b=node(wrtc wss) -
      ab>!connect(wrtc) - ab>!req(id:0 body:ping res:ping_r) -
      ab<!req(id:1 body:ping res:ping_r)
    `);
  });
  describe('2_nodes_wss', function(){
    const t = (name, test)=>t_roles(name, 'ab', test);
    t('msg', `mode:msg setup:2_nodes_wss`);
    t('msg,req', `setup:2_nodes_wss`);
  });
  describe('3_nodes', function(){
    const t = (name, test)=>t_roles(name, 'abcs', test);
    // XXX bug: missing ac>connect(wss) - need to fix peer-relay implemention
    // and send supported connections in conn_info so other side can
    // connect directly
    describe('linear_simple', ()=>{
      t('msg', `mode:msg setup:3_nodes_linear rt_add(a:bc)
        ab>!req(id:0 body:ping res:ping_r)
        abc>!req(id:1 body:ping res:ping_r)
        bc>!req(id:2 body:ping res:ping_r)`);
      t('msg,req', `setup:3_nodes_linear rt_add(a:bc)
        ab>!req(id:0 body:ping res:ping_r)
        abc>!req(id:1 body:ping res:ping_r)
        bc>!req(id:2 body:ping res:ping_r)`);
    });
    describe('linear_wrtc', ()=>{
      t('msg', `mode:msg a=node(wrtc) b,c=node(wrtc wss)
        ab>!connect:wss - bc>!connect:wrtc`);
      t('msg,req', `a=node(wrtc) b,c=node(wrtc wss)
        ab>!connect:wss - bc>!connect:wrtc`);
    });
    describe('linear_wss', ()=>{
      t('msg', `mode:msg setup:3_nodes_wss`);
      t('msg,req', `setup:3_nodes_wss`);
    });
  });
  // XXX: add disconnect tests
  // BUG: if ac>connected and connection is broken, send will not try to send
  // messages through other peers if connections is broken
  describe('node', function(){
    const t = (name, test)=>t_roles(name, 'abcde', test);
    // XXX test for errors, retry,...
    // XXX: check why test fail with msg_delay (and add version with manual
    // time)
    t('ring_join', `conf(!msg_delay a-e) !ring(a-e) c>!node.ring_join
       cb.a.e.d~c>ring_join cba.e.d~b>ring_join cbae.a.b~d>ring_join
       cb.ae~a>ring_join cd.ea~e>ring_join`);
  });
  describe('ack_no_rtt', function(){
    let t = (name, test)=>t_roles(name, 'ab', test);
    t = (name, test)=>t_roles(name, 'ab', test);
    // XXX derry:
    // 1. logic for sending ack on response
    // 2. unite previous ack from stream level
    // 3. how automatic ack in test works (in parser, add missing ack, or
    // send tranparently ack)
    // 4. calc rtt from ack messages? -- according to rtt between connection.
    // each msg takes time to arrive according to rtt
    t('ping', `conf(!msg_delay a-c rtt:50) ab>!connect conf(!autoack)
      ab>!ping(id:1 !!) ab>ping(id:1.0) ab>*ping
      ab<ack(id:>1.0 vv) ab<ping_r(id:1.0) ab<*ping_r ab>ack(id:<1.0 vv)
    `);
    t = (name, test)=>t_roles(name, 'ab', test);
    t('2_nodes_manual', `mode:msg conf(!msg_delay !autoack a-c rtt:50)
      ab>!connect ab>!req(id:1 !!) a#ab>opening(>1.0) b#!id:1
      ab>req(id:1) a#same b#ab>open(>1.0vv)
      ab<ack(id:>1.0 vv) a#ab>open(>1.0vv) b#same
      ab<!res(id:1 !!) // a#ab>open(!id:<1.0) b#ab>closing(<1.0)
      ab<res(id:1) // a#ab>close(<1.0vv) b#same
      ab>ack(id:<1.0 vv) // a#same b#ab>close(<1.0vv)
      // XXX: change to 10s
      // XXX: 19s a#ab>close(<1.0vv) b#ab>close(<1.0vv)
      // 1s a#!id:1 b#!id:1
    `);
    t('2_nodes_auto', `mode:msg conf(!msg_delay !msg_delay a-c rtt:50)
      ab>!connect ab>!req(id:1 !!) a#ab>opening(>1.0) b#!id:1
      ab>req(id:1) a#ab>open(>1.0vv) b#ab>open(>1.0vv)
      ab<!res(id:1 !!) a#ab>open(!id:<1.0) b#ab>closing(<1.0)
      ab<res(id:1) a#ab>close(<1.0vv) b#ab>close(<1.0vv)
      // XXX: change to 10s
      // XXX: 19s a#ab>close(<1.0vv) b#ab>close(<1.0vv)
      // 1s a#!id:1 b#!id:1
    `);
    t = (name, test)=>t_roles(name, 'abc', test);
    t('3_nodes_manual', `mode:msg conf(!msg_delay !msg_delay a-c rtt:50)
      ab>!connect bc>!connect
      cb.a~c>!ring_join ab.c~a>!ring_join ba.bc~b>!ring_join
      abc>!req(body:ping res:ping_r) conf(!msg_delay !autoack)
      // XXX a#ab[c]:ac>opening(id:>1.0) b# c#
      // XXX calc rtt from ack messages
      a#!id:1 b#!id:1 c#!id:1
      ac>!req_start(id:1 !!) a#ac>opening(>1.0) b,c#!id:1
      ab[c]:ac>req_start(id:1.0) b#ac>opening(>1.0) a#ac>opening(>1.0) c#!id:1
      bc:ab[c]:ac>req_start(id:1.0) a#ac>opening(>1.0) b#ac>opening(>1.0)
      c#ac>open(>1.0vv)
      bc[a]:ac<ack(id:>1.0 vv)
      ab<ack(id:>1.0) a#ac>opening(>1.0v) b#ac>open(>1.0vv) c#ac>open(>1.0vv)
      ab:bc[a]:ac<ack(id:>1.0 vv)
      a#ac>open(>1.0vv) b#ac>open(>1.0vv) c#ac>open(>1.0vv)
      ac<!res_start(id:1 !!) a#ac>open(>1.0vv !id:<1.0)
      b#ac>open(>1.0vv !id:<1.0) c#ac>open(>1.0vv <1.0)
      bc[a]:ac<res_start(id:1.0) a#ac>open(>1.0vv !id:<1.0)
      b#ac>open(>1.0vv <1.0) c#ac>open(>1.0vv <1.0)
      ab:bc[a]:ac<res_start(id:1.0)
      bc>ack(id:<1.0) a#ac>open(>1.0vv <1.0vv) b#ac>open(>1.0vv <1.0)
      c#ac>open(>1.0vv <1.0v)
      ab[c]:ac>ack(id:<1.0 vv)
      bc:ab[c]:ac>ack(id:<1.0 vv)
      a#ac>open(>1.0vv <1.0vv) b#ac>open(>1.0vv <1.0vv)
      c#ac>open(>1.0vv <1.0vv)
      ac>!req_next(!!) a#ac>open(>1.1) b#ac>open(>1.0vv <1.0vv)
      c#ac>open(>1.0vv <1.0vv)
      ab[c]:ac>req_next(id:1.1) a#ac>open(>1.1) b#ac>open(>1.1)
      c#ac>open(>1.0vv <1.0vv)
      bc:ab[c]:ac>req_next(id:1.1) a#ac>open(>1.1) b#ac>open(>1.1)
      c#ac>open(>1.1vv)
      bc[a]:ac<ack(id:>1.1 vv)
      ab<ack(id:>1.1) a#ac>open(>1.1v) b#ac>open(>1.1vv)
      c#ac>open(>1.0vv <1.0vv)
      ab:bc[a]:ac<ack(id:>1.1 vv)
      a,b#ac>open(>1.1vv)
      ac>!req_end(!!) a#ac>closing(>1.2) b,c#ac>open(!id:>1.2)
      ab[c]:ac>req_end(id:>1.2) a#ac>closing(>1.2) c#ac>open(!id:>1.2)
      b#ac>closing(>1.2)
      bc:ab[c]:ac>req_end(id:>1.2) a#ac>closing(>1.2) b#ac>closing(>1.2)
      ab<ack(id:>1.2) a#ac>closing(>1.2v) b#ac>closing(>1.2) c#ac>close(>1.2vv)
      c#ac>close(>1.2vv)
      bc[a]:ac<ack(id:>1.2 vv)
      ab:bc[a]:ac<ack(id:>1.2 vv)
      a,b,c#ac>close(>1.2vv)
      // XXX: fix bug in req state handling (it doesn't use ack)
      20s a>*fail(id:1 seq:1 error:timeout)`);
    t('3_nodes_auto', `mode:msg conf(!msg_delay a-c rtt:50) ab>!connect
      bc>!connect cb.a~c>!ring_join ab.c~a>!ring_join ba.bc~b>!ring_join
      abc>!req(body:ping res:ping_r) a#!id:1 b#!id:1 c#!id:1
      ac>!req_start(id:1 !!) a#ac>opening(>1.0) b,c#same
      ab[c]:ac>req_start(id:1.0) a#ac>opening(>1.0v) b#ac>opening(>1.0) c#same
      bc:ab[c]:ac>req_start(id:1.0) a,b,c#ac>open(>1.0vv)
      ac<!res_start(id:1 !!) a,b#ac>open(!id:<1.0) c#ac>open(<1.0)
      bc[a]:ac<res_start(id:1.0)
      a#ac>open(!id:<1.0) b#ac>open(<1.0) c#ac>open(<1.0v)
      ab:bc[a]:ac<res_start(id:1.0) a,b,c#ac>open(<1.0vv)
      ac>!req_next(!!) a#ac>open(>1.1) b,c#ac>open(!id:>1.1)
      ab[c]:ac>req_next(id:1.1)
      a#ac>open(>1.1v) b#ac>open(>1.1) c#ac>open(!id:>1.1)
      bc:ab[c]:ac>req_next(id:1.1) a,b,c#ac>open(>1.1vv)
      ac>!req_end(!!) a#ac>closing(>1.2) b,c#ac>open(!id:>1.2)
      ab[c]:ac>req_end(id:>1.2)
      a#ac>closing(>1.2v) b#ac>closing(>1.2) c#ac>open(!id:>1.2)
      bc:ab[c]:ac>req_end(id:>1.2) a,b,c#ac>close(>1.2vv)
      // XXX: fix bug in req state handling (it doesn't use ack)
      20s a>*fail(id:1 seq:1 error:timeout)
    `);
    t('fuzzy_manual', `mode:msg conf(!msg_delay a-c rtt:50 !autoack)
      ab>!connect bc>!connect
      a,b,c#!id:1 c~c>!ring_join(id:1) a,b#!id:1 c#c~c>opening(id:>1.0)
      cb{b-b}:c~c>req(id:1 cmd:ring_join) a#!id:1 b,c#c~c>opening(id:>1.0)
      ba{b-a}:cb{b-b}:c~c>req(id:1 cmd:ring_join)
      cb<ack(id:>1.0) a#c~c>closing(id:>1.0vv) b#c~c>opening(id:>1.0)
      c#c~c>opening(id:>1.0v)
      a#c~c>closing(id:>1.0vv) b#c~c>opening(id:>1.0) c#c~c>opening(id:>1.0v)
      ba[c]:ca<ack(id:>1.0 vv)
      cb:ba[c]:ca<ack(id:>1.0 vv)
      a#c~c>closing(id:>1.0vv) b#c~c>open(id:>1.0vv) c#c~c>open(id:>1.0vv)
      ba[c]:ca<res(id:1 cmd:ring_join)
      a,b#c~c>closing(id:<1.0) c#c~c>open(!id:<1.0)
      cb:ba[c]:ca<res(id:1 cmd:ring_join)
      ba>ack(id:<1.0) a#c~c>closing(id:<1.0v) b#c~c>closing(id:<1.0)
      c#c~c>close(id:<1.0vv)
      a#c~c>closing(id:<1.0v) b#c~c>closing(id:<1.0) c#c~c>close(id:<1.0vv)
      cb[a]:ca>ack(id:<1.0 vv)
      ba:cb[a]:ca>ack(id:<1.0 vv)
      a,b,c#c~c>close(id:<1.0vv)
      // XXX TODO: ab.c~a>!ring_join ba.bc~b>!ring_join
    `);
    t('fuzzy_auto', `mode:msg conf(!msg_delay a-c rtt:50) ab>!connect
      bc>!connect a,b,c#!id:1 c~c>!ring_join(id:1) a,b#!id:1
      c#c~c>opening(id:>1.0) cb{b-b}:c~c>req(id:1 cmd:ring_join)
      a#!id:1 b#c~c>opening(id:>1.0) c#c~c>opening(id:>1.0v)
      ba{b-a,vv}:cb{b-b}:c~c>req(id:1 cmd:ring_join)
      a#c~c>closing(id:>1.0vv) b#c~c>open(id:>1.0vv) c#c~c>open(id:>1.0vv)
      ba[c]:ca<res(id:1 cmd:ring_join)
      a#c~c>closing(id:<1.0v) b#c~c>closing(id:<1.0) c#c~c>open(!id:<1.0)
      cb:ba[c,vv]:ca<res(id:1 cmd:ring_join) a,b,c#c~c>close(id:<1.0vv)
      // XXX TODO: ab.c~a>!ring_join ba.bc~b>!ring_join
    `);
    if (true) return; // XXX WIP
    // XXX: update rtt on each ack (and how to handle time diff 0)?
    t('xxx', `conf(rtt:50)
      !abc>!req // teach rtt
      ac>!req_start
      ab[c]:ac>req_start(id:>1.1)
      a#ac>opening(id:>1.1)
      // a#ab[c]:ac>opening(id:>1.1) b# c#
      ab<ack(id:>1.1) a#abc>opening(id:>1.1+) b#abc:ac>opening(id:>1.1)
      bc:ab[c]:ac>req_start c#abc>opening(id:>1.1v)
      abc:bc<ack(id:>1.1V)
      ab<ack(id:>
      bc[a]:ac<res_start
      bc>ack
      ab:bc[a]:ac<res_start
      ab>ack

      200ms
      ab<noack(bc(t:200)) // what's the threshold for noack
      // XXX: 1. what is the state now? 2. when/how notify a that bc didn't ack
      10ms
      bc<ack
      ab<ack(bc(rtt:210))
      ac<!res_start
      bc[a]:ac<res_start bc>ack
      // XXX: what is the state now?
      ab:bc:ac<res_start ab>ack
      ac>!req_next
      ab:ac>req_next ab<ack
      bc:ab:ac>req_next 200ms
      // XXX: what is the state now?
      20s a*>fail
      // XXX: what is the state now?
    `);
    // test_vc(ac(open ab:50 bc:no_ack:200))
  });
  describe('ack_rtt', function(){
    let t = (name, test)=>t_roles(name, 'ab', test);
    t('time_manual', `conf(!auto_time) #ms 1ms #1ms 10ms #10ms 1ms #ms 1ms
      #1ms`);
    t('time_auto', `conf(auto_time) #ms 1ms #1ms 10ms #10ms 1ms #ms 1ms #1ms`);
    // XXX: auto-calc ack params (id, vv) in order to simplify test writing)
    // XXX: decide if need support for msg_delay without auto_time
    // XXX: ab>req(cmd:connect) --> ab>connect
    t('2_nodes_connect_manual_time', `conf(!auto_time msg_delay a-b rtt:200)
      ab>!connect:!! ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect)
      100ms ab<ack ab>ack
      100ms a#rtt(b:200) b#rtt(a:200)`);
    t('2_nodes_connect_auto_time', `conf(auto_time msg_delay a-b rtt:200)
      #ms ab>!connect:!!
      #0ms   ab>msg(type:req cmd:connect) + ab<msg(type:req cmd:connect)
      #100ms ab<ack + ab>ack
      #100ms a#rtt(b:200) b#rtt(a:200)`);
    t('2_nodes_connect_shortcut_manual_time', `
      conf(!auto_time msg_delay a-b rtt:200) #ms
      ab>!connect #200ms a#rtt(b:200) b#rtt(a:200)`);
    t('2_nodes_connect_shortcut_auto_time', `
      conf(auto_time msg_delay a-b rtt:200) #ms
      ab>!connect #200ms a#rtt(b:200) b#rtt(a:200)`);
    t('2_nodes_autoack_auto_time', `
      conf(auto_time msg_delay a-b rtt:200)
      #ms ab>!connect()
      #200ms ab>!ping(id:1 !!)
      #0ms   ab>ping(id:1.0) ab>*ping
      #100ms a#ab>opening(>1.0) ab<ping_r(id:1.0) ab<*ping_r
      #100ms a#rtt(>1.0 200)
      100ms b#rtt(<1.0 200) a#rtt(b:200) b#rtt(a:200)
      a#ab>close(>1.0vv)
      conf(rtt:100) #ms a#rtt(b:200) b#rtt(a:200)
      ab>!ping(id:2 !!)
      #0ms  ab>ping(id:2.0) ab>*ping
      #50ms a#ab>opening(>2.0) ab<ping_r(id:2.0) ab<*ping_r
      #50ms a#rtt(>2.0 100) 50ms b#rtt(<2.0 100) a#rtt(b:100) b#rtt(a:100)
      a#ab>close(>2.0vv)
      100ms // a#ab>close(>2.0vv)`);
    t('2_nodes_autoack_manual_time', `conf(!auto_time msg_delay a-b rtt:200)
      ab>!connect() #ms
      ab>!ping(id:1 !!)
      ab>ping(id:1.0) 100ms ab>*ping a#ab>opening(>1.0)
      ab<ping_r(id:1.0) 100ms ab<*ping_r a#ab>close(>1.0vv)
      a#rtt(>1.0 200) 100ms b#rtt(<1.0 200) a#rtt(b:200) b#rtt(a:200)
      conf(rtt:100) a#rtt(b:200) b#rtt(a:200)
      ab>!ping(id:2 !!)
      ab>ping(id:2.0) 50ms ab>*ping a#ab>opening(>2.0)
      ab<ping_r(id:2.0) 50ms ab<*ping_r a#ab>close(>2.0vv)
      a#rtt(>2.0 100) 50ms b#rtt(<2.0 100) a#rtt(b:100) b#rtt(a:100)`);
    t('2_nodes_manualack_auto_time', `
      conf(auto_time msg_delay !autoack a-b rtt:200) #ms ab>!connect() #200ms
      #0ms   ab>!ping(id:1 !!) ab>ping(id:1.0)
      #100ms ab>*ping + ab<ack(id:>1.0 vv) + ab<ping_r(id:1.0)
      #100ms ab<*ping_r a#rtt(>1.0 200) ab>ack(id:<1.0 vv)
      #100ms b#rtt(<1.0 200)`);
    t('2_nodes_manualack_manual_time', `
      conf(msg_delay !auto_time !autoack a-b rtt:200)
      #ms ab>!connect() #200ms ab>!ping(id:1 !!)
      ab>ping(id:1.0)
      100ms ab>*ping ab<ack(id:>1.0 vv) ab<ping_r(id:1.0)
      100ms ab<*ping_r ab>ack(id:<1.0 vv) a#rtt(>1.0 200)
      100ms b#rtt(<1.0 200)`);
    t = (name, test)=>t_roles(name, 'abc', test);
    t('3_nodes_autoack_auto_time', `conf(auto_time msg_delay a-d rtt:200)
      !ring(a-d) #ms ac>!ping(id:1 !!) #0ms ab:ac>ping(id:1.0) #100ms
      bc:ab:ac>ping(id:1.0) ac>*ping #100ms bc[a]:ac<ping_r(id:1.0) #100ms
      ab:bc[a]:ac<ping_r(id:1.0) ac<*ping_r #100ms a#rtt(b:200) b#rtt(a:200)
      b#rtt(c:200) c#rtt(b:200) conf(rtt:100) ac>!ping(id:2 !!) #0ms
      ab[c]:ac>ping(id:2.0) #50ms a#rtt(b:200) b#rtt(a:200) b#rtt(c:200)
      c#rtt(b:200) bc:ab[c]:ac>ping(id:2.0) ac>*ping #50ms a#rtt(b:100)
      b#rtt(a:200) b#rtt(c:200) c#rtt(b:200)
      bc[a]:ac<ping_r(id:2.0) #50ms
      a#rtt(b:100) b#rtt(a:100) b#rtt(c:200) c#rtt(b:200)
      ab:bc[a]:ac<ping_r(id:2.0) ac<*ping_r #50ms
      a#rtt(b:100) b#rtt(a:100) b#rtt(c:200) c#rtt(b:100)
      50ms a#rtt(b:100) b#rtt(a:100) b#rtt(c:100) c#rtt(b:100)`);
    t('3_nodes_autoack_manual_time_multi_rtt', `
      conf(!auto_time msg_delay a-d rtt(200 bc:20)) !ring(a-d)
      ac>!ping(id:1 !!)
      0ms    ab:ac>ping(id:1.0)
      100ms  bc:ab:ac>ping(id:1.0)
      10ms   ac>*ping bc[a]:ac<ping_r(id:1.0)
      10ms   ab:bc[a]:ac<ping_r(id:1.0)
      100ms ac<*ping_r a#rtt(>1.0 200) b#rtt(>1.0 20) c#rtt(>1.0 0)
      100ms a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 20)`);
    t('3_nodes_autoack_auto_time_multi_rtt', `
      conf(msg_delay a-d rtt(200 bc:20)) !ring(a-d)
      #ms     ac>!ping(id:1 !!)
      #0ms    ab:ac>ping(id:1.0)
      #100ms  bc:ab:ac>ping(id:1.0)
      #10ms   ac>*ping bc[a]:ac<ping_r(id:1.0)
      #10ms   ab:bc[a]:ac<ping_r(id:1.0)
      #100ms  ac<*ping_r
      a#rtt(>1.0 200) b#rtt(>1.0 20) c#rtt(>1.0 0)
      100ms a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 20)`);
    t('3_nodes_manualack_auto_time', `
      conf(!autoack auto_time msg_delay a-d rtt:200) !ring(a-d) #ms
      ac>!ping(id:1 !!) #0ms
      ab:ac>ping(id:1.0) #100ms
      bc:ab:ac>ping(id:1.0) + ab<ack(id:>1.0) ac>*ping #100ms
      bc[a]:ac<ack(id:>1.0 vv) + bc[a]:ac<ping_r(id:1.0) #100ms
      ab:bc[a]:ac<ack(id:>1.0 vv) + ab:bc[a]:ac<ping_r(id:1.0) +
      bc>ack(id:<1.0) ac<*ping_r #100ms
      ab[c]:ac>ack(id:<1.0 vv) #100ms
      bc:ab[c]:ac>ack(id:<1.0 vv) #100ms
      a#rtt(>1.0 200) b#rtt(>1.0 200) c#rtt(>1.0 0)
      a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 200)
      conf(rtt:100) ac>!ping(id:2 !!) #0ms ab[c]:ac>ping(id:2.0) #50ms
      bc:ab[c]:ac>ping(id:2.0) + ab<ack(id:>2.0) ac>*ping #50ms
      bc[a]:ac<ack(id:>2.0 vv) + bc[a]:ac<ping_r(id:2.0) #50ms
      ab:bc[a]:ac<ack(id:>2.0 vv) + ab:bc[a]:ac<ping_r(id:2.0) +
      bc>ack(id:<2.0) ac<*ping_r #50ms
      ab[c]:ac>ack(id:<2.0 vv) #50ms bc:ab[c]:ac>ack(id:<2.0 vv) #50ms
      a#rtt(>2.0 100) b#rtt(>2.0 100) c#rtt(>2.0 0)
      a#rtt(<2.0 0) b#rtt(<2.0 100) c#rtt(<2.0 100)
      a#rtt(b:100) b#rtt(a:100) b#rtt(c:100) c#rtt(b:100)`);
    t('3_nodes_manualack_auto_time_multi_rtt', `
      conf(!autoack auto_time msg_delay a-d rtt(200 bc:20)) !ring(a-d) #ms
      #ms    ac>!ping(id:1 !!)
      #0ms   ab:ac>ping(id:1.0)
      #100ms bc:ab:ac>ping(id:1.0) + ab<ack(id:>1.0)
      10ms + ac>*ping + bc[a]:ac<ack(id:>1.0 vv) +
             bc[a]:ac<ping_r(id:1.0)
      10ms + ab:bc[a]:ac<ack(id:>1.0 vv) + ab:bc[a]:ac<ping_r(id:1.0) +
             bc>ack(id:<1.0)
      100ms  #120ms ac<*ping_r ab[c]:ac>ack(id:<1.0 vv)
      #100ms bc:ab[c]:ac>ack(id:<1.0 vv)
      #10ms  a#rtt(>1.0 200) b#rtt(>1.0 20) c#rtt(>1.0 0)
             a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 20)`);
    t('3_nodes_manualack_auto_time_multi_rtt2', `
      conf(!autoack msg_delay a-d rtt(200 ab:20)) !ring(a-d)
      #ms     ac>!ping(id:1 !!) ab:ac>ping(id:1.0)
      #10ms   bc:ab:ac>ping(id:1.0) + ab<ack(id:>1.0)
      100ms + ac>*ping bc[a]:ac<ack(id:>1.0 vv) + bc[a]:ac<ping_r(id:1.0)
      100ms + ab:bc[a]:ac<ack(id:>1.0 vv) + ab:bc[a]:ac<ping_r(id:1.0) +
              bc>ack(id:<1.0)
      10ms  + ac<*ping_r + ab[c]:ac>ack(id:<1.0 vv)
      10ms  + bc:ab[c]:ac>ack(id:<1.0 vv)
              a#rtt(>1.0 20) b#rtt(>1.0 200) c#rtt(>1.0 0)
      100ms a#rtt(<1.0 0) b#rtt(<1.0 20) c#rtt(<1.0 200)`);
    t('3_nodes_manualack_manual_time', `
      conf(!autoack msg_delay !auto_time a-d rtt(200 bc:200)) !ring(a-d) #ms
      ac>!ping(id:1 !!) ab:ac>ping(id:1.0)
      100ms bc:ab:ac>ping(id:1.0) ab<ack(id:>1.0)
      100ms ac>*ping bc[a]:ac<ack(id:>1.0 vv) bc[a]:ac<ping_r(id:1.0)
      100ms ab:bc[a]:ac<ack(id:>1.0 vv) ab:bc[a]:ac<ping_r(id:1.0)
            bc>ack(id:<1.0)
      100ms ac<*ping_r ab[c]:ac>ack(id:<1.0 vv)
      100ms bc:ab[c]:ac>ack(id:<1.0 vv)
      100ms a#rtt(>1.0 200) b#rtt(>1.0 200) c#rtt(>1.0 0)
            a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 200)`);
    t('3_nodes_manualack_manual_time_multi_rtt', `
      conf(!autoack msg_delay !auto_time a-d rtt(200 bc:20)) !ring(a-d)
            ac>!ping(id:1 !!) ab:ac>ping(id:1.0)
      100ms bc:ab:ac>ping(id:1.0) ab<ack(id:>1.0)
      10ms  ac>*ping bc[a]:ac<ack(id:>1.0 vv) bc[a]:ac<ping_r(id:1.0)
      10ms  ab:bc[a]:ac<ack(id:>1.0 vv) ab:bc[a]:ac<ping_r(id:1.0)
            bc>ack(id:<1.0)
      100ms ac<*ping_r ab[c]:ac>ack(id:<1.0 vv)
      100ms bc:ab[c]:ac>ack(id:<1.0 vv)
      a#rtt(>1.0 200) b#rtt(>1.0 20) c#rtt(>1.0 0)
      a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 20)`);
    t('3_nodes_manualack_manual_time_multi_rtt2', `
      conf(!autoack msg_delay !auto_time a-d rtt(200 ab:20)) !ring(a-d)
            ac>!ping(id:1 !!) ab:ac>ping(id:1.0)
      10ms  bc:ab:ac>ping(id:1.0) ab<ack(id:>1.0)
      100ms ac>*ping bc[a]:ac<ack(id:>1.0 vv) bc[a]:ac<ping_r(id:1.0)
      100ms ab:bc[a]:ac<ack(id:>1.0 vv) ab:bc[a]:ac<ping_r(id:1.0)
            bc>ack(id:<1.0)
      10ms  ac<*ping_r ab[c]:ac>ack(id:<1.0 vv)
      10ms  bc:ab[c]:ac>ack(id:<1.0 vv)
            a#rtt(>1.0 20) b#rtt(>1.0 200) c#rtt(>1.0 0)
      100ms a#rtt(<1.0 0) b#rtt(<1.0 20) c#rtt(<1.0 200)`);
    t('3_nodes_parallel_autoack_auto_time', `
      conf(msg_delay auto_time a-d rtt:200) !ring(a-d) #ms ac>!ping(id:1 !!)
      ab:ac>ping(id:1.0) 50ms + #50ms + ac>!ping(id:2 !!) + ab:ac>ping(id:2.0)
      50ms + bc:ab:ac>ping(id:1.0)
      50ms + bc:ab:ac>ping(id:2.0)
      50ms + ac>*ping(id:1.0) + bc[a]:ac<ping_r(id:1.0)
      50ms + ac>*ping(id:2.0) + bc[a]:ac<ping_r(id:2.0)
      50ms + ab:bc[a]:ac<ping_r(id:1.0)
      50ms + ab:bc[a]:ac<ping_r(id:2.0)
      50ms + ac<*ping_r(id:1.0)
      50ms + ac<*ping_r(id:2.0)`);
    t('3_nodes_parallel_autoack_manual_time', `
      conf(msg_delay !auto_time a-d rtt:200) !ring(a-d)
      ac>!ping(id:1 !!) ab:ac>ping(id:1.0)
      50ms ac>!ping(id:2 !!) ab:ac>ping(id:2.0)
      50ms bc:ab:ac>ping(id:1.0)
      50ms bc:ab:ac>ping(id:2.0)
      50ms ac>*ping(id:1.0) bc[a]:ac<ping_r(id:1.0)
      50ms ac>*ping(id:2.0) bc[a]:ac<ping_r(id:2.0)
      50ms ab:bc[a]:ac<ping_r(id:1.0)
      50ms ab:bc[a]:ac<ping_r(id:2.0)
      50ms ac<*ping_r(id:1.0)
      50ms ac<*ping_r(id:2.0)`);
    t('2_nodes_shortcut_auto_time', `conf(a-b rtt:200)
      #ms ab>!connect #200ms ab>!ping #200ms`);
    t('2_nodes_shortcut_manual_time', `conf(!auto_time a-b rtt:200)
      #ms ab>!connect #200ms ab>!ping #200ms`);
    t('3_nodes_shortcut_auto_time', `conf(auto_time msg_delay a-d rtt:200)
      !ring(a-d) #ms abc>!ping(rt:bc) #400ms`);
    t('3_nodes_shortcut_manual_time', `conf(!auto_time msg_delay a-d rtt:200)
      !ring(a-d) #ms abc>!ping(rt:bc) #400ms`);
    t = (name, test)=>t_roles(name, 'ab', test);
    t('zzz_2_nodes_manualack_manual_time', `
      conf(emit_ack !auto_time !autoack a-b rtt:200)
      ab>!connect() ab>!ping(id:1 !!) ab>ping(id:1.0)
      100ms ab>*ping ab<ack(id:>1.0 vv) ab<ping_r(id:1.0)
      100ms ab<ack(id:>1.0 vv rx)
            ab<*ping_r ab>ack(id:<1.0 vv)
      100ms ab>ack(id:<1.0 vv rx)`);
    t('zzz_2_nodes_autoack_manual_time', `conf(emit_ack !auto_time a-b rtt:200)
      ab>!connect() ab>!ping(id:1 !!) ab>ping(id:1.0)
      100ms ab>*ping ab<ping_r(id:1.0)
      100ms ab<ack(id:>1.0 vv rx) ab<*ping_r
      100ms ab>ack(id:<1.0 vv rx)`);
    t = (name, test)=>t_roles(name, 'abc', test);
    if (Router.t.xxx_rt) // XXX WIP
    t('zzz0_manual', `
      conf(emit_ack !autoack !auto_time a-d rtt(200 bc:20)) !ring(a-d)
      ac>!ping(id:1 !!) ab:ac>ping(id:1.0)
      100ms bc:ab:ac>ping(id:1.0) ab<ack(id:>1.0 body(rt:c))
      10ms  ac>*ping bc[a]:ac<ack(id:>1.0 vv) bc[a]:ac<ping_r(id:1.0)
      10ms  bc[a]:ac<ack(id:>1.0 vv rx) ab:bc[a]:ac<ack(id:>1.0 vv)
            ab:bc[a]:ac<ping_r(id:1.0) bc>ack(id:<1.0)
      10ms  bc>ack(id:<1.0 rx)
      70ms  ab<ack(id:>1.0 body(rt:c) rx)
      20ms ab:bc[a]:ac<ack(id:>1.0 vv rx) ac<*ping_r ab[c]:ac>ack(id:<1.0 vv)
      100ms ab[c]:ac>ack(id:<1.0 vv rx) bc:ab[c]:ac>ack(id:<1.0 vv)
      10ms bc:ab[c]:ac>ack(id:<1.0 vv rx)
      a#rtt(>1.0 200) b#rtt(>1.0 20) c#rtt(>1.0 0)
      a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 20)`);
    // if (Router.t.xxx_rt) // XXX WIP
    t('zzz0_auto', `
      conf(emit_ack !auto_time a-d rtt(200 bc:20)) !ring(a-d) #ms
      ac>!ping(id:1 !!) ab:ac>ping(id:1.0)
      100ms  #100ms bc:ab:ac>ping(id:1.0)
      10ms   #10ms ac>*ping bc[a]:ac<ping_r(id:1.0)
      10ms   #10ms bc[a]:ac<ack(id:>1.0 vv rx) ab:bc[a]:ac<ping_r(id:1.0)
      10ms  #10ms bc>ack(id:<1.0 rx)
      70ms  ab<ack(id:>1.0 rx)
      20ms ab:bc[a]:ac<ack(id:>1.0 vv rx) ac<*ping_r
      100ms ab[c]:ac>ack(id:<1.0 vv rx)
      10ms bc:ab[c]:ac>ack(id:<1.0 vv rx)
      a#rtt(>1.0 200) b#rtt(>1.0 20) c#rtt(>1.0 0)
      a#rtt(<1.0 0) b#rtt(<1.0 200) c#rtt(<1.0 20)`);
    if (0) // XXX derry: support it?
    // 100ms ab:ac>ping 100ms bc:ab:ac>ping ...
    t('3_nodes_shortcut_manual_time', `conf(msg_delay a-d rtt:200) !ring(a-d)
      #ms 400ms ab.c>!ping`);
    // XXX test fuzzy
  });
  describe('timing_errors', function(){
    let t = (name, test)=>t_roles(name, 'ab', test);
    t('manual_on_time', `conf(!auto_time msg_delay a-b rtt:200)
      ab>!connect:!! ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect)
      100ms ab<ack ab>ack 100ms a#rtt(b:200) b#rtt(a:200)`);
    if (1) return; // XXX: WIP
    let xit = (name, role, exp_err, test)=>it(name+'_'+role,
      ()=>test_run(role, test, exp_err));
    xit('manual_early', 'a', /time moved without explicit cmd/,
      `conf(!auto_time msg_delay a-b rtt:200)
      ab>!connect:!! ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect)
      99ms ab<ack ab>ack 100ms a#rtt(b:200) b#rtt(a:200)`);
    xit('manual_late', 'a', /.*/, `conf(!auto_time msg_delay a-b rtt:200)
      ab>!connect:!! ab>msg(type:req cmd:connect) ab<msg(type:req cmd:connect)
      101ms ab<ack ab>ack 100ms a#rtt(b:200) b#rtt(a:200)`);
  });
});

