// author: derry. coder: arik.
'use strict';
const E = {};
export default E;

E.cache_str_fn2 = function(fn){
  var cache = {};
  return function(s1, s2){
    var cache2 = cache[s1] = cache[s1]||{};
    if (s2 in cache2)
      return cache2[s2];
    return cache2[s2] = fn(s1, s2);
  };
};

E.fmt_per = function(per){
  if (!per)
    return '';
  switch (per){
  case 's': case 'ms': return per;
  case '%': case '%%': return '%';
  default: return '/'+per[0];
  }
};

E.scale_vals = {
  1000: [{s: '', n: 1}, {s: 'K', n: 1e3}, {s: 'M', n: 1e6},
    {s: 'G', n: 1e9}, {s: 'T', n: 1e12}, {s: 'P', n: 1e15}],
  1024: [{s: '', n: 1}, {s: 'K', n: 1024}, {s: 'M', n: Math.pow(1024, 2)},
    {s: 'G', n: Math.pow(1024, 3)}, {s: 'T', n: Math.pow(1024, 4)},
    {s: 'P', n: Math.pow(1024, 5)}],
};

E.scaled_number = function(num, opt){
  opt = opt||{};
  var sign = '', per = opt.per, scale = opt.scale;
  var base = opt.base==1024 ? 1024 : 1000, ratio = opt.ratio||1;
  var units = opt.units===undefined||opt.units;
  function _per(){ return per ? E.fmt_per(per) : ''; }
  if (num<0){
    sign = '-';
    num = -num;
  }
  if (num===undefined)
    return '';
  if (isNaN(num))
    return opt.nan||'x';
  if (num==Infinity)
    return sign+'\u221e';
  var scale_vals = E.scale_vals[base], i = 0;
  if (scale==null)
    for (; i<scale_vals.length-1 && num>=scale_vals[i+1].n*ratio; i++);
  else
    i = scale_vals.findIndex(function(_scale){ return _scale.s==scale; });
  if (per=='ms' && i){
    per = 's';
    i--;
    num = num/1000;
  }
  scale = scale_vals[i];
  if (opt.is_scale)
    return scale.n;
  num /= scale.n;
  if (num<0.001)
    return '0'+_per();
  if (num>=base-1)
    num = Math.trunc(num);
  var str = num.toFixed(num<1 ? 3 : num<10 ? 2 : num<100 ? 1 : 0);
  return sign+str.replace(/((\.\d*[1-9])|\.)0*$/, '$2')
    +(units ? (opt.space ? ' ' : '')+scale.s : '')+_per();
};

E.scaled_bytes = function(num, opt){
  return E.scaled_number(num, Object.assign({base: 1000}, opt)); };


