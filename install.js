#! /usr/bin/env -S node
// author: derry. coder: arik.
import fs from 'fs';
import {execSync} from 'node:child_process';
import xerr from './util/xerr.js';
import efile from './util/efile.js';
import proc from './util/proc.js';
import ver_util from './util/ver_util.js';
import etask from './util/etask.js';
import Conf from './util/conf.js';
import string from './util/string.js';
import date from './util/date.js';
import util from './util/util.js';
import Soul from './storage/soul.js';
import Scroll_conf from './storage/conf.js';
import DB from './storage/db.js';
import escape from './util/escape.js';
import buf_util from './net/buf_util.js';
import getopt from 'node-getopt';
const b2s = buf_util.buf_to_str;
const {split_trim} = string;
const {opt_array} = util;
const cwd = process.cwd();
const ts = date();
const NODE_MIN_VER = '18.6.0';
proc.xexit_init();
let gopt = getopt.create([
  ['', 'domain=ARG', 'list of domains'],
  ['', 'ip=ARG', 'list of ips'],
  ]).bindHelp(
    'Usage:\n'+
    '   install.js --domain --ip\n'
  ).parseSystem();

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

// XXX: copy from server.js
const soul_init = opt=>etask(function*soul_init(){
  let {name, soul_dir} = opt;
  let file_key = soul_dir+'/'+name+'.key';
  let file_pub = soul_dir+'/'+name+'.pub';
  let keypair = yield Soul.read_keypair(file_key, file_pub);
  let soul = new Soul({name: 'server', keypair});
  let db_dir = soul_dir+'/db';
  yield DB.init({db_dir});
  xerr.notice('soul: init pub %s at %s', b2s(keypair.pub), soul_dir);
  return soul;
});

// XXX: copy from server.js
const get_boot_scroll = opt=>etask(function*get_boot_scroll(){
  let {dir, soul_name, boot_root} = opt;
  let soul_dir = dir+'/soul/'+soul_name;
  let soul = yield soul_init({name: soul_name, soul_dir});
  let boot = yield Scroll_conf.open({M: boot_root, soul, db: true});
  return boot;
});

const main = ()=>etask(function*main(){
  let {options} = gopt;
  // XXX: ask to disable dns and configure /etc/resolve.conf
  this.on('uncaught', err=>xerr.xexit(err));
  let et_ip = get_my_ip();
  let lif_dir = '/var/lif';
  let src_dir = cwd;
  let dst_dir = lif_dir+'/server';
  let tmp_dir = dst_dir+'.tmp';
  let prev_dir = dst_dir+'.prev';
  let conf_file = lif_dir+'/conf.json';
  let svc = 'lif_server';
  let domain = split_trim(options.domain||'', /[;, ]/);
  let ip = split_trim(options.ip||'', /[;, ]/);
  console.log('Install server %s', lif_dir);
  let node_ver = get_node_ver();
  if (ver_util.cmp(node_ver, NODE_MIN_VER)<0){ // XXX: do_exit
    console.error('Node version too old %s, required >=%s', node_ver,
      NODE_MIN_VER);
    process.exit(1);
  }
  if (is_svc_running(svc)){
    console.log('Stop service %s', svc);
    if (stop_svc(svc))
      xerr.xexit('Failed top stop service '+svc);
  }
  if (!(yield efile.exists(lif_dir))){
    console.log('Init %s', lif_dir);
    execSync('./script/lif.js init');
  }
  console.log('Load conf %s', conf_file);
  let conf = new Conf(conf_file);
  yield conf.init();
  let boot = yield get_boot_scroll({dir: lif_dir,
    soul_name: conf.get('soul'), boot_root: conf.get('boot')});
  if (!ip.length)
    ip = [yield et_ip];
  let prev_ip = opt_array(yield boot.get('ip'));
  let need_ip = !util.equal_deep(ip, prev_ip);
  let prev_domain = opt_array(yield boot.get('domain'));
  let need_domain = !util.equal_deep(domain, prev_domain);
  if (!domain.length && !prev_domain.length){ // XXX: wrap with do_exit
    console.error('Missing --domain');
    gopt.showHelp();
    process.exit(1);
  }
  if (need_ip || need_domain){
    let o = {};
    if (need_ip){
      console.log('Change ip %s -> %s', prev_ip.join(','), ip.join(','));
      o.ip = ip;
    }
    if (need_domain){
      console.log('Change domain %s -> %s', prev_domain.join(','),
        domain.join(','));
      o.domain = domain;
    }
    yield boot.decl(o);
    yield boot.flush();
  }
  // XXX: soul/DB uninit + flush
  console.log('Config domain: %s', domain.join(', '));
  console.log('Config ip: %s', ip.join(', '));
  console.log('Build npm dependency');
  execSync('npm install');
  if (yield efile.exists(tmp_dir)){
    console.log('Remove tmp_dir %s', tmp_dir);
    yield efile.rm_rf_e(tmp_dir);
  }
  console.log('Copy %s -> %s', src_dir, tmp_dir);
  // XXX: efile.copy(src_dir, tmp_dir);
  yield fs.promises.cp(src_dir, tmp_dir, {force: true, recursive: true});
  if (yield efile.exists(dst_dir)){
    if (yield efile.exists(prev_dir)){
      console.log('Remove %s', prev_dir);
      yield efile.rm_rf_e(prev_dir);
    }
    console.log('Copy %s -> %s', dst_dir, prev_dir);
    yield efile.rename_e(dst_dir, prev_dir);
  }
  console.log('Move %s -> %s', tmp_dir, dst_dir);
  yield efile.rename_e(tmp_dir, dst_dir);
  return;
  console.log('Install service %s', svc);
  install_svc(svc, dst_dir);
  console.log('Start service %s', svc);
  start_svc(svc);
  console.log();
});

main();
