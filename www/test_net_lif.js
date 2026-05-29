// http://localhost:4000/?/lif-net//www/test_net_lif.js
import 'lif-kernel/compat/node_env.js';
import 'chai';
import mocha from 'mocha';
function html_elm_frag(html){
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.children; // returns HTMLCollection
}

document.head.append(...html_elm_frag(`<link rel="stylesheet" href="https://unpkg.com/mocha/mocha.css" />`));
document.body.append(...html_elm_frag(`
  <h1>LIF Test</h1>
  <div id=mocha></div>
`));

mocha.setup({ui: 'bdd', bail: true, timeout: 50000});
mocha.checkLeaks();
await import('../net/test.js');
mocha.run();

