// author: derry. coder: arik.
'use strict';
const E = {};
import util from '../util/util.js';
const bstr = util.buf_to_str;
export default E;

function _peer_id(node, id){ return id.substr(id.length-3); }

E.peer_id = function(node, id){
  return typeof id=='string' ? _peer_id(node, id) : _peer_id(node, bstr(id));
};

E.path = function(node, path){
  let s = '';
  if (path)
    path.forEach(p=>s += s ? '>'+E.peer_id(node, p) : E.peer_id(node, p));
  return s;
};

E.set_trace = function(opt){
  let {node, cb} = opt;
  const peer_id = id=>E.peer_id(node, id);
  node.on('connection', conn=>{
    cb('node: <conn '+peer_id(conn.id)+' '+
      (conn.ws ? 'ws '+conn.ws.url : 'wrtc'));
  });
  node.on('peer', id=>cb(`node: peer connected ${peer_id(id)}`));
  node.on('message', (data, src)=>{
    cb(`node: <msg src ${peer_id(src)} ${data}`);
    if (data=='PING')
      node.send(src, 'PONG');
  });
  node.router.on('send', msg=>{
    cb('router: >msg '+msg.data.type+' src '+peer_id(msg.from)+
      ' dst '+peer_id(msg.to)+
      (msg.path.length ? ' path '+E.path(node.id, msg.path) : '')+
      ' '+JSON.stringify(msg.data));
  });
  node.router.on('debug-message', (data, from, msg)=>{
    cb('router: <msg '+data.type+' src '+peer_id(from)+
      (msg.path.length ? ' path '+E.path(node.id, msg.path) : '')+
      ' '+JSON.stringify(msg.data));
  });
  node.router.on('relay', msg=>{
    cb('router: >relay '+msg.data.type+' src '+peer_id(msg.from)+
      ' dst '+peer_id(msg.to)+' path '+E.path(node.id, msg.path));
  });
};
