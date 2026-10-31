import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
class OfflineSocket { onopen = null; onmessage = null; onclose = null; onerror = null; close() {} }

it('shows login and a visible authentication failure', async () => {
  vi.stubGlobal('fetch', vi.fn(() => response({ error: { message: 'Invalid username or password' } }, 401)));
  render(<App />);
  await screen.findByRole('heading', { name: 'Sign in to RallyX' });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'incorrect-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
});

it('renders an empty configuration without inventing equipment', async () => {
  vi.stubGlobal('WebSocket', OfflineSocket);
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/me')
    ? response({ id: 'viewer', username: 'viewer', role: 'viewer', must_change_password: false })
    : response([])));
  render(<App />);
  expect(await screen.findByText('Bắt đầu giám sát thiết bị')).toBeTruthy();
  expect(screen.queryByText('Motor 01')).toBeNull();
});

it('keeps API failures visible instead of showing successful empty data', async () => {
  vi.stubGlobal('WebSocket', OfflineSocket);
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/auth/me')
    ? response({ id: 'viewer', username: 'viewer', role: 'viewer', must_change_password: false })
    : response({ error: { message: 'Database unavailable' } }, 503)));
  render(<App />);
  expect(await screen.findByText('Database unavailable')).toBeTruthy();
});

it('opens native monitoring from root while retaining old dashboard pointers for the legacy viewer',async()=>{
 history.replaceState(null,'','/');localStorage.setItem('rallyx.dashboard.last.viewer',JSON.stringify({kind:'grafana',id:'kept'}));
 vi.stubGlobal('WebSocket',OfflineSocket);vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/auth/me')?response({id:'viewer',username:'viewer',role:'viewer',must_change_password:false}):url.endsWith('/grafana/status')?response({available:true,can_edit:false}):url.includes('search?')?response([{uid:'kept',title:'Saved'}]):response([])));
 render(<App/>);expect(await screen.findByText('Giám sát vận hành')).toBeTruthy();expect(localStorage.getItem('rallyx.dashboard.last.viewer')).toContain('kept');
 expect(screen.queryByRole('link',{name:'Data widgets'})).toBeNull();localStorage.clear();history.replaceState(null,'','/');
});
it('opens saved dashboards even while unrelated platform snapshots are unavailable',async()=>{
 history.replaceState(null,'','/?dashboard=ready#dashboards');vi.stubGlobal('WebSocket',OfflineSocket);
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.endsWith('/auth/me')?response({id:'viewer',username:'viewer',role:'viewer',must_change_password:false}):url.endsWith('/grafana/status')?response({available:true,can_edit:false}):url.includes('search?')?response([{uid:'ready',title:'Ready'}]):url.endsWith('/assets/tree')||url.endsWith('/assets')?new Promise<Response>(()=>{}):response([])));
 render(<App/>);expect((await screen.findByTitle('Grafana dashboards')).getAttribute('src')).toContain('/ready?kiosk');history.replaceState(null,'','/');
});
