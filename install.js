#! /usr/local/bin/node
// author: derry. coder: arik.
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import etask from './util/etask.js';
import prompt from 'prompt'; // XXX: fix vim coloring

proc.xexit_init();

const main = ()=>etask(function*main(){
  console.log('Install LIF Server');
  yield prompt.start(); // XXX: fix vim coloring
  prompt.message = null;
  let ret = yield prompt.get({name: 'dir', type: 'string', required: true,
    default: '/var/lif/server', // XXX: fix vim coloring
    description: 'Install dir',
    validator: function(){ console.log('XXX %O', arguments); },
    });
  xerr('XXX result %O', ret);
});

main();
