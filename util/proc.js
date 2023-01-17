// author: derry. coder: arik.
'use strict';
import xerr from './xerr.js';
import xutil from './util.js';
import assert from 'assert';
const E = {}, env = process.env;
export default E;

E.xexit_init = ()=>{
  function xexit_on_err(err){ xerr.xexit(err); }
  xerr.on_exception = function(err){
    if (!(err instanceof TypeError || err instanceof ReferenceError
        || err instanceof assert.AssertionError)){
        return;
    }
    if (env.ZEXIT_ON_TYPEERROR===undefined || +env.ZEXIT_ON_TYPEERROR)
      return xexit_on_err(err);
    console.error('etask_typeerror '+err);
  };
  if (!xutil.is_mocha())
    process.on('uncaughtException', xexit_on_err);
};

E.init = ()=>{
  process.on('uncaughtException', err=>xerr.xexit(err));
  process.on('unhandledRejection', err=>xerr.xexit(err));
  xerr.set_exception_handler('proc', (prefix, o, err)=>xerr.xexit(err));
};
