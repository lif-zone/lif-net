#! /usr/local/bin/node
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import assert from 'assert';
import dnss from '../net/dnss.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import conf from './conf.json' assert {type: 'json'};
const cwd = process.cwd();

proc.xexit_init(do_exit);
xerr.on_unhandled_exception = err=>assert.fail(err);

function do_exit(err){
  // XXX: improve error message and sepcify how to completely disable dns
  if (/bind EADDRINUSE [0-9.]*:53/.test(err)){
    xerr('*** dns port 53 already bind.\n*** stop local dns server:\n'+
      'sudo systemctl stop systemd-resolved\n');
  }
  xerr.xexit(err);
}

function http_start(port){
  const app = express();
  http.createServer(app).listen(port);
  return app;
}

const main = ()=>etask(function*main(){
  let dir = cwd.replace('/server', ''); // XXX: HACK
  xerr.notice('run lif server %s cwd %s dir %s',
    conf.production ? 'PRODUCTION' : 'DEV', cwd, dir);
  dnss.start({ip: conf.ip, domain: conf.domain});
  let app = http_start(80);
  app.use('/', express.static(dir));
  app.get('/', xxx_handler);
});

function xxx_handler(req, res){
  res.send(`<html>
    <body><div id=root>LIF</div></body>
  <html>`);
}

main();

/* XXX TODO
1. server/main.js
2. save configuration at server/conf.json
3. npm run install --> /var/lif/server
4. questions during install to generate conf
   install dir: /var/lif/server
   server ip: try to get using what is myip service
   domains:

*/
