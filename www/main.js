// author: derry. coder: arik.
import express from 'express';
import http from 'http';


function http_start(port){
  const app = express();
  http.createServer(app).listen(port);
  return app;
}

async function start(){
  console.log('XXX start');
  let app = http_start(8000);
  app.get('/', xxx_handler);
}

function xxx_handler(req, res){
  res.send(`<html>
    <body><div id=root>LIF</div></body>
  <html>`);
}

start();
