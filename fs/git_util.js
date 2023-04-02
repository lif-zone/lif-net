// author: derry. coder: arik.
import xcrypto from '../util/crypto.js';
import buf_util from '../net/buf_util.js';
const b2s = buf_util.buf_to_str;
const E = {};

function split_message(s){
  let i = s.indexOf('\n\n');
  return [s.slice(0, i), s.slice(i+2)];
}

function parse_author(author){
  let m = author.match(/^(.*) <(.*)> (.*) (.*)$/);
  if (!m)
    throw new Error('invalid author '+author);
  const [, name, email, timestamp, offset] = m;
  return {name, email, timestamp: Number(timestamp),
    timezoneOffset: parse_tz_offset(offset)};
}

// XXX: mv to date.js
function parse_tz_offset(offset){
  let [, sign, hours, minutes] = offset.match(/(\+|-)(\d\d)(\d\d)/);
  minutes = (sign === '+' ? 1 : -1) * (Number(hours) * 60 + Number(minutes));
  return minutes ? -minutes : minutes;
}

E.parse_commit = function(commit){
  let [headers, message] = split_message(commit);
  let ll = headers.split('\n'), l=[], ret = {parent: []};
  for (const h of ll){
    if (h[0]==' ') // combine with previous header (without space indent)
      l[l.length-1] += '\n'+h.slice(1);
    else
      l.push(h);
  }
  for (const h of l){
    const key = h.slice(0, h.indexOf(' '));
    const value = h.slice(h.indexOf(' ')+1);
    if (Array.isArray(ret[key]))
      ret[key].push(value);
    else
      ret[key] = value;
  }
  if (ret.author)
    ret.author = parse_author(ret.author);
  if (ret.committer)
    ret.committer = parse_author(ret.committer);
  if (ret.message)
    throw new Error('invalid commit header: message');
  ret.message = message;
  return ret;
};

E.render_header = function(key, val){
  return key+' '+val.replace(/\n/g, '\n ')+'\n'; };

E.wrap = function({type, object}){
  return Buffer.concat([
    Buffer.from(`${type} ${object.byteLength.toString()}\x00`), object]);
};

E.hash = function(type, object){
  return b2s(xcrypto.sha1(E.wrap({type, object})));
};

export default E;
