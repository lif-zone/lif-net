// author: derry. coder: arik.
'use strict';
import {v4 as uuidv4} from 'uuid';

const E = {};
export default E;

if (typeof window!='undefined')
  window.LIF = E;

E.new_uuid = ()=>uuidv4();

E.new_node = uuid=>new LIFNode(uuid);

class LIFNode {
  constructor(opt){
    if (typeof opt=='string')
      opt = {uuid: opt};
    this.uuid = opt.uuid;
    this.connections = {};
    console.log('lif_node: new  %s', this.uuid);
  }
  new_conn(opt){
    if (typeof opt=='string')
      opt.uuid = opt;
    let remote = opt.uuid;
    if (this.connections[remote])
      return this.connections[remote];
    Object.assign({node: this}, opt);
    return this.connections[remote] = new LIFConn(opt);
  }
}

class LIFConn {
  constructor(opt){
    this.node = opt.node;
    this.remote = opt.remote;
    console.log('lif_conn: new  %s', this.remote);
  }
  connect(){
  }
}

/* XXX: API
let self_uuid = localStorage.self_uuid = localStorage.self_uuid || new_uuid();
let node = lif.new_node(self_uuid);
let conn = node.new_conn(remote);
conn.send({msg: ‘hello’});
conn.on(‘message’, e=>conn.send(‘you sent me ‘+e.msg));
node.on(‘connection’, conn=>conn.send(‘hi ‘+conn.uuid));
*/

