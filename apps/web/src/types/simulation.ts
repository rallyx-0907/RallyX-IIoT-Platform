export type SimulationMode = 'design' | 'preview' | 'live';
export type SimulationValue = boolean | number | string;
export type SimulationControlType = 'text' | 'indicator-lamp' | 'analog-gauge' | 'numeric-value' | 'rectangle' | 'line' | 'image';
export type BindingOperator = 'direct' | '==' | '!=' | '>' | '>=' | '<' | '<=';
export type SimulationCanvas = { width: number; height: number; gridSize: number; snapToGrid: boolean; backgroundColor?: string; backgroundImage?: string };
export type ControlBinding = { tagId: string; operator: BindingOperator; compareValue?: SimulationValue };
export type ControlInstance = { id: string; type: SimulationControlType; x: number; y: number; width: number; height: number; rotation: number; zIndex: number; properties: Record<string, unknown>; binding?: ControlBinding };
export type DashboardDocument = { id: string; name: string; type: 'standard' | 'simulation'; canvas: SimulationCanvas; layout: ControlInstance[]; revision: number; createdAt: string; updatedAt: string; createdBy?: string; ownerUserId?: string };
export type ResolvedBinding = { value?: SimulationValue; conditionMatched?: boolean; available: boolean; quality: string; reason?: string };
