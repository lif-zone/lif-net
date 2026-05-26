import chai from 'chai';
import mocha form 'mocha';
mocha.setup({ui: 'bdd', bail: true, timeout: 50000});
mocha.checkLeaks();
import test_bundle from '../.lif/build/net_test.bundle.js';
mocha.run();

