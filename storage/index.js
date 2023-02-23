// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
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
    if (!scroll.storage)
      this.avl.insert({key, seq});
    else if (!decl?.db?.cfid?.[e.cfid]?.busy) // XXX: need is_loading
      this.schedule_db(key, seq);
  }
  schedule_db(key, seq){ this.storage_queue.push({id: this.id, key, seq}); }
  find_mem_iter(key, opt={}){
    let avl = this.avl, Q = [], compare = avl._comparator, node = avl._root;
    let {min, max} = opt, iter = {};
    let nmin = {key, seq: min===undefined ? 0 : min};
    let nmax = {key, seq: max===undefined ? Infinity : max};
    iter.next = ()=>{
      while (Q.length || node){
        if (node){
          Q.push(node);
          node = node.right;
          continue;
        }
        node = Q.pop();
        if (node.key.key==key)
          iter.last = node.key;
        if (compare(node.key, nmin)<0){
          iter.curr = null;
          return iter;
        }
        if (compare(node.key, nmax)<=0){
          iter.curr = node.key;
          node = node.left;
          return iter;
        }
        node = node.left;
      }
      iter.curr = null;
      return iter;
    };
    return iter.next();
  }
  find_db_iter(key, opt={}){ return etask({_: this}, function*find_db_iter(){
    let _this = this._, scroll = _this.scroll, {min, max} = opt, {id} = _this;
    let db = scroll.soul.db, tx = db.transaction('index', 'readonly');
    let store = tx.store('index'), query;
    if (min!==undefined && max!==undefined)
      assert(min<=max, 'invalid query min<=max min '+min+' max '+max);
    query = IDBKeyRange.bound([id, key, min===undefined ? 0 : min],
      [id, key, max===undefined ? Infinity : max]);
    let cursor = yield db.cursor(store, query, 'prev');
    let iter = {i: 0, curr: cursor?.value};
    iter.next = ()=>etask(function*iter_next(){
      assert(cursor, 'db iter already finished');
      cursor = yield cursor.next();
      iter.i++;
      iter.curr = cursor?.value;
      return iter;
    });
    return iter;
  }); }
  find_iter(key, opt={}){
    let _this = this, {min, max} = opt, scroll = this.scroll;
    let up, dn, mem_iter = this.find_mem_iter(key, opt);
    let iter = {}, first = true;
    let db_iter, iter2;
    iter.next = ()=>{
      if (mem_iter){
        if (!first){
          if (mem_iter.curr.dn===false){
            mem_iter.next();
            dn = mem_iter.curr;
            mem_iter = null;
          } else
            mem_iter.next();
        }
        first = false;
        for (; mem_iter?.curr; mem_iter.next()){
          up = mem_iter.curr;
          if (mem_iter.curr.query)
            continue;
          iter.curr = mem_iter.curr;
          return iter;
        }
        mem_iter = null;
      }
      if (!scroll.storage || !db_iter && (up?.seq==0 || up&&up.dn!==false)){
        iter.curr = null;
        return iter;
      }
      // XXX: check if we reached min and return
      if (up)
        max = up.seq-1;
      if (dn)
        min = dn.seq+1;
      return etask(function*index_find_iter_next(){
        if (min!==undefined && max!==undefined && min>max);
        else if (!db_iter){
          db_iter = yield _this.find_db_iter(key, {min, max});
          if (!db_iter.curr){
            if (max!==undefined && max==up?.seq-1)
              up.dn = true;
            normalize_node(up);
            if (up && dn){
              up.dn = true;
              dn.up = true;
              normalize_node(up);
              normalize_node(dn);
            } else {
              let query = {key, seq: max, query: true, up: !!up, dn: false};
              _this.avl.insert(query);
              normalize_node(query);
              up = query;
            }
          }
        }
        else if (db_iter.curr)
          yield db_iter.next();
        if (db_iter?.curr){
          let seq = db_iter.curr.seq, node = {key, seq, dn: false};
          if (up)
            up.dn = true;
          normalize_node(up);
          if (db_iter.i==0 && max!==undefined && max!=seq && up?.seq!=max+1){
            let query = {key, seq: max, query: true, up: !!up, dn: true};
            _this.avl.insert(query);
            up = query;
          }
          node.up = db_iter.i>0 || !!up;
          normalize_node(up);
          normalize_node(node);
          _this.avl.insert(node);
          up = node;
          iter.curr = node;
          return iter;
        }
        if (!dn){
          iter.curr = null;
          return iter;
        }
        if (dn.query){
          up.dn = true;
          normalize_node(up);
          _this.avl.remove(dn);
        }
        if (!iter2){
          iter2 = yield _this.find_iter(key, {min: opt.min, max: dn.seq});
          iter.curr = iter2.curr;
          return iter;
        }
        yield iter2.next();
        iter.curr = iter2.curr;
        return iter;
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
  index_find(key, opt){ return etask({_: this}, function*index_find(){
    let _this = this._, {count} = opt, ret = [];
    let iter = yield _this.index_find_iter(key, opt);
    while (iter.curr){
      ret.push(iter.curr.seq);
      if (count && ret.length==count)
        return ret;
      yield iter.next();
    }
    return ret;
  }); }
  index_find_iter(key, opt){ return etask({_: this}, function*index_find(){
    let _this = this._, {id, name, cfid, min, max, bseq} = opt;
    let iter = {};
    if (id!==undefined){
      assert(cfid===undefined && bseq===undefined && name===undefined,
        'invalid id/bseq/cfid/name');
      let index = _this.index.get(id);
      if (!index)
        return iter;
      return index.find_iter(key, {min, max});
    }
    assert(cfid!==undefined && bseq!==undefined && name!==undefined,
      'invalid id/bseq/cfid/name');
    let scroll = _this.scroll;
    let bt = scroll.get_branch_table(cfid);
    let curr = bseq;
    iter.next = ()=>etask(function*index_find_iter_next(){
      if (iter.iter){
        if (iter.iter.curr){
          yield iter.iter.next();
          if (iter.iter.curr){
            iter.curr = iter.iter.curr;
            return iter;
          }
        }
        iter.iter = null;
      }
      for (; curr; curr=Branch_table.bseq_parent(curr)){
        let id = _this.get_index_id(cfid, bseq_branch(curr), name);
        let seq_max = bt.bseq_get_max_seq(curr);
        if (id===undefined || seq_max===undefined)
          continue;
        let index = _this.index.get(id);
        iter.iter = yield index.find_iter(key, {min,
          max: max===undefined ? seq_max : Math.min(seq_max, max)});
        if (!iter.iter.curr)
          continue;
        curr=Branch_table.bseq_parent(curr);
        iter.curr = iter.iter.curr;
        return iter;
      }
      if (!cfid){
        iter.curr = null;
        return iter;
      }
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

function normalize_node(node){
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
