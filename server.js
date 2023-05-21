#! /usr/bin/env node
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import assert from 'assert';
import Node from './net/node.js';
import Conf from './util/conf.js';
import efile from './util/efile.js';
import Scroll_conf from './storage/conf.js';
import Soul from './storage/soul.js';
import DB from './storage/db.js';
import Git from './fs/git.js';
import dnss from './net/dnss.js';
import ssl from './net/ssl.js';
import etask from './util/etask.js';
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import browserify from 'browserify';
import util from './util/util.js';
import buf_util from './net/buf_util.js';
const b2s = buf_util.buf_to_str;
const {opt_array} = util;
const cwd = process.cwd();
let server_et;

proc.xexit_init(do_exit);

function do_exit(err){
  if (/bind EADDRINUSE [0-9.]*:53/.test(err)){
    xerr('*** cannot bind dns port 53 - EADDRINUSE ***\n'+
      'There is another application using port 53 (eg systemd-resolved).\n'+
      'You need to disable that application.\n'+
      '*** How to stop it?\n'+
      'sudo systemctl stop systemd-resolved\n'+
      'sudo systemctl disable systemd-resolved\n'+
      '\nNOTE: you may lose Internet connectivity after that change.\n'+
      'To fix it modify /etc/resolv.conf to enable local dns:\n'+
      '1. get your ISP dns servers or check it out with\n'+
      '   resolvectl status\n'+
      '2. update /etc/resolv.conf with your ISP dns server:\n'+
      '   nameserver 8.8.8.8 # replace 8.8.8.8 with your ISP ip\n'+
      '3. For local development also add to /etc/resolv.conf\n'+
      '   nameserver 127.0.0.1 # it must be the first nameserver\n');
  }
  else if (/bind EACCES [0-9.]*:53/.test(err)){
    xerr('*** cannot bind dns port 53 - EACCES ***\n'+
      'Run again with root permission (sudo)\n');
  }
  xerr.xexit(err);
}

function sni_cb(server_name, cb){
  let domain = dnss.get_our_domain(server_name);
  if (!domain){
    let err = 'domain not handled '+domain;
    xerr('server: %s', err);
    return cb(err, null);
  }
  let ctx = ssl.get_ctx(domain);
  if (!ctx){
    let err = 'failed to get ssl ctx for '+domain;
    xerr('server: %s', err);
    return cb(err, null);
  }
  cb(null, ctx);
}

const http_start = opt=>etask({_: this}, function*http_start(){
  xerr.notice('server: start http %s https %s', opt.http, opt.https);
  let {app_dir, build_dir} = opt;
  let app = express();
  let http_server = http.createServer(app).listen(opt.http);
  let https_server = https.createServer({SNICallback: sni_cb}, app)
  .listen(opt.https);
  // XXX: check caching/other headers and wrap all nicely
  // XXX: rm in production
  app.get('/.lif/test.html',
    (req, res)=>res.sendFile(app_dir+'/www/test.html'));
  // XXX: fix test files to include mocha from local include
  app.get('/.lif/test_util.html',
    (req, res)=>res.sendFile(app_dir+'/www/test_util.html'));
  app.get('/.lif/test_storage.html',
    (req, res)=>res.sendFile(app_dir+'/www/test_storage.html'));
  app.get('/.lif/test_net.html',
    (req, res)=>res.sendFile(app_dir+'/www/test_net.html'));
  app.get('/.lif/test_fs.html',
    (req, res)=>res.sendFile(app_dir+'/www/test_fs.html'));
  app.get('/.lif/build/util_test.bundle.js',
    test_serve('util/test.js', app_dir, build_dir));
  app.get('/.lif/build/net_test.bundle.js',
    test_serve('net/test.js', app_dir, build_dir));
  app.get('/.lif/build/storage_test.bundle.js',
    test_serve('storage/test.js', app_dir, build_dir));
  app.get('/.lif/build/fs_test.bundle.js',
    test_serve('fs/test.js', app_dir, build_dir));
  // XXX: use link rel='modulepreload'
  app.get('/', (req, res)=>res.sendFile(app_dir+'/www/index.html'));
  app.get('/.lif.sw.js', (req, res)=>res.sendFile(app_dir+'/www/sw.js'));
  app.get('/.lif/lif_node.bundle.js',
    (req, res)=>res.sendFile(build_dir+'/lif_node.bundle.js'));
  // XXX: review babel/favicon
  app.get('/.lif.babel.js', (req, res)=>
    res.sendFile(app_dir+'//node_modules/@babel/standalone/babel.js'));
  app.get('/.lif.favicon.svg',
    (req, res)=>res.sendFile(app_dir+'/www/favicon.svg'));
  this.spawn(browserify_js(build_dir, build_dir+'/lif_node.bundle.js',
    [app_dir+'/net/node.js'], {debug: true, standalone: 'lif_node'}));
  return {app, http_server, https_server};
});

const lif_node_start = (soul, https_server)=>etask(function*lif_node_start(){
  // XXX: support wrtc+stun
  let node = new Node({https_server, ...soul.keypair});
  xerr.notice('lif node id %s', node.id.s);
});

const get_boot_scroll = opt=>etask(function*get_boot_scroll(){
  let {dir, soul_name, boot_root} = opt;
  assert(dir, 'missing boot dir');
  assert(soul_name, 'missing soul soul_name');
  assert(boot_root, 'missing boot_root');
  let soul_dir = dir+'/soul/'+soul_name;
  let soul = yield soul_init({name: soul_name, soul_dir});
  let boot = yield Scroll_conf.open({M: boot_root, soul, db: true});
  assert(boot.top.seq>0, 'boot scroll is empty');
  xerr.notice('boot: using boot scroll %s');
  return boot;
});

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

const start_git = soul=>etask(function*start_git(){
  let conf = {}; // XXX TODO
  if (!conf.soul.git?.enable)
    return xerr.notice('git: clone is disabled');
  let settings = soul.get(soul.conf.get('root'));
  let keypair = soul.keypair; // XXX: allow to scroll.create get it from soul
  assert(settings, 'missing soul settings root');
  let git_dir = conf.soul.git.dir; // XXX ||dir+'/git';
  xerr.notice('git: clone is enabled at %s', git_dir);
  let a = opt_array(conf.soul.git.clone), cfid = 0;
  for (let i=0; i<a.length; i++){
    let src = a[i].toLowerCase(); // XXX: normalize
    xerr.notice('git: clone %s', src);
    // XXX: fix find_one_data api to auto-calc bseq if not provided
    let bseq = settings.get_bseq_top(cfid, '0').bseq;
    let git, o = yield settings.find_one_data(src, {dir: 'dn',
      name: 'git.src', cfid, bseq}), M = o?.data.M;
    if (!M){
      git = yield Git.create({soul, ...keypair, db: true}, {git: {src}});
      M = git.name;
      xerr.notice('git: clone scroll %s src %s', git.name, src);
      yield git.flush();
      // XXX derry: review and decide how to define deep links
      // (and link to last seal)
      yield settings.decl({git: {src}, M});
      yield settings.flush();
    } else {
      git = yield Git.open({M, soul, ...keypair, db: true});
      xerr.notice('git: load scroll %s src %s', M, src);
    }
    xerr.notice('git: sync %s src %s top %s top_oid %s', M, src,
      git.top.seq, yield git.get_git_br_top_oid(cfid, 'main'));
    yield git.sync({dir: git_dir+'/'+Git.escape_url(src)});
    yield git.flush(); // XXX: do it autoatically on process exit
    xerr.notice('git: sync DONE %s src %s top %s top_oid %s', M, src,
      git.top.seq, yield git.get_git_br_top_oid(cfid, 'main'));
  }
});

const browserify_map = {};
const browserify_js = (build_dir, target, files, opt={})=>
  etask(function*browserify_js(){
  // XXX: hack. need better memory map and also don't generate if in disk)
  let key = target+JSON.stringify(opt);
  if (browserify_map[key])
    return this.wait_ext(browserify_map[key]);
  let wait = browserify_map[key] = etask.wait();
  xerr.notice('server: browserfiy %s', target);
  fs.mkdirSync(build_dir, {recursive: true});
  var b = browserify(opt);
  b.add(files);
  let stream = fs.createWriteStream(target);
  stream.on('close', ()=>{
    xerr.notice('server: browserify %s DONE', target);
    wait.continue();
  });
  stream.on('error', err=>{
    xerr('server: browserify error %s', err);
    wait.reject(err);
  });
  b.bundle().pipe(stream);
  return wait;
});

function test_serve(test, app_dir, build_dir){
  return (req, res)=>etask(function*(){
    let file = test.replaceAll('/', '_').replace('.js', '.bundle.js');
    yield browserify_js(build_dir, build_dir+'/'+file,
      [app_dir+'/'+test], {debug: true, ignoreMissing: true});
    res.sendFile(build_dir+'/'+file);
  });
}

const main = ()=>etask(function*main(){
  assert(!server_et, 'server alredy running');
  this.on('uncaught', e=>xerr.xexit(e));
  server_et = this;
  let init_conf_file = /^\/var\/lif\//.test(cwd) ?
    '/var/lif/conf.json' : '/var/lif.dev/conf.json';
  if (!(yield efile.exists(init_conf_file)))
    init_conf_file = '/var/lif.dev/conf.json';
  xerr.notice('boot: init conf %s', init_conf_file);
  let init_conf = new Conf(init_conf_file);
  try { yield init_conf.init(); }
  catch(err){
    xerr.notice('boot: %s not found\nRun: script/lif.js init --dev');
    throw err;
  }
  let dir = init_conf.get('dir');
  let boot = yield get_boot_scroll({dir, soul_name: init_conf.get('soul'),
    boot_root: init_conf.get('boot')});
  let soul = boot.soul;
  let conf = yield boot.get('');
  let domain = opt_array(conf.domain);
  let ip = opt_array(conf.ip);
  let dev = !!conf.dev;
  let ssl_dir = dir+'/ssl';
  xerr.notice('boot: startup mode %s domain: %s ip: %s',
    dev ? 'DEV' : 'PROD', domain.join(','), ip.join(','));
  assert(ip?.length, 'missing server ip, check conf.json');
  assert(domain?.length, 'missing domain, check conf.json');
  yield dnss.start({ip: conf.ip, domain: conf.domain, ...conf.dnss});
  yield ssl.start({ssl_dir, dnss, conf});
  let app_dir = cwd;
  let build_dir = cwd+'/build';
  // XXX: allow to enable/disable http from conf
  let {https_server} = yield http_start({http: 80, https: 443,
    app_dir, build_dir});
  yield lif_node_start(soul, https_server);
  if (0) // XXX TODO
    server_et.spawn(start_git(soul));
  return etask.wait();
});

main();

// TODO:
// - fix net client
//   - save node id in persistent storage (scroll?)
//   o fix node_map.js del_conn() + test
//   o review+test 'connected' event
//   o support msg sign/verify
// - fix json loading (don't use experimental feature) and use conf api
// - cleanup all XXX in server.js
// - BUG: setTimeout overflow (float/bigint supported?)
//   etask.setTimeout/setInterval
// - allow to put more info to acme cert
// - allow to set ttl for txt response

// LATER:
// - wrtc+stun (after lif-chain)

// From derry:
// lif.zone --> DNS Q server
// - domain that asking and doesn't exist
// - domain that existing and default
// - domain that use dns entries (A, CNAME,...)
// https://derry.lif.zone --> simple page to "buy" domain
// Service Worker and HTTPXmlRequest/fetch()
// .lif .lif.*
// arik.lif.zone/.lif/get-chunk-hfhdf
// arik.lif.zone/.lif.sw.js --> loads LIF net engine
// arik.lif.zone/.lif.index.html
// arik.lif.zone/ html content type: servce .lif.index.html
// you surf to arik.lif.zone. server gets HTML req, and responds 302
//   /.lif.index.html
// which loads /.lif.sw.js
// sw.js loads the LIF networking engine, which currently supports websocket.
// it opens a connection to the server: /.lif.ws (written in /.lif.sw.js)
// (websocket URL...)
// lif<->db

// conf --> boot scroll --> dns csv --> arik.lif.zone domain --> domain storage
// dns root M0
// decl to 10: M0+10, M10, M10-tip
// XXX tip is algorithm (eg. only tip that had no dispute in last 6m)
// link also defined permissions (eg. this scroll is only for dns)
// js bitcoin lib as base for lif-chain (find the best one)
