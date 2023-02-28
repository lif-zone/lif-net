// author: derry. coder: arik.
'use strict';
import assert from 'assert';
import Tree from 'avl';

function cmp(a, b){ return a.seq - b.seq; }

export default class Mem_map {
  constructor(){ this.avl = new Tree(cmp, true); }
  add(seq){
    assert(Number.isInteger(seq) && seq>=0, 'invalid seq '+seq);
    let section = this.get_section(seq), section_next;
    if (section) // already exists in map
      return;
    if (section = this.get_section(seq-1)){ // try merge with prev section
      assert.equal(section.seq+section.size, seq, 'section corruption');
      section.size++;
      section_next = this.get_section(seq+1);
      this._merge(section, section_next);
      return;
    }
    if (section_next = this.get_section(seq+1)){ // try merge with next section
      assert.equal(section_next.seq, seq+1, 'section corruption');
      this._remove(section_next);
      section_next.seq = seq;
      section_next.size++;
      this._insert(section_next);
      return;
    }
    this._insert({seq, size: 1}); // new entry
  }
  get_section(seq){
    for (let n = this.avl._root; n; n = seq < n.key.seq ? n.left : n.right){
      let section = n.key;
      if (section.seq<=seq && seq<section.seq+section.size)
        return section;
    }
  }
  _insert(section){ this.avl.insert(section); }
  _remove(section){ this.avl.remove(section); }
  _merge(section, section_next){
    if (!section_next)
      return;
    section.size += section_next.size;
    this._remove(section_next);
  }
}
