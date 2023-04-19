// author: derry. coder: arik.
const E = {};

// XXX: need test + improve
export function valid_dir(dir){ return dir[0]=='/' && dir[dir.length-1]=='/'; }

// XXX: need test + improve
export function valid_file(file){ return file[0]=='/' && file[file.length-1]!='/'; }
