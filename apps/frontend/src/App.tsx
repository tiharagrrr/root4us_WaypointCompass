import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import './App.css'
import { Home } from './routes/Home'
import { ROLE_ROUTES, RolePlaceholder } from './routes/roles'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          {ROLE_ROUTES.map((r) => (
            <Route key={r.path} path={`${r.path}/*`} element={<RolePlaceholder route={r} />} />
          ))}
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
