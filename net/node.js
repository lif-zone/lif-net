// author: derry. coder: arik.
'use strict';
import {EventEmitter} from 'events';
import assert from 'assert';
import Router from './router.js';
import NodeId from './node_id.js';
import Channels from './channels.js';
import Req from './req.js';
import ReqHandler from './req_handler.js';
import Wallet from './wallet.js';
import WsConnector from './ws.js';
import WrtcConnector from './wrtc.js';
import xerr from '../util/xerr.js';
import etask from '../util/etask.js';
const RING_NEIGHBOURS = 8;

export default class Node extends EventEmitter {
  constructor(opt){
    super();
    if (!opt)
      opt = {};
    this.wallet = new Wallet({keys: opt.keys});
    let id = this.id = NodeId.from(this.wallet.keys.pub);
    // XXX: need cleanup for all internal structures
    this.pending = {};
    this.peers = new Channels();
    this.peers.on('removed', channel=>channel.destroy());
    this.router = new Router({channels: this.peers, id, wallet: this.wallet});
    this.ping_handler = new ReqHandler({node: this, cmd: 'ping'})
    .on('req', (msg, res)=>res.send('ping_r'));
    this.conn_handler = new ReqHandler({node: this, cmd: 'conn_info'})
    .on('req', (msg, res)=>res.send({ws: this.wsConnector.url,
      wrtc: this.wrtcConnector.supported}));
    this.ring_join_handler = new ReqHandler({node: this, cmd: 'ring_join'})
    .on('req', (msg, res)=>res.send({id: id.s}));
    this.wsConnector = new Node.WsConnector(id.b, opt.https_server);
    this.wsConnector.on('connection', channel=>this._onConnection(channel));
    this.wrtcConnector = new Node.WrtcConnector(id.b, this.router,
      opt.wrtc);
    this.wrtcConnector.on('connection', channel=>this._onConnection(channel));
    setTimeout(()=>{ // XXX HACK: rm timeout
      for (var uri of opt.bootstrap||[])
        this.wsConnector.connect(uri);
    });
  }
  _onConnection(channel){
    let _this = this;
    const onClose = ()=>{
      delete _this.pending[channel.id];
      _this.peers.remove(channel.id);
    };
    assert(!_this.destroyed, 'node already destroyed');
    channel.on('close', onClose);
    // XXX: decide how to handle errors
    channel.on('error', err=>xerr('Error', err));
    delete _this.pending[channel.id];
    if (_this.peers.get(channel.id)){
      if (channel.id.cmp(_this.id.b) >= 0)
        channel.destroy();
      return;
    }
    _this.peers.add(channel);
    _this.send_connect(NodeId.from(channel.id));
    _this.emit('connection', channel);
    _this.emit('peer', NodeId.from(channel.id));
    return channel;
  }
  connect_wrtc(id){ return this.wrtcConnector.connect(id); }
  connect = id=>{
    if (this.destroyed) // XXX: print error (or assert)
      return;
    if (id in this.pending)
      return;
    if (this.peers.get(id))
      return;
    if (id.equals(this.id.b))
      return;
    this.pending[id] = true;
    // XXX: allow empty body
    let req = new Req({node: this, dst: id, cmd: 'conn_info'});
    req.on('res', msg=>this._on_conn_info_r(msg));
    req.send();
  };
  disconnect(id){
    if (this.destroyed)
      return;
    if (!this.peers.get(id))
      return;
    this.peers.get(id).destroy();
  }
  send = function(dst, body){
    assert(typeof dst=='string', 'invalid dst');
    if (this.destroyed)
      return;
    let req = new Req({node: this, dst});
    req.send(body);
  }
  _on_conn_info_r = msg=>etask({_: this}, function*(){
    let {from} = msg;
    let _this = this._;
    if (_this.peers.get(from))
      return;
    if (msg.body == null)
      return;
    if (Node.t_conn_info_r_hook)
      yield Node.t_conn_info_r_hook(msg);
    if (msg.body.wrtc && _this.wrtcConnector.supported)
      yield _this.connect_wrtc(from);
    else if (msg.body.ws)
      yield _this.wsConnector.connect(msg.body.ws);
  });
  destroy(cb){
    if (this.destroyed)
      return;
    this.emit('destroy');
    this.destroyed = true;
    this.router.destroy();
    this.wsConnector.destroy(cb);
    this.wrtcConnector.destroy();
    var peers = this.peers.toArray();
    for (var i = 0; i < peers.length; i++)
      peers[i].destroy();
  }
  send_connect(dst){
    let req = new Req({node: this, dst, cmd: 'connect'});
    req.send({close: true}, '');
    return req;
  }
  ping(dst, opt){
    opt = opt||{};
    let req = new Req({node: this, dst, req_id: opt.req_id, cmd: 'ping',
      rt: opt.rt});
    req.send('');
    return req;
  }
  ring_join_single(dst, opt){
    opt = opt||{};
    if (opt.fuzzy===undefined)
      opt.fuzzy = '~';
    return Req.etask({node: this, dst, fuzzy: opt.fuzzy, req_id: opt.req_id,
      cmd: 'ring_join'});
  }
  ring_join(opt){
    opt = opt||{};
    let n = opt.n||RING_NEIGHBOURS;
    let router = this.router, id = this.id;
    // XXX: handle error
    return etask({_: this}, function*req_join(){
      yield this._.ring_join_single(id);
      let prev = id, next = id;
      for (let i=0; i<n; i++){
        if (prev = router.node_map.find_prev(prev)?.id)
          yield this._.ring_join_single(prev);
        if (next = router.node_map.find_next(next)?.id)
          yield this._.ring_join_single(next);
      }
    });
  }
}
Node.WsConnector = WsConnector;
Node.WrtcConnector = WrtcConnector;
Node.t = {};
