// author: derry. coder: arik.
import etask from '../util/etask.js';
import https_server from '../lib/https_server.js';

async function start(){
  console.log('MVP Start');
  https_server.start();
//  return etask.wait();
}

function exit(msg){
  console.error(msg);
  process.exit(1);
}

start();
