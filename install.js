#! /usr/bin/env -S node --no-warnings
// author: derry. coder: arik.
import fs from 'fs';
import {execSync} from 'node:child_process';
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import ver_util from './util/ver_util.js';
import etask from './util/etask.js';
import string from './util/string.js';
import date from './util/date.js';
import util from './util/util.js';
import escape from './util/escape.js';
import url from './util/url.js';
import {valid_file, valid_dir} from './fs/util.js';
import {is_ipv4} from './util/net.js';
import prompt from 'prompt';
const {is_valid_domain} = url;
const {split_ws} = string;
const {opt_array} = util;
const cwd = process.cwd();
const ts = date();
const lif_dir = '/var/lif';
const NODE_MIN_VER = '18.6.0';
proc.xexit_init();

// XXX: mv to util (and add fallback to other servers)
const get_my_ip = ()=>etask(function*get_my_ip(){
  // XXX: need proper wget api
  let controller = new AbortController(), signal = controller.signal;
  let ip, req = fetch('http://api64.ipify.org?format=json', {signal});
  this.alarm(5000, ()=>controller.abort());
  try { ip = yield (yield req).json(); }
  catch(err){}
  if (!ip?.ip)
    return console.error('\nfailed to get IP\n');
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

function get_git_head(){
  let s = execSync('git show-ref refs/heads/main');
  let m = s.toString().match(/^([0-9a-f]+) .*/);
  return m?.[1];
}

function is_svc_running(svc){
  try {
    let log = execSync('/usr/bin/systemctl status lif_server');
    return /\(running\)/.test(log);
  } catch(err){}
  return false;
}

function stop_svc(svc){
  try {
    execSync('/usr/bin/systemctl stop '+svc);
    return 0;
  } catch(err){ return err.status||true; }
}

function start_svc(svc){ execSync('/usr/bin/systemctl start '+svc); }

function install_svc(svc, dst){
  let s = fs.readFileSync(dst+'/'+svc+'.service').toString();
  // XXX: set WantedBy in the service with the output of systemctl get-default
  const server_file = '/var/lif/server/server.js';
  s = s.replace(new RegExp(escape.regex(server_file), 'gi'), dst+'/server.js');
  fs.writeFileSync('/etc/systemd/system/'+svc+'.service', s);
  execSync('systemctl daemon-reload');
  execSync('/usr/bin/systemctl enable '+svc);
}

function get_node_ver(){
  let ver;
  try {
    ver = string.split_ws(execSync('/usr/bin/env node --version')
    .toString())[0].replace('v', '');
  } catch(err){}
  return ver;
}

const main = ()=>etask(function*main(){
  // XXX: ask to disable dns and configure /etc/resolve.conf
  this.on('uncaught', err=>xerr.xexit(err));
  let svc = 'lif_server';
  let old_conf, old_conf_file = lif_dir+'/server/conf.json';
  let ip, domain;
  if (fs.existsSync(old_conf_file)){
    old_conf = (yield import(old_conf_file, {assert: {type: 'json'}})).default;
    ip = opt_array(old_conf.ip);
    domain = old_conf.domain;
  }
  console.log('Install LIF Server');
  let et_ip = get_my_ip();
  yield prompt.start();
  prompt.message = null;
  let node_ver = get_node_ver();
  if (ver_util.cmp(node_ver, NODE_MIN_VER)<0){
    console.error('Node version too old %s, required >=%s', node_ver,
      NODE_MIN_VER);
    process.exit(1);
  }
  let update = is_yes((yield prompt.get({name: 'val', type: 'string',
    required: true, default: 'No',
    validator: validate_yes_no,
    description: 'Checkout latest LIF GIT repository (Y/N)'})).val);
  let dst_root = (yield prompt.get({name: 'val', type: 'string',
    required: true, default: lif_dir, validator: validate_dir,
    description: 'Install dir'})).val;
  let new_ip = yield et_ip;
  if (new_ip){
    if (ip && !ip.find(s=>s==new_ip)){
      console.warn('NOTE: previous ip %s differnt than host ip %s',
        ip, new_ip);
    } else
      ip = [new_ip];
  }
  ip = split_ws((yield prompt.get({name: 'val', type: 'string', required: true,
    default: ip ? ip.join(' ') : '', validator: validate_ip,
    description: 'Server public IPs (space-seperated)'})).val);
  domain = split_ws((yield prompt.get({name: 'val', type: 'string',
    default: domain ? domain.join(' ') : '', required: true,
    validator: validate_domain,
    description: 'Server domains (space-seperated)'})).val);
  if (dst_root.slice(-1)=='/')
    dst_root = dst_root.substr(0, dst_root.length-1);
  let keys_dir = dst_root+'/keys';
  let ssl_dir = dst_root+'/ssl';
  let dst = dst_root+'/server';
  let src = cwd;
  let tmp = dst+'.tmp';
  let prev = dst+'.prev';
  let tmp_conf_file = tmp+'/conf.json';
  let tmp_id_file = tmp+'/install_id';
  console.log('Installing LIF server ip [%s] domain [%s] at %s',
    ip.join(' '), domain.join(' '), dst);
  if (update){
    console.log('Checkout latest LIF GIT repository');
    execSync('git pull');
    execSync('git checkout');
  }
  let git_head = yield get_git_head();
  if (!git_head)
      xerr.xexit('Failed to get git head');
  let need_prev = true;
  if (!fs.existsSync(keys_dir)){
    console.log('Creating keys_dir %s', keys_dir);
    fs.mkdirSync(keys_dir, {recursive: true});
  }
  if (!fs.existsSync(ssl_dir)){
    console.log('Creating ssl_dir %s', ssl_dir);
    fs.mkdirSync(ssl_dir, {recursive: true});
  }
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
  let conf_new = gen_conf(conf, {git_head, install_ts: date.to_sql_ms(ts), ip,
    domain, keys_dir, ssl_dir});
  fs.writeFileSync(tmp_conf_file, conf_str(conf_new));
  if (is_svc_running(svc)){
    console.log('Stop service %s', svc);
    if (stop_svc(svc))
      xerr.xexit('Failed top stop service '+svc);
  }
  if (need_prev){
    console.log('Remove old prev dir %s', prev);
    fs.rmSync(prev, {recursive: true, force: true});
    console.log('Save prev copy %s', prev);
    fs.renameSync(dst, prev);
  }
  console.log('Move tmp dir to be new version %s', dst);
  fs.renameSync(tmp, dst);
  console.log('Install service %s', svc);
  install_svc(svc, dst);
  console.log('Start service %s', svc);
  start_svc(svc);
  console.log();
});

main();
