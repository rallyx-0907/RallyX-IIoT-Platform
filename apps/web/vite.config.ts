import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://localhost:8081', ws: true }, '/health': 'http://localhost:8081' } },
  test: { environment: 'jsdom', clearMocks: true, setupFiles: ['./src/test-setup.ts'] },
});
