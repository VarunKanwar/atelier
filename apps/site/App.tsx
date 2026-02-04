import { BrowserRouter, Route, Routes } from 'react-router-dom'
import SiteLayout from './components/layout/SiteLayout'
import Docs from './DocsPage'
import Home from './HomePage'
import Playground from './PlaygroundPage'

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
