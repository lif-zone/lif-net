// author: derry. coder: arik.
'use strict';
// XXX: use sw to allow import React from 'react'
// https://medium.com/disdj/react-jsx-es-module-imports-dynamic-too-in-browser-without-webpack-9cf39520f20f

// XXX: change to etask
async function load(){
  try {
    if (!navigator.serviceWorker)
      throw new Error('serviceWorker not supported');
    console.log('loader: register sw');
    await navigator.serviceWorker.register('www/sw.js', {scope: '/'});
    await navigator.serviceWorker.ready;
    console.log('loader: sw ready');
    const launch = async()=>{
      console.log('loader: load index.js');
      let index = await import('./index.js?lif_compile=jsx');
      index.default();
    };
    // this launches the React app if the SW has been installed before or immediately after registration
    // https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle#clientsclaim
    if (navigator.serviceWorker.controller)
      await launch();
    else
      navigator.serviceWorker.addEventListener('controllerchange', launch);
  } catch(error){
    console.error('loader: service worker registration failed', error);
  }
}

load();
