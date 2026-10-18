import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // the demo phone reaches `vite preview` through a cloudflared tunnel
  preview: { allowedHosts: [".trycloudflare.com"] },
})
