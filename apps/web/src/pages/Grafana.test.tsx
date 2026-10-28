import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {Grafana} from './Grafana';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('embeds the authenticated same-origin dashboard and exposes editing for admins',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({enabled:true,available:true,url:'/grafana/d/rallyx-overview/rallyx',can_edit:true}))));
 render(<Grafana/>);
 const frame=await screen.findByTitle('Grafana dashboards');expect(frame.getAttribute('src')).toBe('/grafana/d/rallyx-overview/rallyx');
 expect(screen.getByRole('link',{name:'Open Grafana editor'}).getAttribute('href')).toBe('/grafana/');
});
it('explains an unavailable visualization service without blocking device configuration',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({enabled:true,available:false,can_edit:false}))));
 render(<Grafana/>);await screen.findByText('Grafana is temporarily unavailable. Data collection continues.');
 expect(screen.queryByTitle('Grafana dashboards')).toBeNull();
 expect(screen.getByRole('button',{name:'Retry'})).toBeTruthy();
});
