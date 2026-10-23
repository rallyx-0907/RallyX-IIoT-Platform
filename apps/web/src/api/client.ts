export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let body;
  try { body = await response.json(); } catch { throw new ApiError('The service returned an invalid response.', response.status); }
  if (!response.ok) throw new ApiError(body?.error?.message || 'The service is unavailable.', response.status);
  return body as T;
}

export const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
