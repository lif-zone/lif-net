// author: derry. coder: arik.
'use strict';
import xerr from './xerr.js';

export default function xlog(module){
  function log(l, args){
    if (!args.length)
      return console.error('invalid log invoke');
    if (!xlog.modules.includes(module) && !xlog.modules.includes('*'))
      return;
    var prepend = module+': ';
    args = Array.from(args);
    args[0] = prepend + args[0];
    if (l=='debug') // XXX: temporary hack until fix properly on xerr
      l = 'info';
    xerr[l](...args);
  }
  let ret = function(){ return log('err', arguments); };
  Object.keys(xerr.L).forEach(l=>ret[l.toLowerCase()] = function(){
    return log(l.toLowerCase(), arguments); });
  return ret;
}

xlog.set_log = function(str){
  xlog.log_str = str||'';
  xlog.modules = (str||'').split(',');
};

// XXX: support '*:notice, ws:debug'
xlog.set_log('*');
