#!/usr/bin/env node
// author: derry. coder: arik.
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import proc from '../util/proc.js';
import efile from '../util/efile.js';
import path from 'path';
proc.xexit_init();

const main = ()=>etask(function*main(){
  this.on('uncaught', e=>xerr.xexit(e));
  let src = path.resolve(proc.get_script_dir(), '../');
  let dst = '/var/lif.host';
  console.log('Installing host tools %s from %s', dst, src);
  // XXX: make install safe. save copy of prev install (copy from install.js)
  yield efile.rm_rf_e(dst);
  yield efile.rm_rf_e('/usr/local/bin/jcvs');
  yield efile.rm_rf_e('/usr/local/bin/cvsup');
  yield efile.rm_rf_e('/usr/local/bin/cvsdiff');
  yield efile.rm_rf_e('/usr/local/bin/zlint');
  yield efile.rm_rf_e('/usr/local/bin/zdiff');
  yield efile.mkdir_e(dst);
  yield efile.copy_dir_e(src, dst);
  yield efile.symlink_e(dst+'/script/jcvs.js', '/usr/local/bin/jcvs');
  yield efile.symlink_e(dst+'/script/cvsup.js', '/usr/local/bin/cvsup');
  yield efile.symlink_e(dst+'/script/cvsdiff.js', '/usr/local/bin/cvsdiff');
  yield efile.symlink_e(dst+'/script/cvsdiff.js', '/usr/local/bin/zdiff');
  yield efile.symlink_e(dst+'/script/zlint.js', '/usr/local/bin/zlint');
  yield efile.copy_e(dst+'/script/vimrc_lif.vim', '/etc/vim/vimrc_lif.vim');
  console.log('\nTO FINISH INSTALL VIM PLUGINS add to end of ~/.vimrc: '+
    'runtime vimrc_lif.vim');
});

main();
