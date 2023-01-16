// author: derry. coder: arik.
'use strict';
import {EventEmitter} from 'events';
import assert from 'assert';
import date from '../util/date.js';
import xescape from '../util/escape.js';
import etask from '../util/etask.js';
import util from '../util/util.js';
import xlog from '../util/xlog.js';
import NodeId from './node_id.js';
import {dbg_sd, dbg_msg} from './util.js';
const log = xlog('req');
const assign = Object.assign;
const REQ_TIMEOUT = 20*date.ms.SEC;

const reqs = {};
let free_req_id = util.is_mocha() ? 10000 : 1;

function res_handler(lbuffer){
  let msg = lbuffer.msg(); // XXX WIP
  let {req_id, type, seq} = msg;
  seq = seq||0;
  if (!req_id || !['res', 'res_start', 'res_next', 'res_end'].includes(type))
    return;
  // XXX: if final response, remove from this.reqs
  if (!reqs[req_id]) // XXX: change to LERR
    return log('req not found %s', req_id);
  if (!Number.isInteger(seq) || seq<0)
    return log('invalid seq '+seq);
  log.debug('msg %s', dbg_msg(msg));
  let req = reqs[req_id].req;
  if (req.ack.find(s=>s==seq)!==undefined)
    log('duplicated seq '+seq);
  else
    req.ack.push(seq);
  if (type=='res')
    req.close();
  else if (msg.ack)
    req.clr_timeout(msg.ack);
  if (Req.t.res_hook) // XXX NOW: mv to emit_ooo
    Req.t.res_hook(msg);
  req.emit_ooo(msg);
  req.emit_ooo_queue();
}

function del_req(req_id){
  let req = util.get(reqs, [req_id, 'req']);
  if (!req)
    return;
  req.clr_timeout();
  delete reqs[req_id];
}

function destroy_cb(){
  for (let id in reqs){
    let req = reqs[id].req;
    if (req.node===this)
      del_req(id);
  }
}

// XXX: Req/Req_handler are very similar. unite code
export default class Req extends EventEmitter {
  constructor(opt){
    super();
    let {node, dst, fuzzy, stream, req_id, cmd, timeout, rt} = opt;
    assert(node, 'must provide node');
    assert(dst, 'must provide dst');
    assert(!fuzzy || !stream, 'fuzzy dst cannot be used with stream');
    this.node = node;
    let router = this.router = node.router;
    // XXX: replace src/dst with NodeId
    this.src = node.id.b;
    this.dst = NodeId.from(dst).s;
    this.fuzzy = fuzzy;
    this.cmd = cmd;
    this.stream = stream;
    this.timeout = timeout = timeout||REQ_TIMEOUT;
    this.seq = 0;
    this.rt = rt;
    this.ack = [];
    this.sent = {};
    this.ooo = {};
    assert(util.is_mocha() || !req_id, 'manual req_id only in tests '+req_id);
    req_id = req_id || ''+free_req_id++;
    reqs[req_id] = {req: this};
    this.req_id = req_id; // XXX: change to id
    if (!router.res_handler_attached){ // XXX: cleanup
      router.on('message', res_handler);
      node.once('destroy', destroy_cb);
      router.res_handler_attached = true;
    }
  }
  send_end(opt, body){ return this.send(assign({}, opt, {end: true}), body); }
  send_close(opt, body){
    body = body||''; // XXX: rm
    return this.send(assign({}, opt, {close: true}), body); }
  send(opt, body){
    if (arguments.length<2){
      body = opt;
      opt = {};
    }
    opt = opt||{};
    let {req_id, ack, cmd, rt, fuzzy} = this;
    let ts=date.monotonic(), seq = this.seq++;
    if (util.is_mocha() && opt.seq)
      seq = opt.seq;
    let type = !this.stream ? 'req' : opt.end||opt.close ? 'req_end' : !seq ?
      'req_start' : 'req_next';
    if (opt.ack){
      ack = opt.ack;
      this.ack = this.ack.filter(s=>!ack.find(
        s2=>new RegExp('^'+xescape.regex(''+s)+'$').test(s2)));
    } else
      this.ack = [];
    log.debug('send %s %s %s %s:%s', dbg_sd(this.src, this.dst),
      cmd, type, req_id, seq);
    let msg = {ts, fuzzy, type, req_id, seq, ack, cmd, body};
    if (rt)
      msg.rt = rt;
    if (!opt.close)
      this.set_timeout(seq);
    this.router.send_msg(this.dst, msg);
    if (opt.close)
      this.close();
  }
  set_timeout(seq){
    let {req_id, timeout} = this;
    assert(!this.sent[seq], 'timeout already set '+seq);
    this.sent[seq] = {};
    this.sent[seq].et_timeout = etask({_: this}, function*req_timeout(){
      yield etask.sleep(timeout);
      delete this._.sent[seq];
      if (Req.t.fail_hook) // XXX NOW: mv to emit_ooo
        Req.t.fail_hook({error: 'timeout', req_id, seq, req: this._});
      this._.emit('fail', {error: 'timeout', req_id, seq});
      // XXX: support per-req timeout and allow to specify if fatal or retry
      // XXX: close req
      del_req(req_id);
    });
  }
  close(){ del_req(this.req_id); }
  clr_timeout(ack){
    ack = ack || Object.keys(this.sent);
    ack.forEach(seq=>{
      if (!this.sent[seq])
        return;
      this.sent[seq].et_timeout.return();
      delete this.sent[seq];
    });
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
    if (this.res_seq===undefined){
      if (seq==0)
        this.res_seq = 0;
      else
        opt = this.push_ooo(msg);
    } else {
      if (seq==this.res_seq+1)
        this.res_seq++;
      else if (seq<this.res_seq+1)
        opt = {dup: true};
      else
        opt = this.push_ooo(msg);
    }
    this.emit(type, msg, opt);
  }
  emit_ooo_queue(){
    for (let msg, seq; seq=this.res_seq+1, msg=this.ooo[seq];){
      delete this.ooo[seq];
      this.emit_ooo(msg);
    }
  }
}

Req.etask = function(opt){
  return etask(function req_etask(){
    let req = this.req = new Req(opt);
    req.on('res', (o, opt)=>this.continue({o, opt}));
    req.on('error', err=>this.throw(err));
    req.send('');
    return this.wait();
  });
};

Req.t = {reqs, res_handler};
