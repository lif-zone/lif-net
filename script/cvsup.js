#!/usr/bin/env node
// author: derry. coder: arik.
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import {execSync} from 'node:child_process';

proc.xexit_init();
function is_git(){
  try { execSync('git status', {stdio: 'ignore'}); }
  catch(err){ return false; }
  return true;
}

function run_cvs(){
  let a = Array.from(process.argv);
  if (/\bnode$/.test(a[0]))
    a.shift();
  return execSync(a.join(' '));
}

function git_cvsup(){
  execSync('git pull');
  let ret = execSync('git status -s');
  console.log(ret.toString());
}

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  if (!is_git())
    return run_cvs();
  return git_cvsup();
});

main();
