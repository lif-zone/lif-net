// author: derry. coder: arik.
'use strict';
import xcrypto from '../util/crypto.js';
import NodeId from './node_id.js';
const stringify = JSON.stringify;
import buf_util from './buf_util.js';
const b2s= buf_util.buf_to_str;

export default class LBuffer {
  constructor(opt){
    this.array = [];
    if (typeof opt=='object')
      this.add_json(opt);
    else if (opt)
      this.add_data(opt);
  }
  // XXX: change internal structure. just save long string and indexes to
  // data start/end to avoid expensive parsing when caling LBuffer.from
  add_data(data){
    let o = {data};
    this.array.unshift(o);
    return this.get(0);
  }
  add_tail_data(data){
    let o = {data};
    this.array.push(o);
    return this.get(this.array.length-1);
  }
  add_json(o){
    this.add_data(stringify(o));
    return this.get_json(0);
  }
  add_tail_json(o){
    this.add_tail_data(stringify(o));
    return this.get_json(this.array.length-1);
  }
  add(o){
    if (typeof o=='object')
      this.add_json(o);
    else
      this.add_data(o);
  }
  add_tail(o){
    if (typeof o=='object')
      this.add_tail_json(o);
    else
      this.add_tail_data(o);
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
  to_buffer(){ return Buffer.from(this.to_str()); }
  to_array(){
    let a = [];
    this.array.forEach(o=>a.push(o.data));
    return a;
  }
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
    let {data} = this._to_str();
    // XXX: need to_buffer api
    let sig = xcrypto.sign(Buffer.from(data), key);
    this.add_json({sig: NodeId.from(sig).s});
    return sig;
  }
  // XXX: cache it if buffer didn't change
  hash(){ return b2s(xcrypto.sha256(this.to_buffer())); }
}

LBuffer.from = function(s){
  if (Array.isArray(s)){
    let lbuffer = new LBuffer();
    s.forEach(data=>lbuffer.add_tail(data));
    return lbuffer;
  }
  if (s instanceof Uint8Array || s instanceof Buffer)
    return LBuffer.from(Buffer.from(s).toString());
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
    lbuffer.add_data(s.substr(i, Infinity));
    return lbuffer;
  }
  if (!Array.isArray(a))
    throw new Error('invalid buffer');
  a.forEach(len=>{
    if (typeof len!='number')
      throw new Error('invalid buffer');
    lbuffer.add_tail_data(s.substr(i, len));
    i += len;
  });
  if (i != s.length)
    throw new Error('invalid buffer');
  return lbuffer;
};

