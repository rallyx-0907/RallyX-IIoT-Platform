import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Core and Web use the identical unit alias contract',()=>{
 const core=JSON.parse(readFileSync(new URL('../../apps/core/internal/units/aliases.json',import.meta.url)));
 const web=JSON.parse(readFileSync(new URL('../../apps/web/src/pages/entities/unitAliases.json',import.meta.url)));
 assert.deepEqual(web,core);
});
