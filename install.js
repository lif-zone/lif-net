#! /usr/local/bin/node
// author: derry. coder: arik.
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import etask from './util/etask.js';
import string from './util/string.js';
import url from './util/url.js';
import {valid_file, valid_dir} from './fs/util.js';
import {is_ipv4} from './util/net.js';
import prompt from 'prompt'; // XXX: fix vim coloring
const {is_valid_domain} = url;
const {split_ws} = string;

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

function validate_dir(path){ return valid_dir(path)||valid_file(path); }

function validate_ip(ip){
  ip = split_ws(ip||'');
  return ip.length && !ip.find(s=>!is_ipv4(s));
}

function validate_domain(domain){
  domain = split_ws(domain||'');
  return domain.length && !domain.find(s=>!is_valid_domain(s));
}

const main = ()=>etask(function*main(){
  console.log('Install LIF Server');
  let et_ip = get_my_ip();
  yield prompt.start(); // XXX: fix vim coloring and for default
  // XXX: missing validator
  prompt.message = null;
  let dir = (yield prompt.get({name: 'val', type: 'string', required: true,
    default: '/var/lif/server', validator: validate_dir,
    description: 'Install dir'})).val;
  let ip = yield et_ip;
  ip = split_ws((yield prompt.get({name: 'val', type: 'string', required: true,
    default: ip||'', validator: validate_ip,
    description: 'Server public IPs (space-seperated)'})).val);
  let domain = split_ws((yield prompt.get({name: 'val', type: 'string',
    required: true, validator: validate_domain,
    description: 'Server domains (space-seperated)'})).val);
  xerr('XXX dir %O', dir);
  xerr('XXX ip %O', ip);
  xerr('XXX ip %O', domain);
});

main();
