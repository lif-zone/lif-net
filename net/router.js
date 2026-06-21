// author: derry. coder: arik.
'use strict';
import {EventEmitter} from 'events';
import assert from 'assert';
import xerr from '../util/xerr.js';
import NodeId from './node_id.js';
import * as util from './util.js';
import xutil from '../util/util.js';
import NodeMap from './node_map.js';
import {log_msg, dbg_msg} from './util.js';
import LBuffer from './lbuffer.js';
const stringify = JSON.stringify;
const DEF_RTT = 1000;

// XXX: need safe emit support
export default class Router extends EventEmitter {
  constructor(opt){
    super();
    let {channels, id, crypt, key, pub} = opt;
    this.crypt = crypt;
    this.key = key;
    this.pub = pub;
    this.id = id;
    this.msg_id_n = 0;
    this.concurrency = 1;
    this.maxHops = 20;
    // XXX: rm _ from properites + methods
    // XXX: memory leak - no cleanup for all
    this.node_map = new NodeMap();
    this.routes = {};
    this._queue = [];
    this._channels = channels;
    this.state = {};
    this.node = new NodeMap.Node({id, self: this});
    this.node_map.set(id, this.node);
    this._channels.on('added', channel=>this._onChannelAdded(channel));
    this._channels.on('removed', channel=>this._onChannelRemoved(channel));
    for (let c of this._channels.toArray())
      this._onChannelAdded(c);
  }
  msgid = function(){ return ++this.msg_id_n; };
  send_msg(dst, msg){
    let msgid = this.msgid();
    assert(!msg.msgid);
    dst = NodeId.from(dst);
    msg.from = this.id.s;
    msg.to = dst.s;
    msg.msgid = msgid; // XXX: need test that will fail is this is missing
    log_msg('router: msg>', msg);
    let lbuffer = new LBuffer(msg); // XXX: WIP
    this._send(lbuffer);
  }
  _send(lbuffer){
    this.ack_pending();
    if (!this._channels.size) // XXX: verify and test it
      return this._queue.push(lbuffer);
    let o = this.send_prepare(lbuffer);
    this.track(lbuffer, o?.vv);
    if (o?.channel)
      o.channel.send(lbuffer.to_str());
    else if (o?.vv)
      this.emit('message', lbuffer);
  }
  send_prepare = function(lbuffer){
    let channel, fwd_rt;
    let msg = lbuffer.msg(), msg0 = lbuffer.get_json(0), range;
    let rt = msg0.rt, path = rt?.path;
    let to = NodeId.from(msg.to), from = NodeId.from(msg.from), best;
    if (lbuffer.path().length >= this.maxHops)
      return xerr('router: drop msg max hop reached');
    if (msg.fuzzy){
      range = lbuffer.range();
      if (path){
        if (!(channel = this.get_channel_from_path(path)))
          return xerr('router: channel not found in route');
        if (0) // XXX: decide if to enable
        if (['req', 'req_start'].includes(msg.type) && rt?.opt!='!'){
          let rtt_pb_o = this.id.rtt_pb_via(to,
            NodeId.from(path[path.length-1]), this.calc_path_rtt(path));
          best = this.node_map.get_best_route(
            NodeId.from(path[path.length-1]));
          let path2 = best?.path;
          let channel2 = this.get_channel_from_path(path2);
          if (channel2 && path2 &&
            (!rtt_pb_o?.good || best.rtt_pb < rtt_pb_o.rtt_pb)){
            channel = channel2;
            path = path2;
          }
        }
      } else {
        best = this.node_map.get_route_by_range(to, from.eq(to) ? to :
          [from, to], range);
        path = best?.path;
        channel = this.get_channel_from_path(path);
        if (!channel)
          return {vv: true};
      }
      if (!path || path.length==1){
        if (!range)
          range = {min: channel.id, max: channel.id};
        else {
          let range2 = {min: channel.id, max: range.max};
          range = to.in_range(range2) ? range2 :
            {min: range.min, max: channel.id};
        }
      }
    } else {
      if (msg.cmd=='connect')
        channel = this.get_channel_from_id(to);
      else if (channel = this.get_channel_from_path(path)){
        // XXX WIP
        if (['req', 'req_start'].includes(msg.type) && rt?.opt!='!' &&
          msg.cmd!='connect'){
          // XXX: copy logic to fuzzy
          let rtt_pb_o = this.id.rtt_pb_via(to,
            NodeId.from(path[path.length-1]), this.calc_path_rtt(path));
          best = this.node_map.get_best_route(to);
          let path2 = best?.path;
          let channel2 = this.get_channel_from_path(path2);
          if (channel2 && path2 &&
            (!rtt_pb_o?.good || best.rtt_pb < rtt_pb_o.rtt_pb)){
            channel = channel2;
            path = path2;
          }
        }
      }
      // XXX: decide if we need short-path
      // else if (channel = this.get_channel_from_id(to));
      /* eslint-disable */
      else if ((path = this.get_route(msg.to)) &&
        (channel = this.get_channel_from_path(path))); /* eslint-enable */
      else {
        best = this.node_map.get_best_route(to);
        path = best?.path;
        if (!(channel = this.get_channel_from_path(path)))
          return;
      }
    }
    if (msg0.type=='fwd' || range || path?.length>1 || !channel.id.eq(to)){
      let msg2 = {from: this.id.s, to: channel.id.s, type: 'fwd',
        rtt: channel.rtt||DEF_RTT};
      if (!rt?.path && path) // XXX handle whith optional path as well
        fwd_rt = Array.from(path);
      if (path && path.length>1){
        path = Array.from(path);
        path.splice(0, 1);
        msg2.rt = {path, rtt: this.build_rtt_array(path)};
        if (rt?.opt)
          msg2.rt.opt = rt.opt;
      } else if (range)
        msg2.range = NodeId.range_to_msg(range);
      lbuffer.add_json(msg2);
    }
    return {channel, lbuffer, fwd_rt};
  };
  _on_msg = (data, channel)=>{
    let lbuffer = LBuffer.from(data), msg = lbuffer.msg();
    let msg0 = lbuffer.get_json(0), rt = msg0.rt, path = rt?.path;
    let msgid = msg.msgid;
    this.update_conn(lbuffer);
    this.emit('msg', lbuffer);
    if (!msgid && msg.type!='ack') // XXX: TODO ack
      return xerr('router: invalid message msgid %s', dbg_msg(msg));
    log_msg('router: <msg', msg);
    if (!path?.length && msg.to==this.id.s){
      assert(!this.pending_ack);
      if (msg.type!='ack')
        this.pending_ack = {channel, lbuffer, vv: true};
      this.track(lbuffer, true);
      this.emit('message', lbuffer);
      this.ack_pending();
    }
    else {
      this.track(lbuffer);
      let o = this.send_prepare(lbuffer), {fwd_rt} = o||{};
      this.track(lbuffer, o?.vv);
      if (o?.vv){
        if (msg.type!='ack')
          this.pending_ack = {channel, lbuffer, vv: true, fwd_rt};
        this.emit('message', lbuffer);
        this.ack_pending();
      } else {
        if (o?.channel)
          o.channel.send(lbuffer.to_str());
        if (msg.type!='ack')
          this.ack(channel, lbuffer, false, fwd_rt);
      }
    }
  };
  ack_pending(){
    if (!this.pending_ack)
      return;
    let pending = this.pending_ack;
    this.pending_ack = null;
    return this.ack(pending.channel, pending.lbuffer, pending.vv,
      pending.fwd_rt);
  }
  _onChannelAdded(channel){
    let dst = channel.id;
    this.node_map.update_conn({ids: [this.id, dst], self: channel,
      rtt: channel.rtt||DEF_RTT});
    channel.on('message', this._on_msg);
    // XXX: check if this can happen during test
    while (this._queue.length)
      this._send(this._queue.shift());
  }
  _onChannelRemoved = function(channel){
    let dst = channel.id, node = this.node_map.get(dst);
    node.del_conn(dst);
    channel.removeListener('message', this._on_msg);
  };
  get_channel_from_id(id){
    return this._channels.get(id.s);
  }
  get_channel_from_path(path){
    let dst = path && path[0] && NodeId.from(path[0]);
    if (!dst)
      return;
    return this.get_channel_from_id(dst);
  }
  get_route(d){
    let routes=this.routes;
    return routes[d] && routes[d][0];
  }
  has_route(path){
    let routes=this.routes, d=path[path.length-1];
    if (!routes[d])
      return false;
    return !!routes[d].find(_path=>path_eq(_path, path));
  }
  add_route(path){
    let routes=this.routes;
    assert(path[0]!=this.id.s, 'path contains self id '+stringify(path));
    let d = path[path.length-1];
    routes[d] = routes[d]||[];
    if (this.has_route(path))
      return;
    routes[d].push(Array.from(path));
  }
  update_conn_from_fwd(lbuffer){
    // XXX: mv logic to node_map.js
    let path = [], rtt = 0;
    for (let i=0; i<lbuffer.size(); i++){
      let msg = lbuffer.get_json(i);
      if (msg.type!='fwd')
        break;
      let f = NodeId.from(msg.from), t = NodeId.from(msg.to);
      rtt += msg.rtt||DEF_RTT;
      path.push(f.s);
      if (!this.id.eq(f) && !this.id.eq(t))
        this.node_map.update_conn({ids: [f, t], rtt: msg.rtt||DEF_RTT});
      let node = this.node_map.get({id: f});
      let fold = util.path_fold(path);
      if (fold!==path)
        rtt = this.calc_path_rtt(fold);
      if (node.graph.rtt===undefined || node.graph.rtt > rtt){
        node.graph.rtt = rtt;
        node.graph.path = Array.from(fold);
      }
    }
  }
  update_conn_from_path(lbuffer){
    let msg0 = lbuffer.get_json(0);
    let rt = msg0.rt, path = rt?.path, rtt_a = rt?.rtt;
    if (!Array.isArray(path) || !Array.isArray(rtt_a))
      return;
    if (path.length!=rtt_a.length)
      return xerr('router: invalid path rtt');
    let ret = {};
    for (let i=0, prev=NodeId.from(this.id.s); i<path.length; i++){
      let curr = NodeId.from(path[i]), ids = [prev, curr];
      if (rtt_a[i]){
        if (!this.id.eq(ids[0]) && !this.id.eq(ids[1]))
          this.node_map.update_conn({ids, rtt: rtt_a[i]});
      }
      prev = curr;
    }
    return ret;
  }
  update_conn(lbuffer){
    this.update_conn_from_fwd(lbuffer);
    this.update_conn_from_path(lbuffer);
  }
  calc_path_rtt(path){ // XXX: need test
    let rtt = 0;
    for (let i=0, prev=NodeId.from(this.id.s); i<path.length; i++){
      let curr = NodeId.from(path[i]);
      let conn = this.node_map.get_conn({ids: [prev, curr]});
      rtt += conn?.rtt||DEF_RTT;
      prev = curr;
    }
    return rtt;
  }
  build_rtt_array(path){ // XXX: need test
    let a = [];
    for (let i=0, prev=NodeId.from(this.id.s); i<path.length; i++){
      let curr = NodeId.from(path[i]);
      let conn = this.node_map.get_conn({ids: [prev, curr]});
      a.push(conn?.rtt||DEF_RTT);
      prev = curr;
    }
    return a;
  }
  ack(channel, lbuffer, vv, fwd_rt){
    let msg = lbuffer.msg(), dir = type_to_dir(msg.type);
    if (!dir)
      return;
    let msgid = this.msgid(), body;
    if (Router.t.xxx_rt && fwd_rt) // XXX: WIP
      body = {rt: fwd_rt};
    if (vv){
      // XXX: provide path in rt
      let msg2 = {msgid, to: msg.from, from: this.id.s, type: 'ack',
        req_id: msg.req_id, seq: msg.seq, dir, vv: true, body};
      // XXX: set rt/path from incoming packet to make sure we do same path
      let lbuffer2 = new LBuffer(msg2);
      if (msg2.to==channel.id.s){
        this.ack_pending();
        this.track(lbuffer2, true);
        return channel.send(lbuffer2.to_str());
      }
      return this._send(lbuffer2);
    }
    let msg2 = {msgid, to: channel.id.s, from: this.id.s, type: 'ack',
      req_id: msg.req_id, seq: msg.seq, dir, body};
    let lbuffer2 = new LBuffer(msg2);
    return channel.send(lbuffer2.to_str());
  }
  track(lbuffer, vv){
    let ts = Date.now();
    let msg = lbuffer.msg(), msg0 = lbuffer.get_json(0), type = msg.type;
    let req_id = ''+msg.req_id, seq = +msg.seq;
    if (type=='ack'){
      return this.track_ack(msg.from, req_id, msg.dir, seq, msg.vv,
        msg0.from==msg.from);
    }
    if (Array.isArray(msg.ack)){
      let rdir = type_to_rdir(type);
      if (rdir){
        msg.ack.forEach(s=>this.track_ack(msg.from, req_id, rdir, s, true,
          msg0.from==msg.from));
      }
    }
    let dir = type_to_dir(type);
    if (!dir)
      return;
    let src = NodeId.from(msg.from), dst = NodeId.from(msg.to);
    let src0 = NodeId.from(msg0.from), dst0 = NodeId.from(msg0.to);
    let state_o = this.state[req_id] = this.state[req_id]|| {req_id, ts,
      src, dst, state: 'opening', '>': {}, '<': {}};
    let seq_o = state_o[dir][seq] = state_o[dir][seq]||
      {ts, prev_ts: ts, type, src: src0, dst: dst0};
    let seq_state = this.id.eq(NodeId.from(msg0.from)) ? 'out' : 'in';
    if (false && seq_o.state && seq_o.state!='in') // XXX: TODO
      xerr('router: invalid seq state %s->%s', seq_o.state, seq_state);
    if (seq_o.state=='ack'){ // XXX: TODO
      // xerr('invalid seq state %s->%s', seq_o.state, seq_state);
      return;
    }
    seq_o.state = seq_state;
    if (['res', 'req_end', 'res_end'].includes(type))
      state_o.state = 'closing';
  }
  track_ack(from, req_id, dir, seq, vv, update_rtt){
    let ts = Date.now();
    let state = this.state[req_id];
    // XXX: don't allow change from close to open
    if (!state) // XXX: change to ERR
      return xerr.notice('ack: req_id %s not found', req_id);
    if (!['<', '>'].includes(dir))
      return xerr('router: ack req_id %s invalid dir %s', req_id, dir);
    let seq_o = state[dir][seq];
    if (!seq_o)
      return xerr('router: ack req_id %s seq %s not found', req_id, seq);
    if (dir=='>' && vv){
      if (['res', 'req_end', 'res_end'].includes(seq_o.type))
        state.state = 'close';
      else
        state.state = 'open';
      seq_o.state = 'done';
      if (from!=this.id.s)
        this.update_rtt_from_ack(seq_o, update_rtt);
    } else if (dir=='<' && vv){
      if (['res', 'req_end', 'res_end'].includes(seq_o.type))
        state.state = 'close';
      seq_o.state = 'done';
      if (from!=this.id.s)
        this.update_rtt_from_ack(seq_o, update_rtt);
    }
    else {
      seq_o.state = 'ack';
      if (from!=this.id.s)
        this.update_rtt_from_ack(seq_o, update_rtt);
    }
    seq_o.last_ts = ts;
  }
  update_rtt_from_ack(seq_o, update_rtt){
    if (!update_rtt || seq_o.ack_ts)
      return;
    seq_o.ack_ts = Date.now();
    if (!xutil.is_mocha() || Router.t?.t_conf.msg_delay){
      seq_o.rtt = seq_o.ack_ts - seq_o.ts;
      if (!seq_o.rtt)
        return xerr('router: invalid rtt');
      let channel = this.get_channel_from_id(this.id.eq(seq_o.src) ?
        seq_o.dst : seq_o.src);
      if (!channel)
        return xerr('router: channel not found');
      let conn = this.node_map.update_conn({ids: [seq_o.src, seq_o.dst],
        rtt: seq_o.rtt, self: channel});
      channel.rtt = conn.rtt;
    }
  }
  destroy(){ this.node_map.destroy(); }
}

// XXX: mv to other place
function path_eq(p1, p2){
  if (p1.length!=p2.length)
    return false;
  let i;
  for (i=0; i<p1.length && p1[i]==p2[i]; i++);
  return i==p1.length;
}

// XXX: mv to other place
function type_to_dir(type){
  return ['req', 'req_start', 'req_next', 'req_end'].includes(type) ?
    '>' : ['res', 'res_start', 'res_next', 'res_end'].includes(type) ? '<' :
    '';
}

function type_to_rdir(type){
  return ['req', 'req_start', 'req_next', 'req_end'].includes(type) ?
    '<' : ['res', 'res_start', 'res_next', 'res_end'].includes(type) ? '>' :
    '';
}

Router.t = {};
Router.type_to_dir = type_to_dir;
