// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import Branch_table from './branch.js';
const {bseq_branch} = Branch_table;
import Tree from 'avl';

/* design:
scroll header: {scroll: {index: ['file', {...}]}}
indexs table:
{scfid, indexid, index details?}
index_details: {key: 'file', index_name: 'file', type: 'string'}
index name: default - key name
{1, /file1, 10}
{1, /file1, 9}
{scroll+conflict_selection+branch_selection+specific_index_of_scroll_conflict,
  file_name, seq, bseq}
file: '/arik' --> simple key for index
dir: file2path(file)
file2path('/arik') = '/'
file2path('/arik/') = '/arik/'
file2path('/arik/x') = '/arik/'
{index: ['file', {name: 'dir', field: 'dir', func: 'file2dir'}]}
'file' == {field: 'file'} == {name: 'file', field: 'file'}
//XXX {name: 'dir_files', field: 'file', transform: 'file2dir'}
//XXX  file2dir(file){ var i = file.lastIndexOff('/'); return i<0 ? file :; }
{name: 'dir_list', field: '*', transform: 'decl_get_dir'}
  decl_get_dir(decl){ return file2dir(decl.dir?.slice(-1) : decl.file); }
{op:add dir:/d/} --> /d --> /
{op:add file:/d/file}
*/

// XXX: need test
function cmp_indexdb(a, b){ return indexedDB.cmp(a, b); }
function cmp_str_num(a, b){ return a==b ? 0 : a<b ? -1 : 1; }
function cmp_mem(a, b){ return a.cmp(b); }
function cmp_func_indexdb(a, b){
  return cmp_indexdb(a.key, b.key) || a.seq-b.seq; }
function cmp_func_str_num(a, b){
  return cmp_str_num(a.key, b.key) || a.seq-b.seq; }
function cmp_func_mem(a, b){
  return cmp_mem(a.key, b.key) || a.seq-b.seq; }

export default class Index {
  constructor(opt){
    let {scroll, id, cfid, bseqb, desc} = opt;
    assert(scroll && id!==undefined && desc, 'missing scroll/id/desc');
    assert(cfid>=0 && bseqb!==undefined, 'missing cfid/bseqb');
    [this.scroll, this.id, this.desc] = [scroll, id, desc];
    [this.cfid, this.bseqb] = [cfid, bseqb];
    this.avl = new Tree(cmp_func_indexdb, true);
    this.storage_queue = [];
  }
  on_data(e){
    let {cfid, seq, data} = e, {field, transform} = this.desc;
    let scroll = this.scroll, decl = scroll.get_decl(seq, {create: false});
    assert(!transform, 'XXX TODO: transform');
    assert(field!='*', 'XXX TODO: *');
    let body = data.get_body(cfid), key = body?.[field];
    if (key===undefined || key===null)
      return;
    let curr = this.find_mem_iter(key, {min: seq, max: seq})?.curr;
    if (curr)
      return;
    this.avl.insert({key, seq, dn: seq, up: seq});
    // XXX: need is_loading
    if (scroll.storage && decl?.db?.cfid?.[e.cfid]?.busy)
      return;
    this.schedule_db(key, seq);
  }
  schedule_db(key, seq){ this.storage_queue.push({id: this.id, key, seq}); }
  find_mem_iter(key, opt={}){
    let avl = this.avl, Q = [], cmp = avl._comparator, node = avl._root;
    let {min, max, dir} = opt, iter = {};
    let nmin = {key, seq: min===undefined ? 0 : min};
    let nmax = {key, seq: max===undefined ? Infinity : max};
    dir = dir||'dn';
    assert(['up', 'dn'].includes(dir), 'invalid dir '+dir);
    iter.next = ()=>{
      iter.i = iter.i===undefined ? 0 : iter.i+1;
      while (Q.length || node){
        if (node){
          Q.push(node);
          node = dir=='up' ? node.left : node.right;
          continue;
        }
        node = Q.pop();
        iter.curr = node.key;
        node = dir=='up' ? node.right : node.left;
        if (dir=='up' ? cmp(iter.curr, nmax)>0 : cmp(iter.curr, nmin)<0)
          return iter_ret(iter);
        if (dir=='up' ? cmp(iter.curr, nmin)>=0 : cmp(iter.curr, nmax)<=0)
          return iter;
      }
      return iter_ret(iter);
    };
    return iter.next();
  }
  find_db_iter(key, opt={}){ return etask({_: this}, function*find_db_iter(){
    let _this = this._, scroll = _this.scroll, {min, max, dir} = opt;
    let {id} = _this, db = scroll.soul.db, query;
    let tx = db.transaction('index', 'readonly'), store = tx.store('index');
    dir = dir||'dn';
    assert(['up', 'dn'].includes(dir), 'invalid dir '+dir);
    if (min!==undefined && max!==undefined)
      assert(min<=max, 'invalid query min<=max min '+min+' max '+max);
    query = IDBKeyRange.bound([id, key, min===undefined ? 0 : min],
      [id, key, max===undefined ? Infinity : max]);
    let cursor = yield db.cursor(store, query, dir=='up' ? 'next' : 'prev');
    let iter = {i: 0, curr: cursor?.value};
    iter.next = ()=>etask(function*iter_next(){
      assert(cursor, 'db iter already finished');
      cursor = yield cursor.next();
      iter.i++;
      return iter_ret(iter, cursor?.value);
    });
    return iter;
  }); }
  find_iter(key, opt={}){
    let _this = this, {min, max, dir} = opt, {cfid, scroll} = this;
    dir = dir||'dn';
    assert(['up', 'dn'].includes(dir), 'invalid dir '+dir);
    if (!scroll.storage)
      return this.find_mem_iter(key, {min, max, dir});
    let co = scroll.conflict.get(cfid), _max, _min;
    _min = min = min===undefined ? co.parent ? co.parent.seq+1 : 0 : min;
    _max = max = max===undefined ? co.top.seq : max;
    let iter = {}, mem_iter, db_iter, prev, db_prev_edge, mem_prev_edge;
    const next_mem_iter = ()=>{
      if (db_iter)
        return;
      mem_iter = mem_iter ? mem_iter.next() :
        _this.find_mem_iter(key, {min, max, dir});
      let curr = mem_iter.curr, section;
      if (db_prev_edge && curr){
        if (dir=='up')
          [curr.dn, db_prev_edge] = [prev ? prev.seq : db_prev_edge, 0];
        else
          [curr.up, db_prev_edge] = [prev ? prev.seq : db_prev_edge, 0];
      }
      if (curr){
        if (dir=='up'){
          if (prev && prev.up < curr.dn-1);
          else if (!prev && curr.dn>min &&
            !scroll.is_mem_exists(cfid, min, curr.dn+1));
          else {
            if (prev)
              [prev.up, curr.dn] = [curr.seq, prev.seq];
            return iter.curr = prev = curr;
          }
        } else {
          if (prev && prev.dn > curr.up+1);
          else if (!prev && curr.up<max &&
            !scroll.is_mem_exists(cfid, curr.up, max+1));
          else {
            if (prev)
              [prev.dn, curr.up] = [curr.seq, prev.seq];
            return iter.curr = prev = curr;
          }
        }
      }
      if (dir=='up'){
        mem_prev_edge = min;
        [min, max] = [prev ? prev.up+1 : min, curr ? curr.dn-1 : max];
      }
      else {
        mem_prev_edge = max;
        [min, max] = [curr ? curr.up+1 : min, prev ? prev.dn-1 : max];
      }
      if (section = scroll.get_section(cfid, max)){
        max = section.seq-1;
        if (dir=='dn' && prev)
          prev.dn = section.seq;
      }
      if (section = scroll.get_section(cfid, min)){
        min = section.seq+section.size;
        if (dir=='up' && prev)
          prev.up = section.seq+section.size-1;
      }
      mem_iter = null;
    };
    const next_db_iter = ()=>etask(function*next_db_iter(){
      assert(!mem_iter, 'mem_iter did not finish');
      if (!iter.db_flushed){
        yield scroll.flush();
        iter.db_flushed = true;
      }
      db_iter = db_iter ? yield db_iter.next() :
        yield _this.find_db_iter(key, {min, max, dir});
      if (!db_iter.curr){
        if (dir=='up'){
          if (prev)
            prev.up = max;
          [min, max, db_prev_edge] = [max+1, _max, min];
        } else {
          if (prev)
            prev.dn = min;
          [min, max, db_prev_edge] = [_min, min-1, max];
        }
        return db_iter = null;
      }
      let seq = db_iter.curr.seq, curr;
      if (dir=='up'){
        curr = {key, seq, dn: prev ? prev.seq : mem_prev_edge, up: seq};
        if (prev)
          prev.up = seq;
      } else {
        curr = {key, seq, dn: seq, up: prev ? prev.seq : mem_prev_edge};
        if (prev)
          prev.dn = seq;
      }
      return prev = iter.curr = _this.avl.insert(curr).key;
    });
    iter.next = ()=>{
      if (next_mem_iter())
        return iter;
      if (max<min)
        return iter_ret(iter);
      return etask(function*index_find_iter_next(){
        while (true){
          if (yield next_db_iter())
            return iter;
          if (max<min)
            return iter_ret(iter);
          if (next_mem_iter())
            return iter;
          if (max<min)
            return iter_ret(iter);
        }
      });
    };
    return iter.next();
  }
}

class Index_table {
  constructor(opt){
    let scroll = this.scroll = opt.scroll, index = opt.index;
    this.desc = new Map();
    assert(scroll, 'missing scroll');
    assert(index?.length, 'missing index');
    for (let i=0; i<index.length; i++){
      let desc = normalize_desc(index[i]), {name} = desc;
      if (this.desc.get(name))
        throw new Error('duplicated index '+name);
      this.desc.set(name, desc);
    }
    this.index2id = new Map();
    this.index = new Map();
    this.storage_queue = [];
    scroll.on('conflict-real', this.on_conflict);
  }
  get_desc(name){ return this.desc.get(name); }
  get_index_id(cfid, bseqb, name){
    let map_bseqb = this.index2id.get(cfid);
    if (!map_bseqb)
      return;
    let map_name = map_bseqb.get(bseqb);
    if (!map_name)
      return;
    return map_name.get(name);
  }
  get_index(cfid, bseqb, name, opt){
    let id = this.get_index_id(cfid, bseqb, name), desc = this.desc.get(name);
    let scroll = this.scroll, index;
    if (id===undefined){
      if (!opt.create)
        return;
      id = scroll.soul.new_index_id();
      assert(!this.index.get(id), 'index id '+id+' already exist');
    } else
      index = this.index.get(id);
    if (index!==undefined)
      return index;
    return this.new_index({id, cfid, bseqb, desc});
  }
  new_index(opt){
    let {id, cfid, bseqb, desc} = opt, scroll = this.scroll;
    assert(!this.index.get(id), 'index '+id+' already exist');
    let map_bseqb = this.index2id.get(cfid);
    if (!map_bseqb)
      this.index2id.set(cfid, map_bseqb = new Map());
    let map_name = map_bseqb.get(bseqb);
    if (!map_name)
      map_bseqb.set(bseqb, map_name = new Map());
    map_name.set(desc.name, id);
    if (!opt.from_db)
      this.schedule_db(id, cfid, bseqb, desc);
    let index = new Index({scroll, id, cfid, bseqb, desc});
    this.index.set(id, index);
    return index;
  }
  schedule_db(id, cfid, bseqb, desc){
    this.storage_queue.push({id, scroll: this.scroll.name, cfid, bseqb,
      ...desc});
  }
  on_data(e){
    let {cfid, seq, bseq, data} = e, _this = this, scroll = this.scroll;
    if (!seq || !this.desc.size || !data.get(cfid))
      return;
    // XXX: scroll.is_conflict
    if (scroll.conflict.get(cfid).parent?.type=='t')
      return;
    return etask(function*on_data(){
      let bseqb = bseq_branch(bseq);
      for (const [name] of _this.desc){
        let index = _this.get_index(cfid, bseqb, name, {create: true});
        yield index.on_data(e);
      }
    });
  }
  on_conflict = e=>etask({_: this}, function*on_conflict(){
    let _this = this._, {cfid} = e, scroll = _this.scroll;
    let co = scroll.conflict.get(cfid);
    // XXX: need to handle parent change
    let s = co.parent.seq+1, end = co.top.seq;
    for (let seq=s; seq<=end; seq++){
      let decl = scroll.get_decl(seq, {create: false});
      if (!decl)
        continue;
      decl.load(cfid);
      let h = decl.get_header(cfid);
      if (!h)
        continue;
      let bseq = decl.bseq_get(cfid), data = decl.data_get();
      yield _this.on_data({cfid, seq, bseq, data});
    }
  });
  find(key, opt){ return etask({_: this}, function*find(){
    let _this = this._, {count} = opt, ret = [];
    if (count===undefined)
      count = 1;
    let iter = yield _this.find_iter(key, opt);
    while (iter.curr){
      ret.push(iter.curr.seq);
      if (count && ret.length==count)
        return ret;
      yield iter.next();
    }
    return ret;
  }); }
  find_iter(key, opt){ return etask({_: this}, function*find_iter(){
    let _this = this._, {id, name, cfid, min, max, dir, bseq} = opt;
    let iter = {}, _max = max;
    if (id!==undefined){
      assert.equal(cfid, undefined, 'invalid cfid when using id');
      assert.equal(bseq, undefined, 'invalid bseq when using id');
      assert.equal(name, undefined, 'invalid name when id');
      let index = _this.index.get(id);
      if (!index)
        return iter;
      return index.find_iter(key, {min, max, dir});
    }
    assert(cfid!==undefined, 'missing cfid');
    assert(bseq!==undefined, 'missing bseq');
    assert(name!==undefined, 'missing name');
    let scroll = _this.scroll, bt;
    let curr = bseq, bseqs = [], conflicts = [];
    if (dir=='up'){
      for (curr=bseq; curr; curr=Branch_table.bseq_parent(curr))
        bseqs.push(curr);
      curr = bseqs.pop();
      for (let co = scroll.conflict.get(cfid); co;
        co = co.parent && scroll.conflict.get(co.parent.cfid))
      {
        conflicts.push(co);
      }
      let co = conflicts.pop(), co_child = conflicts[conflicts.length-1];
      cfid = co.cfid;
      max = _max===undefined ? co_child?.parent.seq :
        co_child?.parent?.seq!==undefined ?
        Math.min(_max, co_child.parent.seq) : _max;
      bt = scroll.get_branch_table(cfid);
    }
    else
      bt = scroll.get_branch_table(cfid);
    iter.next = ()=>etask(function*index_find_iter_next(){
      if (iter.iter){
        if (iter.iter.curr){
          yield iter.iter.next();
          if (iter.iter.curr)
            return iter_ret(iter, iter.iter.curr);
        }
        iter.iter = null;
      }
      if (dir=='up'){
        for (; curr; curr = bseqs.pop()){
          let id = _this.get_index_id(cfid, bseq_branch(curr), name);
          let seq_max = bt.bseq_get_max_seq(curr);
          if (id===undefined || seq_max===undefined)
            continue;
          let index = _this.index.get(id);
          iter.iter = yield index.find_iter(key, {min,
            max: max===undefined ? seq_max : Math.min(seq_max, max), dir});
          if (!iter.iter.curr)
            continue;
          curr = bseqs.pop();
          return iter_ret(iter, iter.iter.curr);
        }
        if (!conflicts.length)
          return iter_ret(iter);
        let co = conflicts.pop(), co_child = conflicts[conflicts.length-1];
        cfid = co.cfid;
        max = _max===undefined ? co_child?.parent.seq :
          co_child?.parent?.seq!==undefined ?
          Math.min(_max, co_child.parent.seq) : _max;
        bt = scroll.get_branch_table(cfid);
        bseqs = [];
        for (curr=bseq; curr; curr=Branch_table.bseq_parent(curr))
          bseqs.push(curr);
        curr = bseqs.pop();
        return iter.next();
      }
      // dir=='dn'
      for (; curr; curr = Branch_table.bseq_parent(curr)){
        let id = _this.get_index_id(cfid, bseq_branch(curr), name);
        let seq_max = bt.bseq_get_max_seq(curr);
        if (id===undefined || seq_max===undefined)
          continue;
        let index = _this.index.get(id);
        iter.iter = yield index.find_iter(key, {min,
          max: max===undefined ? seq_max : Math.min(seq_max, max), dir});
        if (!iter.iter.curr)
          continue;
        curr = Branch_table.bseq_parent(curr);
        return iter_ret(iter, iter.iter.curr);
      }
      if (!cfid)
        return iter_ret(iter);
      let co = scroll.conflict.get(cfid);
      cfid = co.parent.cfid;
      max = max===undefined ? co.parent.seq : Math.min(max, co.parent.seq);
      curr = bseq;
      bt = scroll.get_branch_table(cfid);
      return iter.next();
    });
    return iter.next();
  }); }
}

function iter_ret(iter, val){
  iter.curr = val||null;
  return iter;
}

function normalize_desc(desc){
  if (!desc)
    return;
  if (typeof desc=='string')
    return {name: desc, field: desc, type: 'string'};
  if (desc.name===undefined)
    return {name: desc.field, type: 'string', ...desc};
  return {type: 'string', ...desc};
}

Index.Index_table = Index_table;
Index.normalize_desc = normalize_desc;
Index.cmp_func_indexdb = cmp_func_indexdb;
Index.cmp_func_str_num = cmp_func_str_num;
Index.cmp_func_mem = cmp_func_mem;
Index.cmp_indexdb = cmp_indexdb;
Index.cmp_str_num = cmp_str_num;
Index.cmp_mem = cmp_mem;

// XXX: lock scorll for write during index iteration (check only avl)
