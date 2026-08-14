import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import { CartProvider } from './cart-context'
import { SiteStatusProvider } from './site-status-context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/site">
      <SiteStatusProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </SiteStatusProvider>
    </BrowserRouter>
  </StrictMode>,
)
