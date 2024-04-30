// author: derry. coder: arik.
'use strict';
import conv from './conv.js';
const E = {};
export default E;
var ver_regexp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

E._cmp = function(v1, v2){
    if (!v1 || !v2)
        return +!!v1 - +!!v2;
    var _v1 = (''+v1).split('.'), _v2 = (''+v2).split('.'), i;
    for (i = 0; i<_v1.length && i<_v2.length && +_v1[i] == +_v2[i]; i++);
    if (_v1.length==i || _v2.length==i)
        return _v1.length - _v2.length;
    return +_v1[i] - +_v2[i];
};
E.cmp = conv.cache_str_fn2(E._cmp);

E._valid = function(v){ return ver_regexp.test(''+v); };
var version_valid_cache = {};
E.valid = function(v){
    var cache = version_valid_cache, res;
    v = ''+v; // accept non-string (always false)
    if (v in cache)
        return cache[v];
    if (res = E._valid(v))
        cache[v] = res; // cache only valid versions
    return res;
};

