// author: derry. coder: arik.
'use strict';
import {X509Certificate} from 'crypto';
import assert from 'assert';
import fs from 'fs';
import tls from 'tls';
import etask from '../util/etask.js';
import date from '../util/date.js';
import xerr from '../util/xerr.js';
import acme from './acme.js';
import util from '../util/util.js';
const {opt_array} = util;
const E = {};
export default E;
E.RENEW_EXPIRE_LT = date.ms.MONTH;
E.RETRY = 5*date.ms.MIN;

function get_acme_cert_files(domain){
  return {cert: E.conf.ssl.cert_dir+'/acme_star_'+domain+'.crt',
    key: E.conf.ssl.keys_dir+'/acme_key_'+domain+'.pem'};
}

function cert_valid_for(valid_from, valid_to){
  let ts = date();
  if (!valid_from || valid_to)
    return 0;
  if (valid_from > ts)
    return 0;
  if (valid_to < ts)
    return 0;
  return valid_to - ts;
}

const get_key = opt=>etask(function*get_key(){
  let file = E.conf.ssl.keys_dir+'/'+opt.file, pem;
  try {
    pem = yield fs.promises.readFile(file);
  } catch(err){ xerr.warn('ssl: acme key not found at %s ', file); }
  if (pem)
    return new Buffer(pem);
  let key = yield opt.func();
  xerr.notice('ssl: save acme key at %s', file);
  yield fs.promises.writeFile(file, key.toString());
  return key;
});

const get_acme_account_key = ()=>get_key({file: 'acme_account_key.pem',
  func: acme.create_account_key});
const get_acme_cert_key = ()=>get_key({file: 'acme_cert_key.pem',
  func: acme.create_cert_key});

const set_cert = (domain, file_cert, file_key, cert, key)=>etask(
  function*set_cert()
{
  let cert_o = new X509Certificate(cert); // XXX: mv to crypto.js
  if (!cert_o.checkHost(domain))
    throw new Error('domain not found in cert '+domain);
  let ts = date(), ctx;
  let valid_from = date(cert_o.validFrom), valid_to = date(cert_o.validTo);
  let valid_for = cert_valid_for(valid_from, valid_to);
  if (!valid_for){
    xerr('ssl: %s cert expired valid from %s to %s now %s', domain,
      date.to_sql(valid_from), date.to_sql(valid_to), date.to_seq(ts));
  } else if (valid_for < E.renew_expire_lt){
    xerr.warn('ssl: %s cert expire soon valid from %s to %s', domain,
      date.to_sql(valid_from), date.to_sql(valid_to));
  }
  // XXX TODO: cert_o.checkPrivateKey
  // XXX TODO: check *.domain
  ctx = tls.createSecureContext({key, cert});
  E.cert[domain] = {ts, file_cert, file_key, cert, key, ctx};
  xerr.notice('ssl: set cert %s valid from %s to %s', domain,
    date.to_sql(valid_from), date.to_sql(valid_to));
});

const load_cert = (domain, opt)=>etask(function*load_cert(){
  let file_cert = opt.cert, file_key = opt.key, cert, key;
  cert = yield fs.promises.readFile(file_cert);
  key = yield fs.promises.readFile(file_key);
  yield set_cert(domain, file_cert, file_key, cert, key);
});

const acme_monitor = ()=>etask(function*acme_monitor(){
  this.on('uncaught', err=>xerr.xexit('ssl: %s', err.stack));
  xerr.notice('ssl: acme_monitor started');
  while (true){
    xerr.notice('ssl: acme_monitor run');
    let sleep = E.renew_expire_lt;
    for (let i=0; i<E.domains.length; i++){
      let cert, domain = E.domains[i], info = E.cert[domain];
      if (E.conf.ssl.cert[domain])
        continue;
      let valid_for = cert_valid_for(info?.valid_from, info?.valid_to);
      if (valid_for > E.renew_expire_lt){
        sleep = Math.min(sleep, valid_for-E.renew_expire_lt);
        continue;
      }
      xerr.notice('ssl: issue new acme cert for %s%s', domain, valid_for ?
        ' current will expire in '+valid_for/date.ms.DAY+' days' : '');
      try {
        cert = yield acme.requet_cert({domain, account_key: E.acme_account_key,
          cert_key: E.acme_cert_key, timeout: E.acme_timeout});
      } catch(err){
        xerr('ssl: failed issue acme cert %s %s', domain, err);
        sleep = E.acme_retry;
        continue;
      }
      let o = get_acme_cert_files(domain);
      try { yield fs.promises.writeFile(o.cert, cert.toString()); }
      catch(err){ xerr('ssl: failed save cert %s %s', o.cert, err); }
      try { yield fs.promises.writeFile(o.key, E.acme_cert_key.toString()); }
      catch(err){ xerr('ssl: failed save key %s %s', o.key, err); }
      yield set_cert(domain, o.cert, o.key, cert, E.acme_cert_key);
    }
    xerr.notice('acme monitor sleep for %s %sms', date.dur_to_str(sleep),
      sleep);
    yield etask.sleep(sleep);
  }
});

E.start = opt=>etask(function*ssl_start(){
  this.on('uncaught', err=>xerr.xexit('ssl: %s', err.stack));
  assert(!E.inited, 'ssl already inited');
  assert(E.dnss = opt.dnss, 'missing dnss');
  assert(E.conf = opt.conf, 'missing conf');
  let conf = E.conf, domains = opt_array(conf.domain);
  E.inited = true;
  E.cert = {};
  E.domains = domains;
  E.renew_expire_lt = date.str_to_dur(conf.ssl.renew_expire_lt)||
    E.RENEW_EXPIRE_LT;
  if (!conf.ssl?.enable)
    return xerr.notice('ssl: module disabled');
  xerr.notice('ssl: module enabled');
  for (let domain in conf.ssl.cert||{})
    yield load_cert(domain, conf.ssl.cert[domain]);
  if (!conf.ssl.acme.enable)
    return xerr.notice('ssl: acme disabled');
  if (!conf.production)
    return xerr('ssl: skip acme in dev env');
  E.acme_timeout = date.str_to_dur(E.conf.ssl.acme.timeout||'')||acme.TIMEOUT;
  E.acme_retry = date.str_to_dur(E.conf.ssl.acme.retry||'')||E.RETRY;
  xerr.notice('ssl: acme enabled renew_expire_lt %s timeout %s retry %s',
    date.dur_to_str(E.renew_expire_lt), date.dur_to_str(E.acme_timeout),
    date.dur_to_str(E.acme_retry));
  acme.init({dnss: E.dnss});
  E.acme_account_key = yield get_acme_account_key();
  E.acme_cert_key = yield get_acme_cert_key();
  xerr.notice('ssl: load acme certificates');
  for (let i=0; i<domains.length; i++){
    let domain = domains[i];
    if (conf.ssl.cert[domain])
      continue;
    try { yield load_cert(domain, get_acme_cert_files(domain)); }
    catch(err){ xerr.warn('ssl: failed load acme cert %s', err); }
  }
  this.et = etask.wait();
  this.et.spawn(acme_monitor());
});

E.stop = ()=>etask(function*ssl_stop(){
  assert(E.inited, 'ssl not inited');
  if (this.et)
    yield this.et.return();
  E.inited = false;
  E.cert = null;
});

E.get_ctx = function(domain){
  assert(E.inited, 'ssl not inited');
  return E.cert[domain]?.ctx;
};

// XXX:
// - test btc.lif.biz domains
// - test ssl.js
// - cleanup
// - xerr log format (eg. ssl:...)
// - allow to put more info to acme cert
// - solution for ssl local dev
// - ttl for txt response
