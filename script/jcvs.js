#!/usr/bin/env node
// author: derry. coder: arik.
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import getopt from 'node-getopt';
import {exec, execSync} from 'node:child_process';

/* XXX TODO
jcvs co git@github.com:xarikgilad/lif-zone-src.git -d lif
jcvs co git@github.com:xarikgilad/home.git -d home
jcvs co lif -d lif
jcvs co home -d home

# command line diff
jcvs diff file/dir

# update and show modified file status
cvsup

# update file/dir
jcvs up file/dir

# gvim diff
cvsdiff file
 -D "2 weeks ago"
 -D "2024-10-13 13:52"

# commit
jcvs ci file/dir

# add file/dir
jcvs add file/dir

# rm file/dir
jcvs rm file/dir

# lint
zlint file/dir

# gvim menu
:CVSAnnotate

# rgrep

# add instructions for server debug
# add instructions for web debug
# rename xerr -> zerr
*/

proc.xexit_init();
let gopt = getopt.create([
  ['d', 'd=directory', ''],
  ]).bindHelp(
    'Usage:\n'+
    '  jcvs co repository -d [dir]\n'+
    '  jcvs cvsup\n'+
    '  jcvs ci [file|dir]\n'+
    '  jcvs commit [file|dir]\n'+
    '  cvsup\n'
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

function git_cvsup(){
  execSync('git pull');
  let ret = execSync('git status -s');
  console.log(ret.toString());
}

const git_ci = argv=>etask(function*git_ci(){
  try { execSync('git commit '+argv.join(' '), {stdio: 'inherit'}); }
  catch(err){ return; }
  execSync('git push');
});

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  let {argv, options} = gopt;
  if (!is_git())
    return run_cvs();
  let cmd = argv[0];
  argv.shift();
  switch (cmd){
    case 'cvsup':
      if (argv[0])
        do_error(gopt, 'Invalid argument');
      return git_cvsup();
    case 'ci':
    case 'commit':
      if (!argv[0])
        do_error(gopt, 'Missing file/dir');
      return git_ci(argv);
  default: do_error(gopt, 'Unknown command for GIT: '+cmd);
  }
});

main();
