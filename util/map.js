// author: derry. coder: arik.
'use strict'; /*jslint node:true*/
import assert from 'assert';

export default class XMap extends Map {
  constructor(){
    super();
  }
  key_at(i){ // XXX: need test
    assert(i>=0, 'invlaid key_at '+i);
    let it = this[Symbol.iterator](), o;
    for (;i>=0; i--, o = it.next());
    return o?.value ? o.value[0] : undefined;
  }
  value_at(i){ // XXX: need test
    assert(i>=0, 'invlaid key_at '+i);
    let it = this[Symbol.iterator](), o;
    for (;i>=0; i--, o = it.next());
    return o?.value ? o.value[1] : undefined;
  }
}
