'use strict'; /*eslint-env mocha*/
import assert from 'assert';
import {execSync} from 'node:child_process';
import etask from '../util/etask.js';
import xtest from '../util/test_lib.js';
import {test_run, test_register, test_register_cmd}
  from '../storage/test_cmd.js'; // XXX: mv to generic place

xtest.init();

const test_run_single = (curr, o, step)=>etask(function*_test_run_single(){
  switch (o.cmd){
  // case 'rm': yield cmd_rm(o); break;
  default: return false;
  }
  return true;
});

const test_start = ()=>etask(function*test_start(){
});

test_register_cmd(test_run_single);
test_register('start', test_start);

describe('dnss', ()=>{
  const t = (name, test)=>it(name, ()=>test_run(test));
  t('xxx', ``);
});
