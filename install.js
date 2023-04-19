#! /usr/local/bin/node
// author: derry. coder: arik.
import xerr from './util/xerr.js';
import proc from './util/proc.js';
import etask from './util/etask.js';

proc.xexit_init();

const main = ()=>etask(function*main(){
  xerr('XXX install');
});

main();
