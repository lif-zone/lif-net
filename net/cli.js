#! /usr/bin/env node
// author: derry. coder: arik.
import Node from './node.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';

proc.xexit_init();

const start_lif_node = ()=>etask(function*start_lif_node(){
  // XXX: save node id
  let node = new Node({bootstrap: ['wss://lif.biz']});
  xerr.notice('cli: node id %s', node.id.s);
  node.on('peer', id=>{
    xerr.notice('cli: connected to %s', id.s);
    setTimeout(()=>{
      xerr.notice('cli: >ping');
      let req = node.ping(id.s, {});
      req.on('res', msg=>xerr.notice('cli: <ping_r'));
    }, 500);
  });
});

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  // XXX: allow to configure it
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
  start_lif_node();
});

main();
