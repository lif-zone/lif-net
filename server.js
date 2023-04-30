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
  app.use('/', express.static(dir));
  app.get('/', xxx_handler);
});

function xxx_handler(req, res){
  // XXX: if conf.production use react.production.min version
  let map = {imports: {
        react: '../node_modules/react/umd/react.development.js?'+
          'lif_compile=umd_to_es6&lif_compile_opt=React',
        'react-dom': '../node_modules/react-dom/umd/react-dom.development.js?'+
          'lif_compile=umd_to_es6&lif_compile_opt=ReactDOM'
      }
  };
  res.send(`<html>
    <head>
      <script type=importmap>${JSON.stringify(map)}</script>
      <script async type=module src=www/loader.js></script>
      <link rel=icon href=www/favicon.svg>
    </head>
    <body></body>
  </html>`);
}

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
