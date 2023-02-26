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
      iter.i = iter.i===undefined ? 0 : iter.i+1;
      while (Q.length || node){
        if (node){
          Q.push(node);
          node = node.right;
          continue;
        }
        node = Q.pop();
        iter.curr = node.key;
        node = node.left;
        if (compare(iter.curr, nmin)<0){
          iter.curr = null;
          return iter;
        }
        if (compare(iter.curr, nmax)<=0)
          return iter;
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
    let _this = this, {min, max} = opt, {cfid, scroll} = this;
    let iter = {step: 'mem'}, up, dn, db_iter;
    let _min = min = min===undefined ? 0 : min;
    max = max===undefined ? scroll.conflict.get(cfid).top.seq : max;
    const done = ()=>{
      iter.curr = null;
      return iter;
    };
    // XXX: lock scroll
    // XXX: can we avoid etask creation if only need to use mem?
    iter.next = ()=>etask(function*index_find_iter_next(){
      assert(iter.step!='done', 'call to next after done');
      while (true){
        switch (iter.step){
        case 'mem':
          if (_this.find_iter_step_mem(iter, key, min, max))
            return iter;
          [up, dn] = [iter.up, iter.dn];
          if (!scroll.storage || up && up.dn!==false)
            return done();
          // XXX: check if we reached min and return + test it
          [max, min] = [up ? up.seq-1 : max, dn ? dn.seq+1 : min];
          assert(min<=max, 'unexpected min>max');
          iter.step = 'db';
          break;
        case 'db':
          yield scroll.flush();
          if (!db_iter){
            db_iter = yield _this.find_db_iter(key, {min, max});
            if (!db_iter.curr || max!=db_iter.curr.seq && up?.seq!=max+1){
              if_ptr_set(up, 'dn', true);
              if_ptr_set(dn, 'up', true);
              up = _this.avl_insert_query({key, seq: max, query: true,
                up: !!up, dn: !!dn});
            }
          }
          else
            yield db_iter.next();
          if (db_iter.curr){
            let seq = db_iter.curr.seq, node = {key, seq, dn: false};
            if_ptr_set(up, 'dn', true);
            ptr_set(node, 'up', db_iter.i>0 || !!up);
            // XXX: need insert similar to avl_insert_query and unite both
            // functions. need to merge after insert
            _this.avl_insert(node);
            up = node;
            iter.curr = node;
            return iter;
          }
          iter.step = 'db_done';
          break;
        case 'db_done':
          if (!dn)
            return done();
          if (dn?.query && dn.dn!==false){
            if_ptr_set(up, 'dn', true); // XXX: needed?
            _this.avl.remove(dn);
          }
          iter.step = 'mem';
          [min, max] = [_min, dn.seq];
          // XXX: rm all this mess
          db_iter = iter.mem_iter = iter.up = iter.dn = null;
          break;
        default: assert.fail('invalid step '+iter.step);
        }
      }
    });
    return iter.next();
  }
  avl_insert(node){
    let del = [];
    this.avl.insert(node);
    let dn = node;
    let mem_iter = this.find_mem_iter(node.key, {max: node.seq-1});
    while (mem_iter.curr){
      if (mem_iter.curr.seq!=dn.seq-1)
        break;
      if (!mem_iter.curr.query){
        if (dn===node){
          ptr_set(mem_iter.curr, 'up', true);
          ptr_set(node, 'dn', true);
        } else if (dn.dn!==false){
            del.push(dn);
            dn = mem_iter.curr;
        }
        break;
      }
      if (dn!==node)
        del.push(dn);
      dn = mem_iter.curr;
      mem_iter.next();
    }
    if (dn!==node){
      del.forEach(o=>this.avl.remove(o));
      ptr_set(dn, 'up', true);
      ptr_set(node, 'dn', true);
    }
    // XXX: need also to go upwards and merge if needed + add test
  }
  avl_insert_query(query){
    let dn, up;
    let mem_iter = this.find_mem_iter(query.key, {min: query.seq-1,
      max: query.seq+1});
    if (up = mem_iter.curr)
      dn = mem_iter.next()?.curr;
    if (up && dn){
      ptr_set(up, 'dn', true);
      ptr_set(dn, 'up', true);
      return dn;
    } else if (up){
      ptr_set(up, 'dn', true);
      ptr_set(query, 'up', true);
    } else if (dn){
      // XXX: need test for this scenario
      xerr('XXX avl_insert_query dn %O up %O query %O', dn, up, query);
    }
    //  xerr('XXX avl_insert_query dn %O up %O query %O', dn, up, query);
    this.avl.insert(query);
    normalize_node(query);
    return query;
  }
  find_iter_step_mem(iter, key, min, max){
    let {mem_iter, up, dn} = iter, ret;
    if (!mem_iter)
      mem_iter = iter.mem_iter = this.find_mem_iter(key, {min, max});
    else
      mem_iter.next();
    if (!dn && mem_iter.curr?.up===false && mem_iter.curr.seq!=max)
      dn = mem_iter.curr;
    else if (!dn && mem_iter.curr){
      for (; mem_iter.curr?.query && mem_iter.curr.dn!==false;
        up = mem_iter.curr, mem_iter.next());
      if (mem_iter.curr?.query && mem_iter.curr.dn===false)
        dn = mem_iter.next()?.curr; // XXX: verify to test it
      else if (mem_iter.curr){
        up = iter.curr = mem_iter.curr;
        if (mem_iter.curr.dn===false)
          dn = mem_iter.next()?.curr;
        ret = true;
      }
    }
    iter.up = up;
    iter.dn = dn;
    return ret;
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

function ptr_set(node, field, val){
  if (val)
    delete node[field];
  else
    node[field] = false;
}

function if_ptr_set(node, field, val){
  if (!node)
    return;
  ptr_set(node, field, val);
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
