// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import xutil from '../util/util.js';
import xcrypto from '../util/crypto.js';
import NodeId from './node_id.js';
import buf_util from './buf_util.js';
import {Buffer} from 'buffer';
const stringify = JSON.stringify;

export default class LBuffer {
  constructor(opt){
    this.array = [];
    if (typeof opt=='object')
      this.add_json(opt);
    else if (opt)
      this.add(opt);
  }
  // XXX: change internal structure. just save long string and indexes to
  // data start/end to avoid expensive parsing when caling LBuffer.from
  add(data){
    let o = {data};
    this.array.unshift(o);
    return this.get(0);
  }
  add_tail(data){
    let o = {data};
    this.array.push(o);
    return this.get(this.array.length-1);
  }
  add_json(o){
    this.add(stringify(o));
    return this.get_json(0);
  }
  add_tail_json(o){
    this.add_tail(stringify(o));
    return this.get_json(this.array.length-1);
  }
  size(){ return this.array.length; }
  get(i){ return this.array[i].data; }
  get_json(i){
    this.array[i].json = this.array[i].json||JSON.parse(this.array[i].data);
    return this.array[i].json;
  }
  _to_str(){
    let h = [], d='';
    this.array.forEach(o=>{
      h.push(o.data.length);
      d += o.data;
    });
    return {header: h, data: d};
  }
  to_str(){
    let {header, data} = this._to_str();
    if (header.length<=1)
      return '\0'+data;
    return stringify(header)+'\0'+data;
  }
  to_json(){
    let a = [];
    this.array.forEach(o=>a.push(o.json||o.data));
    return a;
  }
  to_buffer(){ return Buffer.from(this.to_str()) }
  path(){
    let o, p = [];
    for (let i=0; i<this.size() && (o=this.get_json(i)) && o.type=='fwd'; i++)
      p.unshift(o.from);
    return p;
  }
  msg(){ return this.get_json(this.size()-1); }
  range(){
    for (let i=0; i<this.size(); i++){
      let o = this.get_json(i);
      if (o.range)
        return NodeId.range_from_msg(o.range);
    }
  }
  sign(key){
    let {header, data} = this._to_str();
    // XXX: need to_buffer api
    let sig = xcrypto.sign(Buffer.from(data), key);
    this.add_json({sig: NodeId.from(sig).s});
    return sig;
  }
}

LBuffer.from = function(s){
  if (typeof s!='string')
    throw new Error('invalid buffer');
  let i = s.search('\0');
  if (i==-1)
    throw new Error('invalid buffer');
  let a, h = s.substr(0, i), lbuffer = new LBuffer();
  try { a = JSON.parse(h||'""'); }
  catch(err){ throw new Error('invalid buffer'); }
  i++;
  if (!h || a&&a.length==0){
    lbuffer.add(s.substr(i, Infinity));
    return lbuffer;
  }
  if (!Array.isArray(a))
    throw new Error('invalid buffer');
  a.forEach(len=>{
    if (typeof len!='number')
      throw new Error('invalid buffer');
    lbuffer.add_tail(s.substr(i, len));
    i += len;
  });
  if (i != s.length)
    throw new Error('invalid buffer');
  return lbuffer;
};

