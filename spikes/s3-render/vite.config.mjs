import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Dust data and contract samples are exposed read-only via public/ symlinks (see the predev script);
// resolve.alias does not serve raw files in dev mode (requests fall through to index.html).
const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  server: { port: 5173, fs: { allow: [root] } },
});
