// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
import buf_util from './buf_util.js';
import xerr from '../util/xerr.js';
import sprintf from '../util/sprintf.js';

export function dbg_id(id){
  try {
    if (!id)
      return 'no_id';
    if (typeof id!='string')
      id = buf_util.buf_to_str(id);
    return id.slice(0, 5);
  } catch(err){
    xerr('invalid id %s error %s', id, err);
    return 'invalid_id';
  }
}
export function dbg_msg(msg){ return sprintf('%s %s %s %s:%s',
  dbg_sd(msg.from, msg.to), msg.cmd, msg.type, msg.req_id, msg.seq); }

export function dbg_sd(s, d){ return dbg_id(s)+'->'+dbg_id(d); }

export function undefined_to_null(key, value){
  return value===undefined ? null : value; }

export function undefined_to_null2(value){
  return value===undefined ? null : value; }

export function path_fold(_path){
  let path = _path;
  for (let i=0; i<path.length; i++){
    let curr = path[i], at;
    for (let j=i+1; j<path.length; j++){
      if (curr==path[j])
        at = j;
    }
    if (at===undefined)
      continue;
    path = path===_path ? Array.from(path) : path;
    path.splice(i+1, at-i);
  }
  return path;
}
