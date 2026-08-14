import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type CartLine = {
  id: string
  name: string
  unitPrice: number
  qty: number
  note?: string
}

export type Fulfillment = 'delivery' | 'pickup'

export type CustomerDetails = {
  name: string
  phone: string
  email: string
  address: string
  notes: string
  fulfillment: Fulfillment
}

type CartContextValue = {
  lines: CartLine[]
  addLine: (line: Omit<CartLine, 'qty'> & { qty?: number }) => void
  removeLine: (id: string) => void
  setQty: (id: string, qty: number) => void
  clear: () => void
  subtotal: number
  customer: CustomerDetails
  setCustomer: (patch: Partial<CustomerDetails>) => void
}

const CartContext = createContext<CartContextValue | null>(null)

const EMPTY_CUSTOMER: CustomerDetails = { name: '', phone: '', email: '', address: '', notes: '', fulfillment: 'delivery' }

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [customer, setCustomerState] = useState<CustomerDetails>(EMPTY_CUSTOMER)

  const addLine: CartContextValue['addLine'] = (line) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.id === line.id)
      if (existing) {
        return prev.map((l) =>
          l.id === line.id ? { ...l, qty: l.qty + (line.qty ?? 1), unitPrice: line.unitPrice, note: line.note } : l,
        )
      }
      return [...prev, { ...line, qty: line.qty ?? 1 }]
    })
  }

  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id))

  const setQty = (id: string, qty: number) => {
    if (qty <= 0) {
      removeLine(id)
      return
    }
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, qty } : l)))
  }

  const clear = () => {
    setLines([])
    setCustomerState(EMPTY_CUSTOMER)
  }

  const setCustomer = (patch: Partial<CustomerDetails>) =>
    setCustomerState((prev) => ({ ...prev, ...patch }))

  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0), [lines])

  return (
    <CartContext.Provider value={{ lines, addLine, removeLine, setQty, clear, subtotal, customer, setCustomer }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
