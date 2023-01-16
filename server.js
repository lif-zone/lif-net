// author: derry. coder: arik.
'use strict';
import nconf from 'nconf';
import util from './util/util.js';
import date from './util/date.js';
import debug from './lib/debug.js';
import dns_server from './lib/dns_server.js';
import https_server from './lib/https_server.js';
import peer_relay from './peer-relay/client.js';
import crypto from 'crypto';

function init(){
  nconf.argv().env().file({file: '/var/lif/node_config.json'});
  let id = nconf.get('node_id'), id2 = nconf.get('node_id2');
  if (!id || !id2)
  {
    id = id || util.buf_to_str(crypto.randomBytes(20));
    id2 = id2 || util.buf_to_str(crypto.randomBytes(20));
    nconf.set('node_id', id);
    nconf.set('node_id2', id2);
    nconf.save();
  }
  console.log('lif server start');
  // XXX: split into seperate process
  dns_server.start(); // XXX: need dns_server.stop()
  https_server.start({debug_get_log}); // XXX: need https_server.stop()
  let node = new peer_relay({id, bootstrap: [], host: 'poc.lif.zone',
    port: 3032});
  let node2;
  // XXX HACK: we run peer_relay in setTimeout because otherwise it will
  // fail coonnecting to node because it didn't inilitized yet
  setTimeout(()=>{
    node2 = new peer_relay({id: id2, host: 'poc.lif.zone',
      bootstrap: ['wss://poc.lif.zone:3032'], port: 3033});
    debug.set_trace({node: node2, cb: add_to_log2});
    add_to_log2('listen port 3033 '+util.buf_to_str(node2.id));
  }, 1000);
  debug.set_trace({node, cb: add_to_log});
  add_to_log('listen port 3032 '+util.buf_to_str(node.id));
}

let node_log=[], node_log2=[], max_length = 5000;
function add_to_log(s){
  let s2 = date.to_time_ms()+': '+s;
  node_log.push(s2);
  if (node_log.length > max_length)
    node_log = node_log.splice(0, max_length/2);
}
function add_to_log2(s){
  let s2 = date.to_time_ms()+': '+s;
  node_log2.push(s2);
  if (node_log2.length > max_length)
    node_log2 = node_log2.splice(0, max_length/2);
}
function debug_get_log(port){
  if (port==3033)
    return node_log2;
  return node_log;
}

init();
