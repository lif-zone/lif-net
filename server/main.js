#! /usr/local/bin/node
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import assert from 'assert';
import dnss from '../net/dnss.js';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
const cwd = process.cwd();

proc.init();
proc.xexit_init();
xerr.on_unhandled_exception = err=>assert.fail(err);

function http_start(port){
  const app = express();
  http.createServer(app).listen(port);
  return app;
}

const main = ()=>etask(function*main(){
  let dir = cwd.replace('/server', ''); // XXX: HACK
  xerr.notice('run lif server cwd %s dir %s', cwd, dir);
  dnss.start({ip: '127.0.0.1',
    domain: ['lif.biz', 'lif.center', 'lif.company']});
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
2. save configuration at server/main.conf.js
3. npm run install --> /var/lif/server
4. questions during install to generate conf
   install dir: /var/lif/server
   server ip: try to get using what is myip service
   domains:
   email (optional) // to send alerts (ssl issue, hd full,...)

*/
