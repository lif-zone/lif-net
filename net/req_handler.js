// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import {EventEmitter} from 'events';
import util from '../util/util.js';
import NodeId from './node_id.js';
import xerr from '../util/xerr.js';
import xescape from '../util/escape.js';
import date from '../util/date.js';
import etask from '../util/etask.js';
const assign = Object.assign;
const RES_TIMEOUT = 20*date.ms.SEC;

const nodes = {};

// XXX: need to close and also proper cleanup when node is destroyed
function destroy_cb(){ delete nodes[this.id.s]; }

// XXX: Req/Req_handler are very similar. unite code
class Res extends EventEmitter {
  constructor(opt){
    super();
    this.req_handler = opt.req_handler;
    this.timeout = this.req_handler.timeout;
    this.router = this.req_handler.router;
    this.node = this.req_handler.node;
    this.cmd = this.req_handler.cmd;
    this.dst = NodeId.from(opt.from);
    this.stream = opt.stream;
    this.req_id = opt.req_id;
    this.seq = 0;
    this.ack = [];
    this.sent = {};
    this.ooo = {};
    if (ReqHandler.t_new_res_hook)
      ReqHandler.t_new_res_hook(this);
  }
  send_end(opt, body){ return this.send(assign({}, opt, {end: true}), body); }
  send_close(opt, body){ return this.send(assign({}, opt, {close: true}),
    body); }
  send(opt, body){
    if (arguments.length<2){
      body = opt;
      opt = {};
    }
    opt = opt||{};
    let ts=date.monotonic(), seq = this.seq++, type;
    let {dst, req_id, ack, cmd, req_handler} = this;
    let rt = req_handler.rt;
    if (opt.ack){
      ack = opt.ack;
      this.ack = this.ack.filter(s=>!ack.find(
        s2=>new RegExp('^'+xescape.regex(''+s)+'$').test(s2)));
    }
    else
      this.ack = [];
    if (util.is_mocha() && opt.seq)
      seq = opt.seq;
    if (!this.stream){
      type = 'res';
      if (seq)
        return xerr('multiple res req_id %s %s %s', req_id, type, cmd);
    } else
      type = opt.end||opt.close ? 'res_end' : !seq ? 'res_start' : 'res_next';
    if (!['res', 'res_end'].includes(type))
      this.set_timeout(seq);
    let msg = {ts, type, req_id, seq, ack, cmd, body, rt};
    this.router.send_msg(dst, msg); // XXX: what if error
    if (opt.close)
      this.close();
  }
  set_timeout(seq){
    let {req_id, timeout} = this;
    assert(!this.sent[seq], 'timeout already set '+seq);
    this.sent[seq] = {};
    this.sent[seq].et_timeout = etask({_: this}, function*res_timeout(){
      yield etask.sleep(timeout);
      delete this._.sent[seq];
      this._.emit('fail', {error: 'timeout', req_id, seq});
      // XXX: support per-req timeout and allow to specify if fatal or retry
      // XXX: close req
      this._.clr_timeout();
    });
  }
  clr_timeout(ack){
    ack = ack || Object.keys(this.sent);
    ack.forEach(seq=>{
      if (!this.sent[seq])
        return;
      this.sent[seq].et_timeout.return();
      delete this.sent[seq];
    });
  }
  close(){
    this.clr_timeout();
    util.unset(nodes, [this.req_handler.id, 'req_id', this.req_id, 'res']);
  }
  push_ooo(msg){
    let ret = {ooo: true};
    // XXX: do we want to limit queue max size
    if (this.ooo[msg.seq])
      ret.dup = true;
    this.ooo[msg.seq] = msg;
    return ret;
  }
  emit_ooo(msg){
    let opt, {type, seq} = msg;
    if (this.req_seq===undefined){
      if (seq==0)
        this.req_seq = 0;
      else
        opt = this.push_ooo(msg);
    }
    else {
      if (seq==this.req_seq+1)
        this.req_seq++;
      else if (seq<this.req_seq+1)
        opt = {dup: true};
      else {
        opt = this.push_ooo(msg);
      }
    }
    this.emit(type, msg, this, opt);
  }
  emit_ooo_queue(){
    for (let msg, seq; seq=this.req_seq+1, msg=this.ooo[seq];){
      delete this.ooo[seq];
      this.emit_ooo(msg);
    }
  }
}

function req_handler_cb(lbuffer){
  let msg = lbuffer.msg(); // XXX WIP
  let {req_id, type, cmd, seq} = msg;
  cmd = cmd||'';
  if (!req_id || !['req', 'req_start', 'req_next', 'req_end'].includes(type))
    return;
  seq = seq||0;
  if (!Number.isInteger(seq) || seq<0)
    return xerr('invalid seq '+seq);
  let id = this.id.s;
  if (!msg.fuzzy)
    assert.strictEqual(msg.to, id);
  let req_handler = util.get(nodes, [id, 'cmd', cmd, 'req_handler']);
  if (!req_handler)
    return;
  let path = Array.from(lbuffer.path());
  path.reverse();
  req_handler.rt = {path};
  let from_id = NodeId.from(msg.from).s;
  let res = util.get(nodes, [id, from_id, 'req_id', req_id, 'res']);
  if (!res){
    if (!['req', 'req_start'].includes(type))
      return xerr('req not started '+type);
    if (seq!=0)
      return xerr('invalid req start seq '+seq);
    res = new Res({req_handler, from: msg.from, req_id, stream: type!='req'});
    // XXX: need cleanup
    util.set(nodes, [id, from_id, 'req_id', req_id], {res});
  }
  if (res.ack.find(s=>s==seq)!==undefined)
    xerr('duplicated seq '+seq);
  else
    res.ack.push(seq);
  if (msg.ack)
    res.clr_timeout(msg.ack);
  if (ReqHandler.t.req_hook) // XXX NOW: move to emit_ooo
    ReqHandler.t.req_hook(lbuffer);
  if (['req', 'req_start'].includes(type)){
    let dup = res.req_seq==0;
    res.req_seq = 0;
    req_handler.emit(type, msg, res, {dup});
  } else {
    res.emit_ooo(msg);
    res.emit_ooo_queue();
  }
}

export default class ReqHandler extends EventEmitter {
  constructor(opt){
    super();
    let {node, timeout} = opt;
    let cmd = this.cmd = opt.cmd||'';
    let router = node.router;
    this.node = node;
    this.router = router;
    this.timeout = timeout||RES_TIMEOUT;
    let id = this.id = router.id.s;
    // XXX: need unregister + cleanup
    assert(!ReqHandler.has(id, cmd), 'handler already exists '+cmd);
    nodes[id] = nodes[id]||{cmd: {}};
    nodes[id].cmd[cmd] = {req_handler: this};
    if (!router.req_handler_attached){ // XXX: cleanup
      router.on('message', req_handler_cb);
      node.once('destroy', destroy_cb);
      router.req_handler_attached = true;
    }
  }
}

ReqHandler.get = function(id, cmd){
  return util.get(nodes, [NodeId.from(id).s, 'cmd', cmd]); };
ReqHandler.has = function(id, cmd){ return !!ReqHandler.get(id, cmd); };

ReqHandler.t = {nodes, req_handler_cb};
