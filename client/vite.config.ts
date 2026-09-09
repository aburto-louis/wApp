import { defineConfig, loadEnv } from "vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import path from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const workspaceRoot = path.resolve(import.meta.dirname, "..")

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "")

  return {
    envDir: workspaceRoot,
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        quoteStyle: "double",
        semicolons: false,
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      port: Number(env.CLIENT_PORT ?? 5173),
      proxy: {
        "/api": {
          target: env.SERVER_ORIGIN || "http://localhost:3000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  }
})
