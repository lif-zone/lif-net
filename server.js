#! /usr/bin/env -S node --no-warnings
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import assert from 'assert';
import dnss from './net/dnss.js';
import acme from './net/acme.js';
import etask from './util/etask.js';
import date from './util/date.js';
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

function http_start(port){
  const app = express();
  http.createServer(app).listen(port);
  return app;
}

const main = ()=>etask(function*main(){
  let dir = cwd;
  xerr.notice('run lif server %s cwd %s dir %s',
    conf.production ? 'PRODUCTION' : 'DEV', cwd, dir);
  assert(conf.ip, 'missing server ip, check conf.json');
  assert(conf.domain, 'missing domain, check conf.json');
  dnss.start({ip: conf.ip, domain: conf.domain, ...conf.dnss});
  let app = http_start(80);
  app.use('/', express.static(dir));
  app.get('/', xxx_handler);
  acme.start({dnss, domain: conf.domain, keys_dir: conf.keys_dir,
    ssl_dir: conf.ssl_dir});
});

function xxx_handler(req, res){
  let ts = conf.install_ts;
  let now = date.to_sql_ms(date());
  res.send(`<html>
    <body>
      <div id=root>LIF install_ts ${ts} now ${now}</div>
      <pre>${JSON.stringify(conf, null, '  ')}</pre>
    </body>
  <html>`);
}

main();

/* XXX TODO
2. save configuration at server/conf.json
3. npm run install --> /var/lif/server
4. questions during install to generate conf
   install dir: /var/lif/server
   server ip: try to get using what is myip service
   domains:

*/
