// author: derry. coder: arik.
'use strict';
import array from './array.js';
import conv from './conv.js';
const KB = 1024, MB = 1024*KB;

class BufPool {
  constructor(max_free_size, free_ttl, name){
    this.max_free_size = max_free_size;
    this.free_ttl = free_ttl||3E+5;
    this.name = name ? name+'_' : '';
    this.pool = {};
    this.free_size = 0;
    this.overflow_ts = 0;
  }
  create(max_free_size, free_ttl, name){
    return new BufPool(max_free_size, free_ttl, name);
  }
  alloc(bytes){
    let bp = this.pool[bytes] = this.pool[bytes]||{bytes,
      created: new Error().stack, free: [], used: [],
      name: conv.scaled_number(bytes, {base: KB})};
    let b = !bp.free.length ? Buffer.alloc(bytes) : bp.free.pop();
    bp.used.push(b);
    return b;
  }
  free(buf){
    let bp = this.pool[buf.length];
    bp.free.push(buf);
    array.rm_elm(bp.used, buf);
    this.free_size += buf.length;
    if (this.max_free_size)
      this.cut_free();
  }
  cut_free(){
    if (this.free_size<=this.max_free_size)
      return void (this.overflow_ts = 0);
    let now = Date.now();
    if (!this.overflow_ts)
      return void (this.overflow_ts = now);
    if (now-this.overflow_ts<=this.free_ttl)
      return;
    let fraction = this.max_free_size/this.free_size;
    for (let name in this.pool){
      let bp = this.pool[name];
      let new_length = Math.floor(bp.free.length*fraction);
      this.free_size -= bp.bytes*(bp.free.length-new_length);
      bp.free.length = new_length;
    }
    this.overflow_ts = 0;
  }
}

const E = new BufPool(50*MB);
export default E;
