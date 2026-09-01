import { QueryClient } from "@tanstack/react-query"
import { createRouter } from "@tanstack/react-router"
import { routeTree } from "@/routeTree.gen"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: false,
    },
  },
})

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 30_000,
  defaultStaleTime: 0,
  defaultViewTransition: true,
  scrollRestoration: true,
})

export type RouterContext = {
  queryClient: QueryClient
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
