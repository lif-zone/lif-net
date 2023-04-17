#! /usr/local/bin/node
// author: derry. coder: arik.
import express from 'express';
import http from 'http';
import dnss from '../net/dnss.js';
const cwd = process.cwd();

function http_start(port){
  const app = express();
  http.createServer(app).listen(port);
  return app;
}

async function start(){
  let dir = cwd.replace('/server', ''); // XXX: HACK
  console.log('XXX start cwd %s dir %s', cwd, dir);
  let app = http_start(8000);
  app.use('/', express.static(dir));
  app.get('/', xxx_handler);
}

function xxx_handler(req, res){
  res.send(`<html>
    <body><div id=root>LIF</div></body>
  <html>`);
}

start();
