// author: derry. coder: arik.
'use strict';
const Babel = self.Babel;
const Node = self.lif_node.default;
const crypto = Node.crypto;
self.g_node;

async function init(){
  let bootstrap = ['wss://'+location.host]; // XXX: let server configure it
  console.log('sw: connect to LIF bootstrap %s', bootstrap.join(' '));
  let keypair = await crypto.keypair(crypto.crypt_def);
  let node = self.g_node = new Node({bootstrap, ...keypair});
  console.log('sw: node id %s', node.id.s);
  node.on('connected', id=>{
    console.log('sw: connected to %s', id.s);
    setTimeout(()=>{
      console.log('sw: >ping');
        let req = node.ping(id.s, {});
        req.on('res', msg=>console.log('sw: <ping_r'));
      }, 1000);
  });
};

init();
