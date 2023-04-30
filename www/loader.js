// author: derry. coder: arik.
'use strict';
// XXX: use sw to allow import React from 'react'
// https://medium.com/disdj/react-jsx-es-module-imports-dynamic-too-in-browser-without-webpack-9cf39520f20f
import * as _React from 'react';
import * as _ReactDOM from 'react-dom';
const {React, ReactDOM} = window;

console.log('XXX lif loader.js');

function init(){
  let container  = document.createElement('div');
  document.body.append(container);
  let root = ReactDOM.createRoot(container);
  root.render('Hi LIF');
}

init();
