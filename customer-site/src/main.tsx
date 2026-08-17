import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import { CartProvider } from './cart-context'
import { SiteStatusProvider } from './site-status-context'
import { SiteCatalogProvider } from './catalog-context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/site">
      <SiteStatusProvider>
        <SiteCatalogProvider>
        <CartProvider>
          <App />
        </CartProvider>
        </SiteCatalogProvider>
      </SiteStatusProvider>
    </BrowserRouter>
  </StrictMode>,
)
