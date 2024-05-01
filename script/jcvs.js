#!/usr/bin/env node
// author: derry. coder: arik.
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import getopt from 'node-getopt';
import {execSync} from 'node:child_process';

/* XXX TODO
git clone git@github.com:xarikgilad/lif-zone-src.git
+ cvsup
+ jcvs diff file/dir
  + jcvs diff
  + cvs diff -D "2 weeks ago"
  + cvs diff -D "2 weeks ago" -D "3 weeks ago"
  + cvs diff -D "2024-10-13 13:52"
+ gvim diff
  + cvsdiff file
  + cvsdif -D "2 weeks ago"
  + cvsdiff -D "2 weeks ago" -D "3 weeks ago"
  + cvsdiff -D "2024-10-13 13:52"
+ zdiff
+ jcvs ci file/dir
+ jcvs add file/dir
+ jcvs rm file/dir
+ zlint file/dir
+ :CVSAnnotate
+ rgrep
? rt
? add -v to commands to show actual command being executed?
? jcvs up file/dir (not supported in GIT)
- improve help/usage (copy from spark)
- what to do if not git? cvsdiff/zlint/cvsup doesn't exist on LIF VM
+ simple install script (no prev copy for backup, very hacky implementation)
- add instructions for server debug
- add instructions for web debug
- rename xerr -> zerr
*/

proc.xexit_init();
let gopt = getopt.create([
  ['d', 'd=directory', ''],
  ['D', '=+', 'date'],
  ]).bindHelp(
    'Usage:\n'+
    '  jcvs co repository -d [dir]\n'+
    '  jcvs ci [file|dir]\n'+
    '  jcvs commit [file|dir]\n'+
    '  jcvs add [file|dir]\n'+
    '  jcvs rm [file|dir]\n'+
    '  jcvs di [file|dir]\n'+
    '  jcvs diff [file|dir]\n'+
    '  jcvs diff -D "2 month ago" [file|dir]\n'+
    '  jcvs diff -D "2024-01-30 13:00" [file|dir]\n'+
    '  jcvs diff -D "2 month ago" -D "3 month ago" [file|dir]\n'
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

function do_error(gopt, msg){
  if (msg)
    console.error(msg);
  gopt.showHelp();
  process.exit(1);
}

const git_ci = argv=>etask(function*git_ci(){
  try { execSync('git commit '+argv.join(' '), {stdio: 'inherit'}); }
  catch(err){ return; }
  execSync('git push');
});

function git_diff(argv, options){
  let rev = '';
  if (options.D && options.D.length){
    options.D.forEach(d=>rev+=' `git rev-list -n 1 --before="'+d+'" main` ');
  }
  let ret = execSync('git diff -U0 -p '+rev+' '+argv.join(' '));
  console.log(ret.toString());
}

function git_add(argv){ execSync('git add '+argv.join(' ')); }

function git_rm(argv){ execSync('git rm '+argv.join(' ')); }

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  let {argv, options} = gopt;
  if (!is_git())
    return run_cvs();
  let cmd = argv[0];
  argv.shift();
  switch (cmd){
    case 'ci':
    case 'commit':
      if (!argv[0])
        do_error(gopt, '*** missing [file/dir] eg: jcvs ci .\n');
      return git_ci(argv);
    case 'di':
    case 'diff':
      return git_diff(argv, options);
    case 'add': return git_add(argv);
    case 'rm':
      if (!argv[0])
        do_error(gopt, '*** missing [file/dir]\n');
      return git_rm(argv);
  default: do_error(gopt, 'Unknown command for GIT: '+cmd);
  }
});

main();
