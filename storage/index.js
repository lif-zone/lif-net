// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import xerr from '../util/xerr.js';
import Branch_table from './branch.js';
const {bseq_branch} = Branch_table;
import Tree from 'avl';

/* XXX: design
scroll header:
{scroll: {index: ['file', {...}]}}

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

{indexid, key, seq}
{indexid, key, seq, val}
{scroll+conflict_selection+branch_selection+specific_index_of_scroll_conflict,
  file_name, seq, bseq}
*/

// XXX: need test
function indexdb_cmp(a, b){ return indexedDB.cmp(a, b); }
function node_cmp(a, b){ return indexdb_cmp(a.key, b.key) || a.seq-b.seq; }
/* XXX: optimize for string/integer/buffer
function cmp_func_str_num(a, b){
  return a.key<b.key ? 1 : a.key>b.key ? -1 : b.seq-a.seq; }
function cmp_func_mem(a, b){
  return a.cmp(b) || b.seq-a.seq; }
*/

export default class Index {
  constructor(opt){
    let {scroll, id, cfid, bseqb, desc} = opt;
    assert(scroll && id!==undefined && desc, 'missing scroll/id/desc');
    assert(cfid>=0 && bseqb!==undefined, 'missing cfid/bseqb');
    [this.scroll, this.id, this.desc] = [scroll, id, desc];
    [this.cfid, this.bseqb] = [cfid, bseqb];
    this.avl = new Tree(node_cmp, true);
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
    this.avl.insert({key, seq});
    if (!decl?.db?.cfid?.[e.cfid]?.busy) // XXX: need is_loading
      this.schedule_db(key, seq);
  }
  schedule_db(key, seq){ this.storage_queue.push({id: this.id, key, seq}); }
  index_find_id_mem_iter(key, opt={}){
    let {min, max} = opt;
    let avl = this.avl, Q = [], compare = avl._comparator, node = avl._root;
    let nmin = {key, seq: min===undefined ? -1 : min};
    let nmax = {key, seq: max===undefined ? Infinity : max};
    let iter = {};
    iter.next = ()=>{
      assert(!iter.done, 'calling iterator after done');
      while (Q.length || node){
        if (node){
          Q.push(node);
          node = node.right;
        } else {
          node = Q.pop();
          if (compare(node.key, nmin)<0){
            iter.curr = null;
            iter.done = true;
            return iter;
          }
          if (compare(node.key, nmax)<=0){
            iter.curr = node;
            node = node.left;
            return iter;
          }
          node = node.left;
        }
      }
      iter.curr = null;
      iter.done = true;
      return iter;
    };
    return iter.next();
  }
  index_find_id_db_iter(key, opt={}){ return etask({_: this},
    function*index_find_id_db_iter()
  {
    let _this = this._, scroll = _this.scroll, {min, max} = opt, {id} = _this;
    let db = scroll.soul.db, tx = db.transaction('index', 'readonly');
    let store = tx.store('index'), query;
    query = IDBKeyRange.bound([id, key, min===undefined ? -1 : min],
      [id, key, max===undefined ? Infinity : max]);
    let cursor=yield db.cursor(store, query, 'prev');
    let iter = {i: 0, curr: cursor?.value};
    iter.next = ()=>etask(function*iter_next(){
      assert(cursor, 'iter already done');
      cursor = yield cursor.next();
      iter.i++;
      iter.curr = cursor?.value;
    });
    return iter;
  }); }
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
    // XXX: use avl?
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
  // XXX: change to support iterator on results in addition to count
  index_find(key, opt){ return etask({_: this}, function*index_find(){
    let _this = this._, {id, name, cfid, min, max, count, bseq} = opt;
    if (id!==undefined){
      assert(cfid===undefined && bseq===undefined && name===undefined,
        'invalid id/bseq/cfid/name');
      return _this.index_find_id(id, key, {min, max, count});
    }
    assert(cfid!==undefined && bseq!==undefined && name!==undefined,
      'invalid id/bseq/cfid/name');
    let scroll = _this.scroll;
    // XXX: need to go to paernt of conflict and search as well
    let bt = scroll.get_branch_table(cfid);
    let bseq_seq = bt.bseq_to_seq(bseq);
    if (bseq_seq===undefined)
      return;
    let ret = [];
    for (let curr=bseq; curr; curr=Branch_table.bseq_parent(curr)){
      let id = _this.get_index_id(cfid, bseq_branch(curr), name);
      let seq_max = bt.bseq_to_seq(curr);
      if (id===undefined || seq_max===undefined)
        continue;
      let found = yield _this.index_find_id(id, key, {min,
        max: max===undefined ? seq_max : Math.min(seq_max, max), count});
      if (!found.length)
        continue;
      ret = ret.concat(found);
    }
    return ret;
  }); }
  index_find_id(id, key, opt={}){
    return etask({_: this}, function*index_find_id()
  {
    let _this = this._, {min, max, count} = opt, scroll = _this.scroll;
    let index = scroll.index_table.index.get(id), ret = [];
    if (!index)
      return ret;
    let up, dn, mem_iter = index.index_find_id_mem_iter(key, opt);
    for (; mem_iter.curr; mem_iter.next()){
      up = mem_iter.curr.key;
      if (!mem_iter.curr.key.query){
        ret.push(mem_iter.curr.key.seq);
        if (count && ret.length==count)
          return ret;
      }
      if (mem_iter.curr.key.dn===false){
        mem_iter.next();
        dn = mem_iter.curr?.key;
        break;
      }
    }
    if (!scroll.storage || up?.seq==0 || up&&up.dn!==false)
      return ret;
    // XXX: check if we reached min and return
    if (up)
      max = up.seq-1;
    if (dn)
      min = dn.seq+1;
    let db_iter = yield index.index_find_id_db_iter(key, {min, max,
      count: count!==undefined ? count-(ret?.length||0) : undefined});
    for (; db_iter.curr; yield db_iter.next()){
      let seq = db_iter.curr.seq, node = {key, seq, dn: false};
      if (db_iter.i==0){
        if (max!==undefined && max!=seq){
          let query = {key, seq: max, query: true, up: false};
          if (up)
            [up.dn, query.up] = [true, true];
          normalize_node_key(query);
          index.avl.insert(query);
          up = query;
        }
        if (up)
          [up.dn, node.up] = [true, true];
        else
          node.up = false;
      } else {
        if (up)
          up.dn = true;
        node.up = true;
      }
      normalize_node_key(up);
      normalize_node_key(node);
      ret.push(seq);
      up = node;
      if (count && ret.length==count){
        index.avl.insert(node);
        return ret;
      }
      index.avl.insert(node);
    }
    if (!dn)
      return ret;
    if (dn.query){
      up.dn = true;
      normalize_node_key(up);
      index.avl.remove(dn);
    }
    return ret.concat(yield _this.index_find_id(id, key,
      {min: opt.min, max: dn.seq-1,
      count: count!==undefined ? count-(ret?.length||0) : undefined}));
  }); }
}

function normalize_node_key(node){
  if (!node)
    return;
  if (node.up!==false)
    delete node.up;
  if (node.dn!==false)
    delete node.dn;
  return node;
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
Index.node_cmp = node_cmp;
Index.indexdb_cmp = indexdb_cmp;
