#!/usr/bin/env node
// author: derry. coder: arik.
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import getopt from 'node-getopt';
import {execSync} from 'node:child_process';

proc.xexit_init();
let gopt = getopt.create([['D', '=+', 'date']]).bindHelp(
    'Usage:\n'+
    '  cvsdiff [file|dir]\n'+
    '  cvsdiff -D "2 month ago" [file|dir]\n'+
    '  cvsdiff -D "2024-01-30 13:00" [file|dir]\n'+
    '  cvsdiff -D "2 month ago" -D "3 month ago" [file|dir]\n'
  ).parseSystem();

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

function git_cvsdiff(argv, options){
  let rev = '';
  if (options.D && options.D.length){
    options.D.forEach(d=>rev+=' `git rev-list -n 1 --before="'+d+'" main` ');
  }
  execSync('git difftool '+rev+' '+argv.join(' '));
}

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  let {argv, options} = gopt;
  if (!is_git())
    return run_cvs();
  return git_cvsdiff(argv, options);
});

main();
