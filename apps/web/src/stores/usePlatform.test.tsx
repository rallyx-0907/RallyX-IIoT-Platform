import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {usePlatform} from './usePlatform';

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shares one bulk tag snapshot and one existing realtime channel for dashboards',async()=>{
 const sockets:unknown[]=[];
 class Socket{onopen:unknown;onmessage:unknown;onclose:unknown;onerror:unknown;constructor(){sockets.push(this);}close(){}}
 vi.stubGlobal('WebSocket',Socket);
 const fetcher=vi.fn(async(_url:RequestInfo|URL)=>new Response('[]'));vi.stubGlobal('fetch',fetcher);
 const user={id:'viewer',username:'viewer',role:'viewer' as const,must_change_password:false};
 const {result}=renderHook(()=>usePlatform(user,'tags'));
 await waitFor(()=>expect(result.current.loading).toBe(false));
 expect(sockets.length).toBe(1);
 expect(fetcher.mock.calls.map(call=>String(call[0]))).toEqual(['/api/v1/tags','/api/v1/alarms']);
 expect(result.current.data.tags).toEqual([]);
});
