#! /usr/bin/env node
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import assert from 'assert';
import Node from './net/node.js';
import crypto from './util/crypto.js';
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
import { parseArgs } from 'util';
import util from './util/util.js';
import buf_util from './net/buf_util.js';
const s2b = buf_util.buf_from_str, b2s = buf_util.buf_to_str;
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

const http_start = opt=>etask({_: this}, function*http_start(){
  xerr.notice('server: start http %s https %s', opt.http, opt.https);
  let {app_dir, build_dir} = opt, file_cert = opt.cert, file_key = opt.key;
  let app = express();
  let http_server = http.createServer(app).listen(opt.http);
  let https_server;
  xerr.notice('https: cert %s key %s', file_cert, file_key);
  let cert = yield fs.promises.readFile(file_cert);
  let key = yield fs.promises.readFile(file_key);
  https_server = https.createServer({cert, key}, app);
  https_server.listen(opt.https);
  // XXX: check caching/other headers and wrap all nicely
  // XXX: rm in production
  app.get('/',
    (req, res)=>res.sendFile(app_dir+'/www/test.html'));
  app.get('/.lif/test.html',
    (req, res)=>res.sendFile(app_dir+'/www/test.html'));
  app.get('/.lif/test.js',
    (req, res)=>res.sendFile(app_dir+'/www/test.js'));
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

const lif_node_start = (keypair, https_server)=>etask(function*lif_node_start(){
  let node = new Node({https_server, ...keypair});
  xerr.notice('server: node id %s', node.id.s);
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
  const {values} = parseArgs({options: {
    http: {type: 'string', default: '80'},
    https: {type: 'string', default: '443'},
    cert: {type: 'string', default: './net/localhost.crt'},
    key: {type: 'string', default: './net/localhost.key'},
  }});
  values.http = +values.http;
  values.https = +values.https;
  assert(!server_et, 'server alredy running');
  this.on('uncaught', e=>xerr.xexit(e));
  server_et = this;
  let dir = cwd+'/build';
  yield efile.mkdirp_e(dir);
  let init_conf_file = dir+'/conf.json';
  xerr.notice('argv: --http %s --https %s --cert %s --key %s',
	  values.http, values.https, values.cert, values.key);
  xerr.notice('boot: dir %s', dir);
  let init_conf = new Conf(init_conf_file);
  yield init_conf.init({create: true});
  let app_dir = cwd;
  let build_dir = dir+'/build';
  yield efile.mkdirp_e(build_dir);
  yield efile.mkdirp_e(app_dir);
  let {https_server} = yield http_start({http: values.http,
    https: values.https, app_dir, build_dir, cert: values.cert, key: values.key});
  let key = init_conf.get('key');
  let pub = init_conf.get('pub');
  if (!key){
    let keypair = yield crypto.keypair(crypto.crypt_def);
    key = b2s(keypair.key);
    pub = b2s(keypair.pub);
    init_conf.set('key', key);
    init_conf.set('pub', pub);
  }
  yield lif_node_start({key: s2b(key), pub: s2b(pub)}, https_server);
  return etask.wait();
});

main();

// TODO:
// - BUG: setTimeout overflow (float/bigint supported?)
// - replace all fs.promises with efile api
//   etask.setTimeout/setInterval
// - allow to put more info to acme cert
// - allow to set ttl for txt response
// - fix net client
//   o fix node_map.js del_conn() + test
//   o review+test 'connected' event
//   o support msg sign/verify
// - cleanup all XXX in server.js

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
