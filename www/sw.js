// author: derry. coder: arik.
'use strict';
self.importScripts('../node_modules/@babel/standalone/babel.js');
const Babel = self.Babel;

async function init(){
  try {
    self.addEventListener('install', async()=>console.log('sw: install'));
    console.log('sw: init');
    // XXX: this is needed to activate the worker immediately without reload
    // @see https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle#clientsclaim
    self.addEventListener('activate',
      event=>event.waitUntil(self.clients.claim()));
    self.addEventListener('fetch', event=>{
      let {request: {url}} = event;
      let url_o = new URL(url);
      if (!url_o.search)
        return;
      let o = new URLSearchParams(url_o.search);
      if (!o.get('lif_compile'))
        return;
      let lif_compile = o.get('lif_compile');
      let lif_compile_opt = o.get('lif_compile_opt');
      if (!lif_compile)
        return;
      console.log('sw: fetch %s compile %s %s', url,
        lif_compile, lif_compile_opt);
      // XXX: do we do it here or from fetch source? need cache
      switch (lif_compile){
      case 'umd_to_es6':
        if (!lif_compile_opt)
          return console.error('sw: missing lif_compile_opt %s', url);
        // XXX: handle errors + preserve original headers + caching
        event.respondWith(fetch(url).then(response=>response.text())
        .then(body=>new Response(body+'\n'+
          'export default window.'+lif_compile_opt+';', {
          headers: new Headers({'Content-Type': 'application/javascript'})})));
        break;
      case 'jsx':
        // XXX: handle errors + preserve original headers + caching
        // XXX: plugins: ['proposal-dynamic-import']}
        event.respondWith(fetch(url).then(response => response.text())
        .then(body => new Response(Babel.transform(body,
          {presets: ['react']}).code, {
          headers: new Headers({'Content-Type': 'application/javascript'})})));
        break;
      default:
        return console.error('sw: unsupported lif_compile %s', url);
      }
      /* XXX: support import without js extension?
      } else if (url.endsWith('.js')) { // rewrite for import('./Panel') with no extension
        event.respondWith(
          fetch(url)
            .then(response => response.text())
            .then(body => new Response(
              body,
              {
                headers: new Headers({
                  'Content-Type': 'application/javascript'
                })
            })
          )
        )
      }
    */
    });
  } catch(err){ console.error('sw: error', err); }
}

init();
