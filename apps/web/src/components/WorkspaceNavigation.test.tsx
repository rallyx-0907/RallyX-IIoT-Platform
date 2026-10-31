import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {WorkspaceNavigation} from './WorkspaceNavigation';
afterEach(cleanup);
const pages=[['dashboards','','Dashboards',''],['devices','','Devices',''],['legacy-dashboards','','Báo cáo nâng cao','']];
it('shows operational navigation only for operators',()=>{render(<WorkspaceNavigation pages={pages} role="operator" current="dashboards" alarmCount={0} onNavigate={()=>{}}/>);expect(screen.getByRole('link',{name:/Dashboards|Bảng điều khiển/})).toBeTruthy();expect(screen.queryByRole('link',{name:/Devices|Thiết bị/})).toBeNull();expect(screen.queryByText('Cài đặt')).toBeNull();});
it('groups admin configuration under a collapsed section',()=>{render(<WorkspaceNavigation pages={pages} role="admin" current="dashboards" alarmCount={0} onNavigate={()=>{}}/>);expect(screen.getByText('Cài đặt').closest('details')?.open).toBe(false);});
