// author: derry. coder: arik.
'use strict';
import React from 'react';
import ReactDOM from 'react-dom';

export default function init(){
  let container = document.createElement('div');
  document.body.append(container);
  let root = ReactDOM.createRoot(container);
  root.render('Hi LIF');
}
