// A syntax error in any client module blanks the whole app: catch it before deploying.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
test('every client module parses', () => {
  const root = path.join(__dirname, '..', '..', 'public', 'js');
  for (const f of walk(root).filter(f => f.endsWith('.js'))) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${path.relative(root, f)}: ${r.stderr.split('\n')[0]}`);
  }
});
