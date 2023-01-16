// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import {inherits} from 'util';
import {EventEmitter} from 'events';
import xutil from '../util/util.js';
import {dbg_id, dbg_sd} from './util.js';
import ws_util from '../util/ws.js';
import NodeId from './node_id.js';
import fs from 'fs';
import https from 'https';
import http from 'http';
import xlog from '../util/xlog.js';
const log = xlog('ws');
// XXX HACK: need to add root ca certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
export default WsConnector;

inherits(WsConnector, EventEmitter);
// XXX: use opts instead of id,port,host
function WsConnector(id, port, host, is_http){
  let _this = this;
  this.id = id;
  // XXX HACK: review tmp_id_n+channels - it's a quick hack to cleanup
  // open channels - need to properly rewrite everything
  this.tmp_id_n = 0;
  this.channels = {};
  this.destroyed = false;
  this._wss = null;
  this.url = null;
  if (port>=0){
    // XXX create: move to nconf
    const https_opts = {
      port,
      key: fs.readFileSync('/var/lif/ssl/STAR_lif_zone.key'),
      cert: fs.readFileSync('/var/lif/ssl/STAR_lif_zone.crt')};
    this.https_server = is_http ?
      http.createServer(https_opts).listen(port, '0.0.0.0') :
      https.createServer(https_opts).listen(port, '0.0.0.0');
    this._wss = new ws_util.WebSocketServer({server: this.https_server});
    this._wss.on('connection', onConnection);
    this._wss.on('listening', onListen);
    if (port !== 0){
      this.url = (is_http ? 'ws://' : 'wss://')+(host||'localhost')+':' + port;
      log.notice('wss %s', this.url);
      log.debug('%s wss %s', this.dbg_str(), this.url);
    }
  }

  function onConnection(ws){ _this._onConnection(ws); }

  function onListen(){
    if (_this.destroyed)
      return;
    let port = _this._wss._server.address().port;
    _this.emit('listen', {port, url: _this.url});
  }
}

WsConnector.prototype.connect = function(url){
  this._onConnection(getWebSocket(url)); };

WsConnector.prototype._onConnection = function(ws){
  var _this = this;
  if (this.destroyed){
    ws.close();
    return;
  }
  var channel = new WsChannel(NodeId.from(this.id), ws);
  channel.tmp_id = ++this.tmp_id_n;
  this.channels[channel.tmp_id] = channel;
  channel.on('open', onOpen);
  channel.on('close', onClose);
  channel.on('error', onError);

  function onOpen(){
    channel.removeListener('open', onOpen);
    channel.removeListener('close', onClose);
    channel.removeListener('error', onError);
    if (_this.destroyed){
      channel.destroy();
      return;
    }
    _this.emit('connection', channel);
  }

  function onClose(){
    channel.removeListener('open', onOpen);
    channel.removeListener('close', onClose);
    channel.removeListener('error', onError);
    delete _this.channels[channel.tmp_id];
  }

  function onError(err){ log.err('%s error %s %s', _this.dbg_str(),
    err.message, xutil.get(err, 'error.stack')); }
};

WsConnector.prototype.destroy = function(cb){
  if (this.destroyed)
    return;
  this.destroyed = true;
  for (let i in this.channels)
    this.channels[i].destroy();
  if (this._wss)
    this._wss.close(()=>this.https_server.close(cb));
  else if (cb)
    cb();
  this._wss = null;
};

WsConnector.prototype.dbg_str = function(){ return dbg_id(this.id); };

inherits(WsChannel, EventEmitter);
function WsChannel(local_id, ws){
  var _this = this;
  this.local_id = local_id;
  this.id = undefined;
  this.destroyed = false;
  this.ws = ws;
  ws.onopen = onOpen;
  ws.onmessage = onMessage;
  ws.onclose = onClose;
  ws.onerror = onError;
  if (ws.readyState==1)
    onOpen(); // if already open

  function onOpen(){ _this._onOpen(); }

  function onMessage(data){ _this._onMessage(data.data); }

  function onClose(){ _this.destroy(); }

  function onError(err){ _this._onError(err); }
}

WsChannel.prototype._onOpen = function(){
  if (this.destroyed)
    return;
  this.ws.send(JSON.stringify(this.local_id.s));
};

WsChannel.prototype.send = function(data){
  if (this.destroyed)
    return;
  if (this.ws.readyState==2)
    return; // readyState==CLOSING
  if (this.ws.readyState!=1)
    throw new Error('WebSocket is not ready');
  this.ws.send(data);
};

WsChannel.prototype._onMessage = function(data){
  if (this.destroyed)
    return;
  if (!this.id){
    // XXX: rm JSON.parse from here
    this.id = NodeId.from(JSON.parse(data));
    log.debug('%s open', this.dbg_str());
    this.emit('open');
  }
  else
    this.emit('message', data, this);
};

WsChannel.prototype._onError = function(err){
  log.err('_onError %s', err);
  if (this.destroyed)
    return;
  log.err('ERROR', err);
  this.emit('error', err);
};

WsChannel.prototype.dbg_str = function(){
  return dbg_sd(this.id, this.local_id); };

WsChannel.prototype.destroy = function(){
  if (this.destroyed)
    return;
  log.debug('%s CLOSE', this.dbg_str());
  this.destroyed = true;
  this.ws.close();
  this.ws = null;
  this.emit('close');
};

function getWebSocket(url){
  // XXX: rm special handling for browser
  if (typeof window !== 'undefined' && window.WebSocket)
    return new window.WebSocket(url);
  return new ws_util.WS(url);
}
