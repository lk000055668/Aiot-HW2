import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isStatic = env.VITE_APP_MODE === 'static';
  // Override for custom domains/forks. GitHub Actions supplies the actual repository name.
  const base = isStatic ? (env.VITE_BASE_PATH || '/Aiot-HW2/') : '/';
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('VITE_BASE_PATH must start and end with /.');
  return { base, plugins: [react()], server: { port: 5173 },
    build: { outDir: isStatic ? 'dist-static' : 'dist', chunkSizeWarningLimit: 5000 } };
});
