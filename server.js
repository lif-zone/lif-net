#! /usr/bin/env node
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import https from 'https';
import assert from 'assert';
import dnss from './net/dnss.js';
import ssl from './net/ssl.js';
import etask from './util/etask.js';
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import conf from './util/conf.js';
const cwd = process.cwd();

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
  const app = express();
  http.createServer(app).listen(port);
  https.createServer({SNICallback: sni_cb}, app).listen(ssl_port);
  return app;
}

// XXX: check caching/other headers
function index_html_handler(req, res){ res.sendFile(cwd+'/www/index.html'); }

// XXX: check caching/other headers
function sw_handler(req, res){ res.sendFile(cwd+'/www/sw.js'); }

// XXX: check caching/other headers
function favicon_handler(req, res){ res.sendFile(cwd+'/www/favicon.svg'); }

// XXX: check caching/other headers
function babel_handler(req, res){
  res.sendFile(cwd+'//node_modules/@babel/standalone/babel.js');
}

const main = ()=>etask(function*main(){
  let dir = cwd;
  xerr.notice('run lif server %s cwd %s dir %s',
    conf.production ? 'PRODUCTION' : 'DEV', cwd, dir);
  assert(conf.ip, 'missing server ip, check conf.json');
  assert(conf.domain, 'missing domain, check conf.json');
  yield dnss.start({ip: conf.ip, domain: conf.domain, ...conf.dnss});
  yield ssl.start({dnss, conf});
  // XXX: need config www
  // XXX: need dynamic reload on src change
  // XXX: use link rel='modulepreload'
  let app = http_start(80, 443);
  app.use(function(req, res, next){
    // XXX: set CORS/caching
    res.setHeader('Service-Worker-Allowed', '/');
    next();
  });
  // XXX: rm in production
  app.use('/.lif/src/', express.static(cwd));
  app.get('/.lif/test_util.html',
    (req, res)=>res.sendFile(cwd+'/www/test_util.html'));
  app.get('/.lif/test_storage.html',
    (req, res)=>res.sendFile(cwd+'/www/test_storage.html'));
  app.get('/', index_html_handler);
  app.get('/.lif.sw.js', sw_handler);
  // XXX: review babel/favicon
  app.get('/.lif.babel.js', babel_handler);
  app.get('/.lif.favicon.svg', favicon_handler);
});

main();

/* XXX derry:;
- review how to loader react modules
- local development: google-chrome --ignore-certificate-errors
- properly handle service-worker during load of service-worker + update
- lif_compile: umd_to_es6
- importScript in sw
- expose all source code under / (it includes also conf file)
- remove obsolete util/url.js
*/
