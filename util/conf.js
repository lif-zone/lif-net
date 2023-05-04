// author: derry. coder: arik.
'use strict';
import conf_def from '../conf_def.json' assert {type: 'json'};
import conf from '../conf.json' assert {type: 'json'};
import conf_dev from '../conf_dev.json' assert {type: 'json'};
import util from './util.js';
const E = util.extend_deep({}, conf_def, conf);
if (!conf.production)
  util.extend_deep(E, conf_dev);
export default E;
