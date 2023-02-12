// author: derry. coder: arik.
'use strict';
import assert from 'assert';
// XXX import Tree from 'avl';

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

export default class Index {
  constructor(opt){
    let scroll = this.scroll = opt.scroll;
    let cfid = this.cfid = opt.cfid;
    let branch = this.branch = opt.branch;
// XXX    let index_opt = this.index_opt = Index.normalize_opt(opt.index_opt);
    assert(scroll && cfid!=undefined && branch!=undefined,
      'missing scroll/cfid/branch');
  }
}

function normalize_opt(opt){
  if (!opt)
    return;
  if (typeof opt=='string')
    return {name: opt, field: opt};
  if (opt.name===undefined)
    return {name: opt.field, ...opt};
  return opt;
}

function creates_indexes_from_header(scroll, h){
  let ret = {};
  if (!h.scroll?.index)
    return ret;
  if (!Array.isArray(h.scroll?.index))
    throw new Error('invalid index header');
  for (let i=0; i<h.scroll.index.length; i++){
    let desc = normalize_opt(h.scroll.index[i]), {name} = desc;
    if (ret.get(name))
      throw new Error('duplicated index '+name);
    ret.set(name, new Index(normalize_opt(desc)));
  }
  return ret;
}

Index.normalize_opt = normalize_opt;
Index.creates_indexes_from_header = creates_indexes_from_header;
