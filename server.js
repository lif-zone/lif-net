#! /usr/bin/env node
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import assert from 'assert';
import Node from './net/node.js';
import Scroll from './storage/scroll.js';
import Soul from './storage/soul.js';
import DB from './storage/db.js';
import Storage_handler from './storage/storage.js';
import Git from './fs/git.js';
import dnss from './net/dnss.js';
import ssl from './net/ssl.js';
import etask from './util/etask.js';
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import conf from './util/conf.js';
import crypto from './util/crypto.js';
import browserify from 'browserify';
import util from './util/util.js';
import buf_util from './net/buf_util.js';
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;
const {opt_array} = util;
const cwd = process.cwd();
const dir = conf.production ? conf.install_dir+'/server' : cwd;
const build_dir = dir+'/build';
let server_et;

proc.xexit_init(do_exit);

function do_exit(err){
  // XXX: improve error message and sepcify how to completely disable dns
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
    return cb(Error(err), null);
  }
  let ctx = ssl.get_ctx(domain);
  if (!ctx){
    let err = 'failed to get ssl ctx for '+domain;
    xerr('server: %s', err);
    return cb(Error(err), null);
  }
  cb(null, ctx);
}

function http_start(port, ssl_port){
  let app = express();
  let http_server = http.createServer(app).listen(port);
  let https_server = https.createServer({SNICallback: sni_cb}, app)
  .listen(ssl_port);
  return {app, http_server, https_server};
}

// XXX: check caching/other headers
function index_html_handler(req, res){ res.sendFile(dir+'/www/index.html'); }

// XXX: check caching/other headers
function sw_handler(req, res){ res.sendFile(dir+'/www/sw.js'); }

// XXX: check caching/other headers
function lif_node_handler(req, res){
  res.sendFile(build_dir+'/lif_node.bundle.js'); }

// XXX: check caching/other headers
function favicon_handler(req, res){ res.sendFile(dir+'/www/favicon.svg'); }

// XXX: check caching/other headers
function babel_handler(req, res){
  res.sendFile(dir+'//node_modules/@babel/standalone/babel.js');
}

const lif_node_start = https_server=>etask(function*lif_node_start(){
  // XXX: save node id
  let node = new Node({https_server});
  xerr.notice('lif node id %s', node.id.s);
});

// XXX: mv to generic place
const load_keypair = (file_key, file_pub)=>etask(function*load_keypair(){
  let key, pub;
  try { key = yield fs.promises.readFile(file_key, 'utf8'); }
  catch(err){ return xerr('server: failed to load key %s', file_key); }
  try { pub = yield fs.promises.readFile(file_pub, 'utf8'); }
  catch(err){ return xerr('server: failed to load pub %s', file_pub); }
  return {key: s2b(key), pub: s2b(pub)};
});

// XXX: mv to generic place
class Conf {
constructor(file){ this.file = file; }

init(){ return etask({_: this}, function*conf_init(){
  let _this = this._, file = _this.file;
  assert(!_this.inited, 'conf already inited '+file);
  _this.inited = true;
  try { yield fs.promises.access(file, fs.R_OK|fs.W_OK);
  } catch(err){
    xerr.notice('conf: create new %s', file);
    _this.conf = {};
    yield fs.promises.writeFile(file, _this.str(_this.conf), 'utf8');
    return conf;
  }
  xerr.notice('conf: loading %s', file);
  let s = yield fs.promises.readFile(file, 'utf8');
  return _this.conf = JSON.parse(s);
}); }

save(){ return etask({_: this}, function*conf_save(){
  let _this = this._;
  // XXX: need to copy existing version and make this operation safe
  yield fs.promises.writeFile(_this.file, _this.str(_this.conf), 'utf8');
}); }

get(path, val){ return util.get(this.conf, path); }

set(path, val){ return etask({_: this}, function*conf_set(){
  let _this = this._;
  util.set(_this.conf, path, val);
  yield _this.save(); // XXX: need to automatic flush
}); }

str(){ return JSON.stringify(this.conf, null, '  '); }
}

const soul_start = ()=>etask(function*soul_start(){
  if (!conf.soul?.enable)
    return xerr.notice('server: soul is disabled');
  xerr.notice('server: soul is enabled');
  let dir = conf.soul.dir||conf.dir+'/soul';
  let conf_soul = new Conf(dir+'/conf.json');
  yield conf_soul.init();
  let file_key = dir+'/priv.key', file_pub = dir+'/pub.key';
  let keypair = yield load_keypair(file_key, file_pub);
  if (keypair)
    xerr.notice('server: using keypair pub %s from %s', b2s(keypair.pub), dir);
  else if (!keypair){
    let crypt = Scroll.supported_crypt[0];
    keypair = yield crypto.keypair(crypt);
    xerr.notice('server: create new keypair pub %O at %s', b2s(keypair.pub),
      dir);
    yield fs.promises.writeFile(file_pub, b2s(keypair.pub).toString(), 'utf8');
    yield fs.promises.writeFile(file_key, b2s(keypair.key).toString(), 'utf8');
  }
  if (!conf.soul.storage?.enable)
    return xerr('server: storage is disabled');
  let storage_dir = conf.soul.storage.dir||dir+'/storage';
  xerr.notice('server: storage is enabled at %s', storage_dir);
  yield DB.init({shim_conf: {checkOrigin: false, databaseBasePath: storage_dir,
    useSQLiteIndexes: true}});
  // XXX: need to save keypair in soul and a way to load/storre soul
  let soul = new Soul({name: 'server', conf: conf_soul, keypair});
  yield soul.db.init({postfix: soul.name});
  let storage = new Storage_handler({db: soul.db});
  let root = conf_soul.get('root'), settings;
  if (root){
    settings = yield Scroll.open({M: root, soul, ...keypair, storage});
    xerr.notice('server: load soul settings %s', root);
  } else {
    settings = yield Scroll.create({soul, ...keypair, storage},
      {index: [{field: 'git.src', data: ['M']}]});
    yield settings.flush(); // XXX: do it autoatically on process exit
    xerr.notice('server: create soul settings %s', settings.name);
    yield conf_soul.set('root', settings.name);
  }
  return soul;
});

const start_git = soul=>etask(function*start_git(){
  if (!conf.soul.git?.enable)
    return xerr.notice('git: clone is disabled');
  let settings = soul.get(soul.conf.get('root'));
  let keypair = soul.keypair; // XXX: allow to scroll.create get it from soul
  assert(settings, 'missing soul settings root');
  let git_dir = conf.soul.git.dir||dir+'/git';
  xerr.notice('git: clone is enabled at %s', git_dir);
  let a = opt_array(conf.soul.git.clone), cfid = 0;
  for (let i=0; i<a.length; i++){
    let src = a[i].toLowerCase(); // XXX: normalize
    xerr.notice('git: clone %s', src);
    // XXX: fix find_one_data api to auto-calc bseq if not provided
    let bseq = settings.get_bseq_top(cfid, '0').bseq;
    let git, o = yield settings.find_one_data(src, {dir: 'dn',
      name: 'git.src', cfid, bseq}), M = o?.data.M;
    let storage = new Storage_handler({db: soul.db});
    if (!M){
      git = yield Git.create({soul, ...keypair, storage}, {git: {src}});
      M = git.name;
      xerr.notice('git: clone scroll %s src %s', git.name, src);
      yield git.flush();
      // XXX derry: review and decide how to define deep links
      // (and link to last seal)
      yield settings.decl({git: {src}, M});
      yield settings.flush();
    } else {
      git = yield Git.open({M, soul, ...keypair, storage});
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
const browserify_js = (target, files, opt={})=>etask(function*browserify_js(){
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

function test_serve(test){
  return (req, res)=>etask(function*(){
    let file = test.replaceAll('/', '_').replace('.js', '.bundle.js');
    yield browserify_js(build_dir+'/'+file,
      [dir+'/'+test], {debug: true});
    res.sendFile(build_dir+'/'+file);
  });
}

const main = ()=>etask(function*main(){
  assert(!server_et, 'server alredy running');
  this.on('uncaught', e=>xerr.xexit(e));
  server_et = this;
  xerr.notice('run lif server %s cwd %s dir %s',
    conf.production ? 'PRODUCTION' : 'DEV', cwd, dir);
  assert(conf.ip, 'missing server ip, check conf.json');
  assert(conf.domain, 'missing domain, check conf.json');
  yield dnss.start({ip: conf.ip, domain: conf.domain, ...conf.dnss});
  yield ssl.start({dnss, conf});
  // XXX: need config www
  // XXX: need dynamic reload on src change
  // XXX: use link rel='modulepreload'
  let {app, https_server} = http_start(80, 443);
  yield lif_node_start(https_server);
  let soul = yield soul_start();
  server_et.spawn(start_git(soul));
  app.use(function(req, res, next){
    // XXX: set CORS/caching
    res.setHeader('Service-Worker-Allowed', '/');
    next();
  });
  // XXX: rm in production
  app.get('/.lif/test.html', (req, res)=>res.sendFile(dir+'/www/test.html'));
  // XXX: fix test files to include mocha from local include
  app.get('/.lif/test_util.html',
    (req, res)=>res.sendFile(dir+'/www/test_util.html'));
  app.get('/.lif/test_storage.html',
    (req, res)=>res.sendFile(dir+'/www/test_storage.html'));
  app.get('/.lif/test_net.html',
    (req, res)=>res.sendFile(dir+'/www/test_net.html'));
  app.get('/.lif/test_fs.html',
    (req, res)=>res.sendFile(dir+'/www/test_fs.html'));
  app.get('/.lif/build/util_test.bundle.js', test_serve('util/test.js'));
  app.get('/.lif/build/net_test.bundle.js', test_serve('net/test.js'));
  app.get('/.lif/build/storage_test.bundle.js', test_serve('storage/test.js'));
  app.get('/.lif/build/fs_test.bundle.js', test_serve('fs/test.js'));
  app.get('/', index_html_handler);
  app.get('/.lif.sw.js', sw_handler);
  app.get('/.lif/lif_node.bundle.js', lif_node_handler);
  // XXX: review babel/favicon
  app.get('/.lif.babel.js', babel_handler);
  app.get('/.lif.favicon.svg', favicon_handler);
  yield browserify_js(build_dir+'/lif_node.bundle.js', [dir+'/net/node.js'],
    {debug: true, standalone: 'lif_node'});
  return etask.wait();
});

main();
