// author: derry. coder: arik.
'use strict';
import xerr from './xerr.js';
import xutil from './util.js';
import assert from 'assert';
const E = {}, env = process.env;
export default E;

// XXX: review xexit_init vs init
E.xexit_init = cb=>{
  cb = cb || function xexit_on_err(err){ xerr.xexit(err); };
  // XXX: why not use xerr.set_exception_handler?
  xerr.on_exception = function(err){
    if (!(err instanceof TypeError || err instanceof ReferenceError
        || err instanceof assert.AssertionError)){
        return;
    }
    // on node, fetch error reported as TypeError
    if (err.message=='fetch failed')
      return;
    if (env.ZEXIT_ON_TYPEERROR===undefined || +env.ZEXIT_ON_TYPEERROR)
      return cb(err);
    console.error('etask_typeerror '+err);
  };
  if (!xutil.is_mocha()){
    process.on('uncaughtException', cb);
    process.on('unhandledRejection', cb);
    xerr.on_unhandled_exception = cb;
  }
};

E.init = ()=>{
  process.on('uncaughtException', err=>xerr.xexit(err));
  process.on('unhandledRejection', err=>xerr.xexit(err));
  xerr.set_exception_handler('proc', (prefix, o, err)=>xerr.xexit(err));
};
