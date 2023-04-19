#! /usr/local/bin/node
// author: derry. coder: arik.
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import etask from './util/etask.js';
import prompt from 'prompt'; // XXX: fix vim coloring

proc.xexit_init();

// XXX: mv to util (and add fallback to other servers)
const get_my_ip = ()=>etask(function*get_my_ip(){
  // XXX: need proper wget api
  let controller = new AbortController(), signal = controller.signal;
  let ip, req = fetch('http://api.myip.com', {signal});
  this.alarm(5000, ()=>controller.abort());
  try { ip = yield (yield req).json(); }
  catch(err){}
  if (!ip?.ip)
    return console.error('failed to get IP');
  return ip.ip;
});

const main = ()=>etask(function*main(){
  console.log('Install LIF Server');
  let et_ip = get_my_ip();
  yield prompt.start(); // XXX: fix vim coloring
  // XXX: missing validator
  prompt.message = null;
  let dir = (yield prompt.get({name: 'val', type: 'string', required: true,
    default: '/var/lif/server', // XXX: fix vim coloring
    description: 'Install dir'})).val;
  let ip = yield et_ip;
  ip = (yield prompt.get({name: 'val', type: 'string', required: true,
    default: ip||'', description: 'Server public IPs (space-seperated)'})).val;

  xerr('XXX dir %O', dir);
  xerr('XXX ip %O', ip);
});

main();
