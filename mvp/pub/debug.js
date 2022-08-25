// author: derry. coder: arik.
'use strict'; /*jslint node:true, browser:true*/
// XXX run: npm run mvp-bundle && node ./main.js
import React from 'react';
import ReactDOM from 'react-dom';
import LIF from '../lif.js';
import crypto from '../../util/crypto.js';
import buf_util from '../../peer-relay/buf_util.js';
const b2s = buf_util.buf_to_str;

class DebugPage extends React.Component {
  state = {dd: []};
  componentDidMount(){
    let keys, keys_str = localStorage.getItem('lif_keypair');
    if (keys_str){
      console.log('found keys %s', keys_str);
      keys = crypto.keypair_from_str(keys_str);
    } else {
      keys = crypto.keypair();
      keys_str = crypto.keypair_to_str(keys);
      localStorage.setItem('lif_keypair', keys_str);
      console.log('new keys %s', keys_str);
    }
    this.setState({keys});
  }
  render(){
    let {keys, dd} = this.state;
    if (!keys)
      return <div>Loading keys...</div>;
    return <div>
      <h1>LIF Debug Page</h1>
      <div>
        <button onClick={this.on_new_scroll}>New scroll</button>
      </div>
      <div>
        http_get_uri domain: <input defaultValue='derry.lif.zone'></input>
        uri: <input defaultValue='/'></input>
        <button onClick={this.on_http_get_uri}>go</button>
      </div>
      <table>
        <tbody>
          <tr><td>pub:</td><td><pre>{b2s(keys.pub)}</pre></td></tr>
          <tr><td>key:</td><td><pre>{b2s(keys.key)}</pre></td></tr>
        </tbody>
      </table>
      <div>
        <div>scroll:</div>
        {dd.map(item=><div key={item.to_str()}>{item.to_str()}</div>)}
      </div>
    </div>;
  }
  on_new_scroll = ()=>{
    let {keys} = this.state;
    let scroll = new LIF.Scroll({keys});
    scroll.on('decl', this.on_new_decl);
    scroll.decl({scroll: {topic: 'http',
      domain: 'derry.lif.zone',
      default: ['crypt', 'pub', 'scroll.topic', 'scroll.domain']}});
    scroll.decl({http_record: {uri: '/', mime: 'html'}},
      '<html><body>derry</body></html>');
    scroll.decl({http_record: {uri: '/about', mime: 'html'}},
      '<html><body>about derry</body></html>');
  };
  on_new_decl = l=>{
    this.setState(state=>{
      return {dd: state.dd.concat(l)};
    });
  };
  on_http_get_uri = ()=>{
    LIF.http_get_uri('derry.lif.zone', '/');
  }
}

function init(){
  const root = document.querySelector('#root');
  const create_element = React.createElement;
  ReactDOM.render(create_element(DebugPage), root);
}

if (document.readyState=='complete')
  init();
else
  window.addEventListener('load', init);

/* XXX remove
import crypto from 'crypto';
import queryString from 'query-string';
import util from '../util/util.js';
import date from '../util/date.js';
import debug from '../lib/debug.js';
const bstr = util.buf_to_str;
import SimplePeer from 'simple-peer';
let qs_o = queryString.parse(location.search);
let qs_port = qs_o.port||3032;
let qs_storage = qs_o.storage||'lif';
let qs_dst = qs_o.dst;
let qs_no_wrtc = qs_o.no_wrtc;
let node, page, g_data = 'PING', g_dst=qs_dst, g_log = [];
SimplePeer.WEBRTC_SUPPORT = !+qs_no_wrtc;

function peer_id(id){ return debug.peer_id(node, id); }

function init(){
  console.log('XXX debug.js');
  if (location.pathname=='/' &&
    location.hostname=='poc.lif.zone')
  {
    document.body.innerHTML = '<div id=react_root></div>';
    peer_relay_init();
  }
  else if (window.self!==window.top)
    document.body.innerHTML = 'iframe for '+location.href;
  else
  {
    document.body.innerHTML = '<iframe src="'+
      encodeURI(location.pathname)+'"></iframe>';
  }
}

class Peer extends React.Component {
  on_send = ()=>send(this.props.peer.id, g_data);
  on_connect = ()=>connect(this.props.peer.id);
  on_find_peers = ()=>find_peers(this.props.peer.id);
  on_ping = ()=>ping(this.props.peer.id);
  on_disconnect = ()=>disconnect(this.props.peer.id);
  on_peer = ()=>page.setState({dst: g_dst = bstr(this.props.peer.id)});
  render(){
    let {peer} = this.props;
    let s = {cursor: 'pointer'};
    return <div>
      <span style={s} onClick={this.on_peer}>
        <span>{peer_id(bstr(peer.id))}</span>
        {peer.ws ? <span> ws {peer.ws.url} </span> : <span> wrtc </span>}
        <span> id {bstr(peer.id)} </span>
      </span>
      <button onClick={this.on_send}>send</button>
      <button onClick={this.on_connect}>connect</button>
      <button onClick={this.on_find_peers}>find_peers</button>
      <button onClick={this.on_ping}>ping</button>
      <button onClick={this.on_disconnect}>disconnect</button>
    </div>;
  }
}

function Peers(props){
  let a = [], {peers} = props;
  if (peers)
  {
    peers.forEach(peer=>a.push(<Peer peer={peer}
      key={bstr(peer.id)}/>));
  }
  return a;
}

class Page extends React.Component {
  constructor(props){
    super(props);
    page = this;
  } // XXX HACK: find proper way to do it
  state = {dst: g_dst};
  on_data = e=>g_data = e.target.value;
  on_dst = e=>{
    g_dst = e.target.value;
    this.setState({dst: g_dst});
  };
  on_send = ()=>send(g_dst, g_data);
  on_connect = ()=>connect(g_dst);
  on_find_peers = ()=>find_peers(g_dst);
  on_ping = ()=>ping(g_dst);
  on_disconnect = ()=>disconnect(g_dst);
  on_server = e=>{
    qs_o.port = e.target.value;
    location.search = queryString.stringify(qs_o);
  }
  on_storage = e=>{
    qs_o.storage = e.target.value;
    location.search = queryString.stringify(qs_o);
  };
  on_disable_wrtc = e=>{
    qs_o.no_wrtc = e.target.checked ? 1 : 0;
    location.search = queryString.stringify(qs_o);
  }
  render(){
    let {peers, log, id, dst} = this.state;
    return <div>
      <div>
        <b>Connected to:</b>
        <select onChange={this.on_server} value={qs_port}>
          <option value='3032'>Port 3032</option>
          <option value='3033'>Port 3033</option>
        </select>
        <b> localStorage prefix</b>
        <input defaultValue={qs_storage} onChange={this.on_storage}/>
        <span> </span>
        <a rel='noreferrer' href={'/__lif_debug_get_log?'+
          queryString.stringify({port: qs_port})} target='_blank'>
          Server Log
        </a>
        <input type='checkbox' checked={!SimplePeer.WEBRTC_SUPPORT}
          onChange={this.on_disable_wrtc}/><span> disable wrtc</span>
      </div>
      <hr/>
      <div>
        <b>Dst</b> <input value={dst}
          onChange={this.on_dst}/>
        <b> Data</b> <input defaultValue={g_data} onChange={this.on_data}/>
        <button onClick={this.on_send}>send</button>
        <button onClick={this.on_connect}>connect</button>
        <button onClick={this.on_find_peers}>find_peers</button>
        <button onClick={this.on_ping}>ping</button>
        <button onClick={this.on_disconnect}>disconnect</button>
      </div>
      <div>
        <div><b>Peers</b></div>
        <div><b>Self</b> {debug.peer_id(0, id)} {id}</div>
        <Peers peers={peers}/>
      </div>
      <hr/>
      <div>
        <b>Log</b>
        <pre>{log}</pre>
      </div>
    </div>;
  }
}

function add_to_log(s){
  g_log.push(date.to_time_ms()+': '+s);
  page.setState({log: Array.from(g_log).reverse().join('\n')});
}

function send(dst, data){
  if (!dst)
    return add_to_log(`error missing dst`);
  add_to_log(`node: >msg dst ${peer_id(dst)} ${data}`);
  node.send(util.buf_from_str(dst), data);
}

function connect(dst, data){
  if (!dst)
    return add_to_log(`error missing dst`);
  add_to_log(`node: connect dst ${peer_id(dst)}`);
  node.connect(util.buf_from_str(dst), data);
}

function find_peers(dst, data){
  if (!dst)
    return add_to_log(`error missing dst`);
  add_to_log(`node: find_peers dst ${peer_id(dst)}`);
  node.findPeers(util.buf_from_str(dst));
}

function ping(dst){ send(dst, 'PING'); }

function disconnect(dst){
  if (!dst)
    return add_to_log(`error missing dst`);
  add_to_log(`node: disconnect dst ${peer_id(dst)}`);
  node.disconnect(util.buf_from_str(dst));
}

function peer_relay_init(){
  window.addEventListener('error', e=>{
    add_to_log('error '+e.message);
    // eslint-disable-next-line
    debugger;
  });
  let id_name = qs_storage+'_node_id';
  let id = localStorage[id_name];
  if (!id)
    id = localStorage[id_name] = bstr(crypto.randomBytes(20));
  const react_root = document.querySelector('#react_root');
  const create_element = React.createElement;
  ReactDOM.render(create_element(Page), react_root);
  node = new Node({id, bootstrap: ['wss://poc.lif.zone:'+qs_port]});
  console.log('node id %s %o', bstr(node.id), node);
  debug.set_trace({node, cb: add_to_log});
  node.on('peer', id=>{
    let peers = node.get_peers().toArray();
    page.setState({peers});
  });
  page.setState({id: bstr(node.id)});
}

init();

*/
