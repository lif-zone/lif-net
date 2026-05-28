// http://localhost:4000/?/lif-net//www/test_net_lif.js
import chai from 'chai';
import mocha from 'mocha';
mocha.setup({ui: 'bdd', bail: true, timeout: 50000});
mocha.checkLeaks();
import net_test from '../net/test.js';
mocha.run();

