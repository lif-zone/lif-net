// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import {EventEmitter} from 'events';
import Tree from 'avl';
import FibonacciHeap from 'js-fibonacci-heap';
import NodeId from './node_id.js';
import assert from 'assert';
import etask from '../util/etask.js';

export default class NodeMap extends EventEmitter {
constructor(){
  super();
  this.map = new Map();
  this.avl = new Tree(NodeId.cmp, true);
  this.conn = new Map();
}
set(id, node){
  this.map.set(id.s, node);
  if (!node.self){
    node.avl_node = this.avl.insert(id, node);
    node.avl = this.avl;
  } else {
    assert(!this.self);
    this.id = node.id;
  }
}
get(opt){
  if (opt instanceof NodeId)
    opt = {id: opt};
  let {id, create} = opt;
  let node = this.map.get(id.s);
  if (!create || node)
    return node;
  node = new NodeMap.Node(id);
  this.set(id, node);
  return node;
}
del(id){
  this.map.delete(id.s);
  this.avl.remove(id);
}
get_conn(opt){
  let {ids, create} = opt, hash = conn_hash(ids);
  let conn = this.conn.get(hash);
  if (!create || conn)
    return conn;
  conn = new NodeMap.NodeConn({ids});
  this.conn.set(hash, conn);
  return conn;
}
update_conn(opt){
  let {ids, rtt, self} = opt;
  let n0 = this.get({id: ids[0], create: true});
  let n1 = this.get({id: ids[1], create: true});
  let conn = this.get_conn({ids, create: true});
  if (conn.rtt==rtt && conn.self===self)
    return conn;
  conn.update_conn({rtt, self});
  rtt = conn.rtt;
  if (self){
    let n = this.id.eq(n0.id) ? n1 : n0;
    n.graph.rtt = rtt;
    n.graph.prev = n0===n ? n1 : n0;
    n.graph.path = [n.id.s];
  }
  n0.set_conn(n1.id, conn);
  n1.set_conn(n0.id, conn);
  this.schedule_build_rtt_graph();
  return conn;
}
find(id){ return this.get(id); }
find_next(id){
  let best, avl = this.avl;
  if (!avl.size)
    return;
  for (let curr=avl._root; curr;){
    let cmp = id.cmp(curr.key);
    if (cmp<0){
      best = curr;
      curr = curr.left;
    } else
      curr = curr.right;
  }
  return best ? best.data : avl.at(0).data;
}
find_prev(id){
  let best, avl = this.avl;
  if (!avl.size)
    return;
  for (let curr=avl._root; curr;){
    let cmp = id.cmp(curr.key);
    if (cmp>0){
      best = curr;
      curr = curr.right;
    } else
      curr = curr.left;
  }
  return best ? best.data : avl.at(avl.size-1).data;
}
find_bidi(id){
  let next = this.find_next(id);
  if (!next || id.eq(next.id))
    return next;
  let prev = this.find_prev(id);
  return id.dist_bits(next.id) <= id.dist_bits(prev.id) ? next : prev;
}
schedule_build_rtt_graph(){
  if (this.build_rtt_timer)
    return;
  this.build_rtt_timer = etask({_: this}, function*build_rtt_timer(){
    yield etask.sleep(1000);
    this._.build_rtt_timer = undefined;
    this._.build_rtt_graph();
  });
}
build_rtt_graph(){
  let queue = new FibonacciHeap();
  let map = new Map();
  for (let [, node] of this.map){
    let d = node.graph.rtt = this.id.eq(node.id) ? 0 : Infinity;
    node.graph.prev = null;
    node.graph.path = [];
    map.set(node.id.s, queue.insert(d, node));
  }
  while (!queue.isEmpty()){
    let next = queue.extractMinimum().value;
    if (next.graph.rtt===Infinity) // XXX: disconnected nodes (can it happen?)
      break;
    for (let [, conn] of next.conn){
      let neighbor_key = conn.ids[0].eq(next.id) ?
        conn.ids[1].s : conn.ids[0].s;
      let neighbor = this.map.get(neighbor_key);
      assert(conn.rtt, 'missing rtt for '+next.id.s+neighbor.id.s);
      let alt = next.graph.rtt + conn.rtt;
      if (alt < neighbor.graph.rtt){
        neighbor.graph.rtt = neighbor.graph.rtt = alt;
        neighbor.graph.prev = next;
        neighbor.graph.path = next.graph.path.concat(neighbor.id.s);
        queue.decreaseKey(map.get(neighbor.id.s), alt);
      }
    }
  }
}
node_itr(id, opt){ return new NodeItr(this, id, opt); }
destroy(){
  if (this.build_rtt_timer)
    this.build_rtt_timer.return();
  this.build_rtt_timer = undefined;
}
get_best_route(dst){
  let best, src = this.id;
  for (let i=0, itr=this.node_itr(dst), at; i<16 && (at = itr.next(dst));){
    let o = src.rtt_pb_via(dst, at.id, at.graph.rtt);
    if (!o.good)
      continue;
    if (!best || o.rtt_pb < best.rtt_pb)
      best = {rtt_pb: o.rtt_pb, path: at.graph.path};
    i++;
  }
  return best;
}
// XXX WIP: copy rtt_pb logic
get_route_by_range(dst, exclude, range){
  if (0){ // XXX: rm
    let itr = this.node_itr(dst, {exclude, range}), at;
    at = itr.next();
    // XXX: do we need to select accoding to best rtt_pb
    return at && at.graph.path;
  }
  let best, src = this.id;
  for (let i=0, itr=this.node_itr(dst, {exclude, range}), at;
    i<16 && (at = itr.next(dst));){
    let o = src.rtt_pb_via_fuzzy(dst, at.id, at.graph.rtt);
    if (!o.good)
      continue;
    if (!best || o.rtt_pb < best.rtt_pb)
      best = {rtt_pb: o.rtt_pb, path: at.graph.path};
    i++;
  }
  return best;
}
}

class Node extends EventEmitter {
constructor(opt){
  super();
  if (opt instanceof NodeId)
    opt = {id: opt};
  let {id, self} = opt;
  this.id = id;
  this.self = self;
  this.conn = new Map();
  this.graph = {path: []};
}
set_conn(id, conn){ this.conn.set(id.s, conn); }
del_conn(id){ throw new Error('XXX del_conn'); }
get_conn(id){ return this.conn.get(id.s); }
next(){
  let avl_node = this.avl.next(this.avl_node)||this.avl.at(0);
  return avl_node && avl_node.data;
}
prev(){
  let avl_node = this.avl.prev(this.avl_node)||this.avl.at(this.avl.size-1);
  return avl_node && avl_node.data;
}
}

class NodeConn extends EventEmitter {
constructor(opt){
  super();
  let {ids, self, rtt} = opt;
  assert(ids.length==2, 'invalid conn ids '+ids);
  this.ids = Array.from(ids);
  this.self = self;
  this.rtt = rtt;
}
update_conn(opt){
  let {self, rtt} = opt;
  if (typeof self!==undefined)
    this.self = self;
  if (typeof rtt!==undefined && rtt)
    this.rtt = Math.min(rtt, this.rtt||rtt);
}
}

// XXX: optimize, if ids is node_map.id, then just use dst for hash
function conn_hash(ids){ return ids[0].cmp(ids[1])<0 ?
  ids[0].s+'_'+ids[1].s : ids[1].s+'_'+ids[0].s; }

class NodeItr extends EventEmitter {
constructor(node_map, id, opt){
  super();
  this.opt = opt||{};
  if (typeof id=='number')
    this.start = new NodeId(id);
  else if (typeof id=='string')
    this.start = new NodeId(id);
  else if (id instanceof NodeId)
    this.start = id;
  else if (id instanceof Node){
    assert.fail('XXX TODO');
    this.start = id.id;
    this.n = id;
  } else
    assert();
  this.node_map = node_map;
  this.n = this.n || node_map.find_next(this.start);
  this.p = this.n && this.n.prev();
}
next(){
  let {exclude, range} = this.opt;
  if (!this.n)
    return null;
  if (this.n===this.p){
    this.n = null;
    if (is_exclude(exclude, this.p.id))
      return null;
    if (range && !this.p.id.in_range(range))
      return null;
    return this.p;
  }
  let at;
  let n_diff = this.n.id.dist(this.start);
  let p_diff = this.p.id.dist(this.start);
  if (n_diff<p_diff){
    at = this.n;
    this.n = this.n.next();
  } else {
    at = this.p;
    this.p = this.p.prev();
  }
  if (is_exclude(exclude, at.id))
    return this.next();
  if (range && !at.id.in_range(range))
    return this.next();
  return at;
}
}

// XXX: need test and move to node_id
function is_exclude(exclude, id){
  if (!exclude)
    return false;
  if (Array.isArray(exclude))
    return !!exclude.find(id2=>id2.eq(id));
  return exclude.eq(id);
}

NodeMap.t = {};
NodeMap.Node = Node;
NodeMap.NodeItr = NodeItr;
NodeMap.NodeConn = NodeConn;
NodeMap.conn_hash = conn_hash;
