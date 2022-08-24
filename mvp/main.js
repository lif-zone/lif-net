// author: derry. coder: arik.
import https_server from '../lib/https_server.js';
const cwd = process.cwd();

async function start(){
  console.log('MVP Start');
  https_server.start();
  let app = https_server.app;
  app.get('/_', debug_handler);
  app.get('/pub/debug.bundle.js',
    (req, res)=>res.sendFile(cwd+'/pub/debug.bundle.js'));
}

function debug_handler(req, res){
  res.send(`<html>
    <script src=pub/debug.bundle.js></script>
    <body><div id=root></div></body>
  <html>`);
}

start();
