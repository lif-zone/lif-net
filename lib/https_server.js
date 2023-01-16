// author: derry. coder: arik.
'use strict';
import fs from 'fs';
import express from 'express';
import http from 'http';
import https from 'https';
import escape from 'escape-html';
import conf from '../server.conf.js';
const E = {}, cwd = process.cwd();
export default E;
let debug_get_log_func;

E.start = opt=>{
/* XXX TODO
  let _opt = {
    key: fs.readFileSync(conf.http_server.ssl.key),
    cert: fs.readFileSync(conf.http_server.ssl.cert),
  };
*/
  const {http_port, https_port} = conf.http_server;
  const app = E.app = express();
  if (0){ // XXX: rm from here
    app.get('/index.js', (req, res)=>res.sendFile(cwd+'/pub/index.js'));
    app.get('/bundle.js', (req, res)=>res.sendFile(cwd+'/pub/bundle.js'));
    app.get('*', (req, res)=>res.sendFile(cwd+'/pub/index.html'));
  }
  console.log('https_server: listen on ports %s,%s', http_port, https_port);
  http.createServer(app).listen(http_port);
  if (0) // XXX TODO
    https.createServer(_opt, app).listen(https_port);
};

E.close = ()=>{}; // XXX: TODO
