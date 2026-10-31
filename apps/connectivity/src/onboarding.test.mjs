import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseTransient,flattenFields} from './onboarding.mjs';
test('transient Modbus scan reads only and closes adapter without publishing',async()=>{
 let closed=0;const seen=[];
 const result=await diagnoseTransient({operation:'scan',connection:{protocol:'modbus-tcp'},device:{},scan_start:5,scan_count:3},{createAdapter:async()=>({read:async tags=>{seen.push(tags[0]);return{readings:[{tag_id:tags[0].id,raw:[42],decoded:42}]}},close:async()=>closed++})});
 assert.equal(closed,1);assert.equal(result.readings.length,3);assert.deepEqual(seen.map(t=>t.address),['5','6','7']);assert.equal(result.readings[0].quality,'GOOD');assert.equal(result.readings[0].definition.name,'Tín hiệu 1');
});
test('MQTT field discovery preserves false/zero, bounded paths and sample metadata',()=>{
 const fields=flattenFields('factory/motor',{timestamp:'2026-10-31',values:{run:false,power:0,temperature:25},units:{temperature:'°C'}});
 assert.equal(fields.find(f=>f.path==='values.run').value,false);assert.equal(fields.find(f=>f.path==='values.power').value,0);assert.equal(fields.find(f=>f.path==='values.temperature').unit,'°C');assert.ok(!fields.some(f=>f.path==='timestamp'));
});
