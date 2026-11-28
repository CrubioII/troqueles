import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build id baked into the bundle and also published as /version.json. The app
// compares both (lib/useNuevaVersion.js) so a screen left open for days — the
// plant tablets — reloads onto the current version instead of running old
// forms that no longer ask for the fields the stations need.
const BUILD_ID = process.env.VITE_BUILD_ID || String(Date.now())

function versionJson() {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

export default defineConfig({
  plugins: [react(), versionJson()],
  define: {
    __APP_BUILD__: JSON.stringify(BUILD_ID),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
