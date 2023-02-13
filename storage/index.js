// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import etask from '../util/etask.js';
import Branch_table from './branch.js';
const {bseq_branch} = Branch_table;
import Tree from 'avl';

let xxx_id = 0; // XXX: fixme

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
function cmp_func(a, b){
  return indexedDB.cmp(a.key, b.key) || b.seq-a.seq; }
/* XXX: optimize for string/integer/buffer
function cmp_func_str_num(a, b){
  return a.key<b.key ? 1 : a.key>b.key ? -1 : b.seq-a.seq; }
function cmp_func_mem(a, b){
  return a.cmp(b) || b.seq-a.seq; }
*/

export default class Index {
  constructor(opt){
    let {scroll, id, desc} = opt;
    assert(scroll && id!=undefined && desc, 'missing scroll/id/desc');
    [this.scroll, this.id, this.desc] = [scroll, id, desc];
    this.avl = new Tree(cmp_func, true);
  }
  on_data(opt){
    let {cfid, seq, data} = opt, {field, transform} = this.desc;
    assert(!transform, 'XXX TODO: transform');
    assert(field!='*', 'XXX TODO: *');
    let body = data.get_body(cfid), key = body?.[field];
    if (key===undefined)
      return;
    this.avl.insert({key, seq});
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
  }
  get_index_id(cfid, bseqb, name, opt){
    let map_cfid = this.index2id.get(cfid);
    if (!map_cfid)
      this.index2id.set(cfid, map_cfid = new Map());
    let map_bseqb = map_cfid.get(bseqb);
    if (!map_bseqb)
      map_cfid.set(bseqb, map_bseqb = new Map());
    let id = map_bseqb.get(name);
    if (id===undefined && opt?.create)
      map_bseqb.set(name, id = xxx_id++); // XXX: need to get soul free id
    return id;
  }
  get_index(cfid, bseqb, name, opt){
    let id = this.get_index_id(cfid, bseqb, name, opt);
    if (id===undefined)
      return;
    let index = this.index.get(id);
    if (index!==undefined || !opt?.create)
      return index;
    // XXX: handle deletion/merge of conflict/branch/...
    // XXX: make sure we ignore temporary conflicts (also check we ignore
    // them in branch and other places and verify we handle correclty once
    // we detect it is real conflict)
    let scroll = this.scroll, desc = this.desc.get(name);
    index = new Index({scroll, id, desc});
    this.index.set(id, index);
    return index;
  }
  on_data(opt){
    let {cfid, seq, bseq, data} = opt, _this = this;
    if (!seq || !this.desc.size || !data.get(cfid))
      return;
    return etask(function*on_data(){
      let bseqb = bseq_branch(bseq);
      for (const [name] of _this.desc){
        let index = _this.get_index(cfid, bseqb, name, {create: true});
        yield index.on_data(opt);
      }
    });
  }
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
Index.cmp_func = cmp_func;
