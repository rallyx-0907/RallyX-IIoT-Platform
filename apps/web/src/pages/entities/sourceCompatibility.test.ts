import {expect,it} from 'vitest';
import {canonicalUnit,sourceIssue,suggestSources} from './sourceCompatibility';
it('normalizes unit aliases without confusing SI magnitudes',()=>{
 expect(canonicalUnit(' kw ')).toBe('kW');expect(canonicalUnit('degC')).toBe('°C');expect(canonicalUnit('mW')).not.toBe(canonicalUnit('MW'));
});
it('explains invalid sources and suggests only unambiguous compatible matches',()=>{
 const metric={key:'power',name:'Công suất',data_type:'number' as const,unit:'kW',precision:1,history:true};
 const source={id:'1',key:'power',name:'Công suất',datatype:'number',data_type:'float32',unit:' kw ',device_id:'d',device_name:'D',asset_name:'A',store_history:true};
 expect(sourceIssue(source,metric)).toBe('');expect(sourceIssue({...source,unit:'A'},metric)).toContain('Khác đơn vị');expect(sourceIssue({...source,store_history:false},metric)).toContain('lịch sử');
 expect(suggestSources([metric],[source])).toEqual({power:'1'});
 expect(suggestSources([metric],[source,{...source,id:'2'}])).toEqual({});
});
