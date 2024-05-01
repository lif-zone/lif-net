#!/usr/bin/env node
// author: derry. coder: arik.
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import {execSync} from 'node:child_process';
proc.xexit_init();

function execSync_safe(){
  try { execSync.apply(this, arguments); } catch(err){} }

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  // XXX: save copy of previous install dir (copy logic from install.js)
  let src = execSync('git rev-parse --show-toplevel').toString();
  src = src.replace('\r', '').replace('\n', '');
  let dst = '/var/lif.host';
  console.log('Installing host tools on %s', dst);
  execSync_safe('rm -rf '+dst);
  execSync_safe('rm /usr/local/bin/jcvs');
  execSync_safe('rm /usr/local/bin/cvsup');
  execSync_safe('rm /usr/local/bin/cvsdiff');
  execSync_safe('rm /usr/local/bin/zlint');
  execSync_safe('rm /usr/local/bin/zdiff');
  execSync_safe('mkdir '+dst);
  execSync('cp -rf '+src+'/* '+dst+'/');
  execSync_safe('ln -sn '+dst+'/script/jcvs.js /usr/local/bin/jcvs');
  execSync_safe('ln -sn '+dst+'/script/cvsup.js /usr/local/bin/cvsup');
  execSync_safe('ln -sn '+dst+'/script/cvsdiff.js /usr/local/bin/cvsdiff');
  execSync_safe('ln -sn '+dst+'/script/cvsdiff.js /usr/local/bin/zdiff');
  execSync_safe('ln -sn '+dst+'/script/zlint.js /usr/local/bin/zlint');
  execSync('cp -rf '+src+'/script/vimrc_lif.vim /etc/vim/');
  console.log('\nINSTALL VIM Plugins:\n'+
    '  Add to ~/.vimrc at the end of the file:\n'+
    '  runtime vimrc_lif.vim');


});

main();
