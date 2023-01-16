// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import {inherits} from 'util';
import {EventEmitter} from 'events';
import SimplePeer from 'simple-peer';
import NodeId from './node_id.js';
import xerr from '../util/xerr.js';
import _debug from 'debug';
import xutil from '../util/util.js';
const debug = _debug('peer-relay:wrtc');
const s2b = xutil.buf_from_str;

export default WrtcConnector;

inherits(WrtcConnector, EventEmitter);
function WrtcConnector(id, router, wrtc){
  var _this = this;
  this.id = id;
  this.destroyed = false;
  this.supported = wrtc != null || SimplePeer.WEBRTC_SUPPORT;
  this._wrtc = wrtc;
  this._pending = {};
  this._router = router;
  this._router.on('message', onMessage);

  function onMessage(msg){
    if (!msg.body)
      return xerr('wrtc: missing body');
    if (msg.cmd === 'signal')
      _this._onSignal(msg.body.data, s2b(msg.from));
  }
}

WrtcConnector.prototype.connect = function(remoteID){
  if (this.destroyed)
    return;
  this._setupSimplePeer(remoteID);
};

WrtcConnector.prototype._onSignal = function(signal, from){
  if (this.destroyed)
    return;
  var sp = this._pending[from];
  if (sp != null)
    sp.signal(signal);
  else
    this._setupSimplePeer(from, signal);
};

WrtcConnector.prototype._setupSimplePeer = function(remoteID, offer){
  var _this = this;
  var sp = new SimplePeer({initiator: offer == null, trickle: true,
    wrtc: this._wrtc});
  sp.on('signal', onSignal);
  sp.on('connect', onConnect);
  sp.on('close', onClose);
  sp.on('error', onError);
  if (offer != null)
    sp.signal(offer);
  this._pending[remoteID] = sp;

  function onSignal(signal){
    _this._debug('SIGNAL', signal);
    _this._router.send(remoteID, {cmd: 'signal', data: signal});
  }

  function onConnect(){
    _this._debug('CONNECT');
    delete _this._pending[remoteID];
    sp.removeListener('signal', onSignal);
    sp.removeListener('connect', onConnect);
    sp.removeListener('close', onClose);
    sp.removeListener('error', onError);
    _this.emit('connection', new WrtcChannel(sp, NodeId.from(remoteID)));
  }

  function onClose(){
    _this._debug('CLOSE');
    delete _this._pending[remoteID];
    sp.removeListener('signal', onSignal);
    sp.removeListener('connect', onConnect);
    sp.removeListener('close', onClose);
    sp.removeListener('error', onError);
  }

  function onError(err){ _this._debug('ERROR', err); }
};

WrtcConnector.prototype.destroy = function(){
  if (this.destroyed)
    return;
  this.destroyed = true;
  for (var id in this._pending)
    this._pending[id].destroy();
};

WrtcConnector.prototype._debug = function(){
  var prepend = '[' + this.id.toString('hex', 0, 2) + ']  ';
  arguments[0] = prepend + arguments[0];
  debug.apply(null, arguments);
};

inherits(WrtcChannel, EventEmitter);
function WrtcChannel(sp, id){
  var _this = this;
  this.destroyed = false;
  this.id = id;
  this._sp = sp;
  this._sp.on('data', onData);
  this._sp.on('close', onClose);
  this._sp.on('error', onError);

  function onData(data){
    if (_this.destroyed)
      return;
    _this.emit('message', data, _this);
  }

  function onClose(){ _this.destroy(); }

  function onError(err){
    if (_this.destroyed)
      return;
    _this.emit('error', err);
  }
}

WrtcChannel.prototype.send = function(data){
  if (this.destroyed)
    return;
  this._sp.send(data);
};

WrtcChannel.prototype.destroy = function(){
  if (this.destroyed)
    return;
  this.destroyed = true;
  this._sp.destroy();
  this._sp = null;
  this.emit('close');
};
