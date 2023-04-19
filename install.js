#! /usr/local/bin/node --no-warnings
// author: derry. coder: arik.
import fs from 'fs';
import {execSync} from 'node:child_process';
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import etask from './util/etask.js';
import string from './util/string.js';
import date from './util/date.js';
import url from './util/url.js';
import {valid_file, valid_dir} from './fs/util.js';
import {is_ipv4} from './util/net.js';
import prompt from 'prompt'; // XXX: fix vim coloring
const {is_valid_domain} = url;
const {split_ws} = string;
const cwd = process.cwd();
const ts = date();
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

function validate_dir(path){
  return path!='/' && valid_dir(path)||valid_file(path);
}

function validate_ip(ip){
  ip = split_ws(ip||'');
  return ip.length && !ip.find(s=>!is_ipv4(s));
}

function validate_domain(domain){
  domain = split_ws(domain||'');
  return domain.length && !domain.find(s=>!is_valid_domain(s));
}

function is_yes(s){ return /^yes|y$/i.test(s.trim()); }
function is_no(s){ return /^no|n$/i.test(s.trim()); }

function validate_yes_no(s){ return is_yes(s) || is_no(s); }

function gen_conf(old, opt){
  return {install_ts: opt.install_ts, ...old, production: true, ...opt};
}

function conf_str(conf){ return JSON.stringify(conf, null, '  '); }

const main = ()=>etask(function*main(){
  this.on('uncaught', err=>xerr.xexit(err));
  // XXX TODO: check preconditions (eg. node min version, free space)
  // XXX: read prev configuration and allow to keep old settings
  console.log('Install LIF Server');
  let et_ip = get_my_ip();
  yield prompt.start(); // XXX: fix vim coloring and for default
  // XXX: missing validator
  prompt.message = null;
  let update = is_yes((yield prompt.get({name: 'val', type: 'string',
    required: true, default: 'Yes',
    validator: validate_yes_no,
    description: 'Checkout latest LIF GIT repository (Y/N)'})).val);
  let dst = (yield prompt.get({name: 'val', type: 'string', required: true,
    default: '/var/lif/server', validator: validate_dir,
    description: 'Install dir'})).val;
  let ip = yield et_ip;
  ip = split_ws((yield prompt.get({name: 'val', type: 'string', required: true,
    default: ip||'', validator: validate_ip,
    description: 'Server public IPs (space-seperated)'})).val);
  let domain = split_ws((yield prompt.get({name: 'val', type: 'string',
    required: true, validator: validate_domain,
    description: 'Server domains (space-seperated)'})).val);
  if (dst.slice(-1)=='/')
    dst = dst.substr(0, dst.length-1);
  let src = cwd;
  let tmp = dst+'.tmp';
  let prev = dst+'.prev';
  let tmp_conf_file = tmp+'/conf.json';
  let tmp_id_file = tmp+'/install_id';
  xerr('XXX src %O', src);
  xerr('XXX dst %O', dst);
  xerr('XXX ip %O', ip);
  xerr('XXX ip %O', domain);
  if (update){
    console.log('Checkout latest LIF GIT repository');
    execSync('git pull');
    execSync('git checkout');
  }
  let need_prev = true;
  if (!fs.existsSync(dst)){
    console.log('Creating dir %s', dst);
    fs.mkdirSync(dst, {recursive: true});
    need_prev = false;
  }
  console.log('Build npm dependency');
  execSync('npm install');
  if (fs.existsSync(tmp)){
    console.log('Remove tmp dir %s', tmp);
    fs.rmSync(tmp, {recursive: true, force: true});
  }
  console.log('Copy src to tmp dir %s', tmp);
  fs.cpSync(src, tmp, {force: true, recursive: true});
  fs.writeFileSync(tmp_id_file, date.to_sql_ms(ts));
  console.log('Create configuration file %s', tmp_conf_file);
  let conf = (yield import(tmp_conf_file, {assert: {type: 'json'}})).default;
  let conf_new = gen_conf(conf, {install_ts: date.to_sql_ms(ts), ip, domain});
  fs.writeFileSync(tmp_conf_file, conf_str(conf_new));
  // XXX: stop service
  console.log('XXX WIP - stop service');
  if (need_prev){
    console.log('Remove old prev dir %s', prev);
    fs.rmSync(prev, {recursive: true, force: true});
    console.log('Save prev copy %s', prev);
    fs.renameSync(dst, prev);
  }
  console.log('Move tmp dir to be new version %s', dst);
  fs.renameSync(tmp, dst);
  // XXX: start service
  console.log('XXX WIP - start service');
  console.log();
});

main();
