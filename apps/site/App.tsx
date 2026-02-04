import { BrowserRouter, Route, Routes } from 'react-router-dom'
import SiteLayout from './components/layout/SiteLayout'
import Docs from './Docs'
import Home from './Home'
import Playground from './Playground'

const App = () => {
  const base = import.meta.env.BASE_URL ?? '/'
  const normalizedBase = base === '/' ? '' : base.replace(/\/$/, '')

  return (
    <BrowserRouter basename={normalizedBase}>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/*" element={<Docs />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
