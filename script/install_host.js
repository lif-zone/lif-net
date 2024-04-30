#!/usr/bin/env node
// author: derry. coder: arik.
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import {execSync} from 'node:child_process';
proc.xexit_init();

function execSync_safe(){
  try { execSync.apply(this, arguments); } catch(err){}
}

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  // XXX: save copy of previous install dir (copy logic from install.js)
  let src = execSync('git rev-parse --show-toplevel').toString();
  src = src.replace('\r', '').replace('\n', '');
  let dst = '/var/lif.host';
  console.log('Installing host tools on %s', dst);
  execSync_safe('mkdir '+dst);
  execSync('cp -rf '+src+'/* '+dst+'/');
  execSync('npm install /var/lif.host');
  execSync_safe('chmod +x '+dst+'/script/jcvs.js');
  execSync_safe('ln -sn '+dst+'/script/jcvs.js /usr/local/bin/jcvs');
  execSync_safe('ln -sn '+dst+'/script/jcvs.js /usr/local/bin/cvsdiff');
  execSync_safe('ln -sn '+dst+'/script/jcvs.js /usr/local/bin/zdiff');
});

main();
