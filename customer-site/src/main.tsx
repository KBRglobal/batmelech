import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import { CartProvider } from './cart-context'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/site">
      <CartProvider>
        <App />
      </CartProvider>
    </BrowserRouter>
  </StrictMode>,
)
