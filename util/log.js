// author: derry. coder: arik.
'use strict';
import * as date from './date.js';
export default log;

let log_a = [];

function log(s, o){
  log_a.push(date.to_sql_time_ms()+' '+s);
  console.log(date.to_sql_time_ms()+' '+s, o);
  document.querySelector('#log').innerText = log_a.join('\n');
}

