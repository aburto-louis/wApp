import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { ThemeProvider } from "./components/ui/theme-provider"
import { Toaster } from "./components/ui/toast"
import { router, queryClient } from "./lib/config"
import "./index.css"

const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error("Missing Root Element.")
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
