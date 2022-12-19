// author: derry. coder: arik.
'use strict'; /*jslint node:true*/
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
    if (err.sent_perr)
      return;
    err.sent_perr = true;
    console.error('etask_typeerror '+err);
  };
  if (!xutil.is_mocha())
    process.on('uncaughtException', xexit_on_err);
};
