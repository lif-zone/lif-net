// author: derry. coder: arik.
'use strict';
import React from 'react';
import ReactDOM from 'react-dom';

const Header = props=>{
  let {dns_o} = props;
  return <div>
    <h1>Domain: {dns_o.domain}</h1>
    <h2>Door: {dns_o.door}</h2>
  </div>;
};

class Page extends React.Component {
  render(){
    let {dns_o} = this.props;
    return <div><Header dns_o={dns_o}/><div>XXX</div></div>;
  }
}

// XXX: mv to generic place + test
function parse_lif_url(url){
  let url_o = new URL(url);
  if (!url_o.host)
    return;
  let a = url_o.host.split('.');
  let domain = a.shift();
  let door = a.join('.');
  // XXX derry: review naming convention (arik.lif.biz)
  return {domain, door};
}

export default function init(){
  let container = document.createElement('div');
  container.style = 'width: 100%; height: 100%;';
  document.body.append(container);
  let root = ReactDOM.createRoot(container);
  let dns_o = parse_lif_url(location.href);
  root.render(<Page dns_o={dns_o}/>);
}
