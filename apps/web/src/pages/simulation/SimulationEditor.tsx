import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Tag } from '../../types/platform';
import type { ControlInstance, DashboardDocument, SimulationControlType, SimulationMode } from '../../types/simulation';
import { CONTROL_REGISTRY, createControl, safeImageSource } from '../../components/simulation/registry';
import { duplicateControl, resizeControl, snapAndClamp } from '../../components/simulation/geometry';
import { resolveBinding } from '../../components/simulation/binding';
import { ControlRenderer } from '../../components/simulation/ControlRenderer';
import './simulationEditor.css';
import { BufferedInput } from './BufferedInput';
import {SelectorProperties,convertSelectorPositions} from './SelectorProperties';

type Props = { dashboard: DashboardDocument; onChange: (dashboard: DashboardDocument) => void; tags: Tag[]; mode: SimulationMode; connection: string };
type DragState = { id: string; x: number; y: number; control: ControlInstance; resize: boolean };
const operators = ['direct', '==', '!=', '>', '>=', '<', '<='] as const;
const selectorOptionLabels: Record<string,string> = { horizontal: 'Ngang', vertical: 'Dọc', rotary: 'Núm xoay', lever: 'Tay gạt' };
const tagType = (tag: Tag | undefined): 'boolean' | 'number' | 'string' => { const value = tag?.data_type || tag?.datatype || ''; return ['bool', 'boolean'].includes(value) ? 'boolean' : /int|float|number|double|decimal/.test(value) ? 'number' : 'string'; };
const finite = (value: string, fallback: number) => Number.isFinite(Number(value)) && value.trim() !== '' ? Number(value) : fallback;

export function SimulationEditor({ dashboard, onChange, tags, mode, connection }: Props) {
  const [selectedID, setSelectedID] = useState<string>();
  const [previewValues, setPreviewValues] = useState<Record<string, boolean | number | string>>({});
  const [device, setDevice] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { setPreviewValues({}); setSelectedID(undefined); }, [dashboard.id]);
  const editorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const design = mode === 'design';
  const selected = dashboard.layout.find(control => control.id === selectedID);
  const tagMap = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags]);
  const devices = useMemo(() => [...new Map(tags.map(tag => [tag.device_id, tag.device_name || tag.device_id])).entries()], [tags]);
  const filteredTags = tags.filter(tag => !(selected?.type === 'selector-switch' && Array.isArray(selected.properties.positions) && selected.properties.positions.length === 3 && tagType(tag) === 'boolean') && (!device || tag.device_id === device) && (!search || (tag.name + ' ' + tag.key).toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (!selected || CONTROL_REGISTRY[selected.type]?.bindingTypes.includes(tagType(tag))));
  const update = (control: ControlInstance) => onChange({ ...dashboard, layout: dashboard.layout.map(item => item.id === control.id ? control : item) });
  const bindTag = (tagId: string) => {
    if (!selected) return;
    const tag = tagMap.get(tagId);
    update({ ...selected, binding: tagId ? { tagId, operator: 'direct' } : undefined, properties: selected.type === 'selector-switch' && tag ? { ...selected.properties, positions: convertSelectorPositions(selected.properties.positions, tagType(tag)) } : selected.properties });
  };
  const remove = () => { if (!selected) return; onChange({ ...dashboard, layout: dashboard.layout.filter(item => item.id !== selected.id) }); setSelectedID(undefined); };
  const add = (type: SimulationControlType, x = 40, y = 40) => {
    if (!design || dashboard.layout.length >= 1000) return;
    const base = createControl(type, x, y);
    const control = snapAndClamp({ ...base, zIndex: Math.max(0, ...dashboard.layout.map(item => item.zIndex)) + 1 }, x, y, dashboard.canvas);
    onChange({ ...dashboard, layout: [...dashboard.layout, control] }); setSelectedID(control.id);
  };
  const point = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return { x: 40, y: 40 };
    return { x: rect?.width ? (clientX - rect.left) * dashboard.canvas.width / rect.width : 0, y: rect?.height ? (clientY - rect.top) * dashboard.canvas.height / rect.height : 0 };
  };
  const begin = (event: PointerEvent<HTMLDivElement>, control: ControlInstance, resize = false) => {
    if (!design || event.button !== 0) return;
    event.stopPropagation(); editorRef.current?.focus({ preventScroll: true }); setSelectedID(control.id);
    const p = point(event.clientX, event.clientY);
    drag.current = { id: control.id, ...p, control, resize };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current; if (!active || !design) return;
    const p = point(event.clientX, event.clientY);
    update(active.resize ? resizeControl(active.control, active.control.width + p.x - active.x, active.control.height + p.y - active.y, dashboard.canvas) : snapAndClamp(active.control, active.control.x + p.x - active.x, active.control.y + p.y - active.y, dashboard.canvas));
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!design || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, [contenteditable="true"]'))) return;
    if (event.key === 'Escape') { setSelectedID(undefined); return; }
    if (!selected) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); return; }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (delta) { event.preventDefault(); const step = event.shiftKey ? dashboard.canvas.gridSize : 1; update(snapAndClamp(selected, selected.x + delta[0] * step, selected.y + delta[1] * step, { ...dashboard.canvas, snapToGrid: false })); }
  };
  const layer = (front: boolean) => {
    if (!selected) return;
    const ordered = dashboard.layout.filter(control => control.id !== selected.id).sort((a, b) => a.zIndex - b.zIndex);
    if (front) ordered.push(selected); else ordered.unshift(selected);
    onChange({ ...dashboard, layout: ordered.map((control, index) => ({ ...control, zIndex: index + 1 })) });
  };
  const resizeCanvas = (key: 'width' | 'height', value: string) => {
    const minimum = key === 'width' ? 320 : 240;
    const canvas = { ...dashboard.canvas, [key]: Math.min(10000, Math.max(minimum, finite(value, dashboard.canvas[key]))) };
    onChange({ ...dashboard, canvas, layout: dashboard.layout.map(control => snapAndClamp({ ...control, width: Math.min(control.width, canvas.width), height: Math.min(control.height, canvas.height) }, control.x, control.y, canvas)) });
  };
  return <div ref={editorRef} className={'simulation-editor simulation-mode-' + mode} onKeyDown={keyboard} tabIndex={0} aria-label="Sơ đồ thiết bị">
    {design && <aside className="simulation-palette"><h3>Thêm phần tử</h3><p>Kéo vào bản vẽ hoặc bấm để thêm.</p>{(Object.keys(CONTROL_REGISTRY) as SimulationControlType[]).map(type => <button key={type} type="button" draggable disabled={dashboard.layout.length >= 1000} aria-label={'Thêm ' + CONTROL_REGISTRY[type].label} onDragStart={event => event.dataTransfer.setData('application/rallyx-control', type)} onClick={() => add(type)}>{CONTROL_REGISTRY[type].label}</button>)}<fieldset><legend>Kích thước bản vẽ</legend><label>Rộng (px)<BufferedInput type="number" min={320} max={10000} value={dashboard.canvas.width} onChange={event => resizeCanvas('width', event.target.value)} /></label><label>Cao (px)<BufferedInput type="number" min={240} max={10000} value={dashboard.canvas.height} onChange={event => resizeCanvas('height', event.target.value)} /></label><label>Bước lưới (px)<BufferedInput type="number" min={1} max={100} value={dashboard.canvas.gridSize} onChange={event => onChange({ ...dashboard, canvas: { ...dashboard.canvas, gridSize: Math.min(100, Math.max(1, finite(event.target.value, 10))) } })} /></label><label><BufferedInput type="checkbox" checked={dashboard.canvas.snapToGrid} onChange={event => onChange({ ...dashboard, canvas: { ...dashboard.canvas, snapToGrid: event.target.checked } })} /> Bám lưới</label><label>Màu nền<BufferedInput type="color" value={dashboard.canvas.backgroundColor || '#f1f5f9'} onChange={event => onChange({ ...dashboard, canvas: { ...dashboard.canvas, backgroundColor: event.target.value } })} /></label></fieldset></aside>}
    <section className="simulation-stage"><div className="simulation-stage-caption">{mode === 'design' ? 'Thiết kế — chọn phần tử để cấu hình. Dùng phím mũi tên để dịch chuyển.' : mode === 'preview' ? 'Xem thử — giá trị giả lập cục bộ' : connection === 'live' ? 'Trực tiếp — chỉ đọc dữ liệu' : 'Chưa có kết nối trực tiếp — không hiển thị trạng thái giả'}</div><div className="simulation-scroll"><div ref={canvasRef} className={'simulation-canvas' + (design && dashboard.canvas.snapToGrid ? ' simulation-grid' : '')} style={{ width: dashboard.canvas.width, height: dashboard.canvas.height, backgroundColor: dashboard.canvas.backgroundColor || '#f1f5f9', backgroundSize: safeImageSource(dashboard.canvas.backgroundImage) ? '100% 100%' : dashboard.canvas.gridSize + 'px ' + dashboard.canvas.gridSize + 'px', backgroundImage: safeImageSource(dashboard.canvas.backgroundImage) ? 'url("' + safeImageSource(dashboard.canvas.backgroundImage) + '")' : undefined }} onPointerDown={event => { if (event.target === event.currentTarget) { editorRef.current?.focus({ preventScroll: true }); setSelectedID(undefined); } }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onDragOver={event => { if (design) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const type = event.dataTransfer.getData('application/rallyx-control'); if (Object.prototype.hasOwnProperty.call(CONTROL_REGISTRY, type)) { const p = point(event.clientX, event.clientY); add(type as SimulationControlType, p.x, p.y); } }}>
      {dashboard.layout.map(control => <div key={control.id} data-control-id={control.id} className={'simulation-control' + (design ? ' simulation-control-editable' : '') + (design && control.id === selectedID ? ' simulation-selected' : '')} style={{ left: control.x, top: control.y, width: control.width, height: control.height, zIndex: control.zIndex, transform: 'rotate(' + control.rotation + 'deg)' }} onPointerDown={event => begin(event, control)} onClick={() => { if (design) setSelectedID(control.id); }}><ControlRenderer control={control} resolved={resolveBinding(control.binding, tagMap, { mode, previewValues, offline: connection !== 'live' })} />{design && control.id === selectedID && CONTROL_REGISTRY[control.type]?.resizable && <div className="simulation-resize-handle" role="button" aria-label="Đổi kích thước" onPointerDown={event => begin(event, control, true)} />}</div>)}
      {!dashboard.layout.length && <div className="simulation-empty">{design ? 'Thêm đèn, đồng hồ hoặc văn bản từ danh sách bên trái.' : 'Bản vẽ chưa có phần tử.'}</div>}
    </div></div></section>
    {design && <aside className="simulation-inspector"><h3>Cấu hình phần tử</h3>{!selected ? <p>Chọn một phần tử trên bản vẽ để đặt tên, chỉnh vị trí và gán tín hiệu.</p> : <><p>{CONTROL_REGISTRY[selected.type]?.label || selected.type}</p><div className="simulation-coordinates">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{{ x: 'X (px)', y: 'Y (px)', width: 'Rộng (px)', height: 'Cao (px)' }[key]}<BufferedInput type="number" value={selected[key]} onChange={event => { const value = finite(event.target.value, selected[key]); update(key === 'x' || key === 'y' ? snapAndClamp(selected, key === 'x' ? value : selected.x, key === 'y' ? value : selected.y, { ...dashboard.canvas, snapToGrid: false }) : resizeControl(selected, key === 'width' ? value : selected.width, key === 'height' ? value : selected.height, { ...dashboard.canvas, snapToGrid: false })); }} /></label>)}</div>
      {CONTROL_REGISTRY[selected.type]?.properties.map(property => <label key={property.key}>{property.label}{property.type === 'select' ? <select value={String(selected.properties[property.key] ?? CONTROL_REGISTRY[selected.type].defaultProperties[property.key] ?? '')} onChange={event => update({ ...selected, properties: { ...selected.properties, [property.key]: event.target.value } })}>{property.options?.map(option => <option key={option} value={option}>{selected.type === 'indicator-lamp' && property.key === 'mode' ? (option === 'blink' ? 'Nhấp nháy' : 'Sáng liên tục') : selected.type === 'selector-switch' ? selectorOptionLabels[option] || option : option}</option>)}</select> : <BufferedInput maxLength={selected.type === 'selector-switch' ? 80 : undefined} type={property.type === 'color' ? 'color' : property.type === 'number' ? 'number' : 'text'} min={property.min} max={property.max} step={property.step} value={String(selected.properties[property.key] ?? CONTROL_REGISTRY[selected.type].defaultProperties[property.key] ?? '')} onChange={event => update({ ...selected, properties: { ...selected.properties, [property.key]: property.type === 'number' ? Math.min(property.max ?? Infinity, Math.max(property.min ?? -Infinity, property.step === 1 ? Math.round(finite(event.target.value, Number(selected.properties[property.key]) || 0)) : finite(event.target.value, Number(selected.properties[property.key]) || 0))) : event.target.value } })} />}</label>)}
      {selected.type === 'line' && <label>Góc xoay (độ)<BufferedInput type="number" min={-360} max={360} value={selected.rotation} onChange={event => update({ ...selected, rotation: Math.min(360, Math.max(-360, finite(event.target.value, 0))) })} /></label>}
      {selected.type === 'selector-switch' && <SelectorProperties properties={selected.properties} onChange={properties => update({ ...selected, properties })} boundType={selected.binding && tagMap.get(selected.binding.tagId) ? tagType(tagMap.get(selected.binding.tagId)) : undefined}/>}
      {CONTROL_REGISTRY[selected.type]?.bindable && <fieldset><legend>Nguồn tín hiệu</legend><label>Lọc theo thiết bị<select value={device} onChange={event => setDevice(event.target.value)}><option value="">Tất cả thiết bị</option>{devices.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><label>Tìm tín hiệu<BufferedInput value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên hoặc mã tín hiệu" /></label><label>Tín hiệu<select value={selected.binding?.tagId || ''} onChange={event => bindTag(event.target.value)}><option value="">Chưa gán tín hiệu</option>{selected.binding && !filteredTags.some(tag => tag.id === selected.binding?.tagId) && <option value={selected.binding.tagId}>{tagMap.get(selected.binding.tagId)?.name || 'Tín hiệu không còn tồn tại'}</option>}{filteredTags.map(tag => <option value={tag.id} key={tag.id}>{tag.device_name || tag.device_id} · {tag.name}{tag.unit ? ' (' + tag.unit + ')' : ''}</option>)}</select></label>{selected.binding && <><label>Phép so sánh<select value={selected.binding.operator} onChange={event => { const operator = event.target.value as typeof operators[number]; update({ ...selected, binding: { ...selected.binding!, operator, ...(operator === 'direct' ? { compareValue: undefined } : { compareValue: selected.binding?.compareValue ?? (tagType(tagMap.get(selected.binding!.tagId)) === 'boolean' ? true : tagType(tagMap.get(selected.binding!.tagId)) === 'number' ? 0 : '') }) } }); }}>{operators.filter(operator => ['analog-gauge', 'selector-switch'].includes(selected.type) ? operator === 'direct' : tagType(tagMap.get(selected.binding!.tagId)) === 'number' || ['direct', '==', '!='].includes(operator)).map(operator => <option value={operator} key={operator}>{operator === 'direct' ? 'Giá trị trực tiếp' : operator}</option>)}</select></label>{selected.binding.operator !== 'direct' && <label>Giá trị so sánh{tagType(tagMap.get(selected.binding.tagId)) === 'boolean' ? <select value={String(selected.binding.compareValue ?? true)} onChange={event => update({ ...selected, binding: { ...selected.binding!, compareValue: event.target.value === 'true' } })}><option value="true">true</option><option value="false">false</option></select> : <BufferedInput type={tagType(tagMap.get(selected.binding.tagId)) === 'number' ? 'number' : 'text'} value={String(selected.binding.compareValue ?? '')} onChange={event => { const value = event.target.value; const converted = tagType(tagMap.get(selected.binding!.tagId)) === 'number' ? finite(value, 0) : value; update({ ...selected, binding: { ...selected.binding!, compareValue: converted } }); }} />}</label>}</>}</fieldset>}
      <div className="simulation-actions"><button type="button" onClick={() => { const copy = duplicateControl(selected, dashboard.canvas); onChange({ ...dashboard, layout: [...dashboard.layout, copy] }); setSelectedID(copy.id); }} disabled={dashboard.layout.length >= 1000}>Nhân bản</button><button type="button" onClick={() => layer(true)}>Đưa lên trước</button><button type="button" onClick={() => layer(false)}>Đưa ra sau</button><button type="button" onClick={remove}>Xóa phần tử</button></div></>}</aside>}
    {mode === 'preview' && <aside className="simulation-inspector"><h3>Giá trị xem thử</h3><p>Giá trị xem thử chỉ tồn tại trong trình duyệt, không ghi vào tín hiệu hay thiết bị.</p>{[...new Set(dashboard.layout.flatMap(control => control.binding ? [control.binding.tagId] : []))].map(id => { const tag = tagMap.get(id); const boolean = tagType(tag) === 'boolean'; return <label key={id}>{tag?.name || id}{boolean ? <select value={String(previewValues[id] ?? '')} onChange={event => setPreviewValues(values => ({ ...values, [id]: event.target.value === 'true' }))}><option value="" disabled>Chọn giá trị</option><option value="true">Bật / true</option><option value="false">Tắt / false</option></select> : <BufferedInput type={tagType(tag) === 'number' ? 'number' : 'text'} value={String(previewValues[id] ?? '')} onChange={event => { const value = tagType(tag) === 'number' ? finite(event.target.value, 0) : event.target.value; setPreviewValues(values => ({ ...values, [id]: value })); }} />}</label>; })}<button type="button" onClick={() => setPreviewValues({})}>Xóa giá trị xem thử</button></aside>}
  </div>;
}
