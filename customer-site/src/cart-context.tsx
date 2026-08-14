import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

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
  phoneCode: string
  phone: string
  email: string
  address: string
  notes: string
  fulfillment: Fulfillment
  date: string
  time: string
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

const EMPTY_CUSTOMER: CustomerDetails = { name: '', phoneCode: '+971', phone: '', email: '', address: '', notes: '', fulfillment: 'delivery', date: '', time: '' }

const STORAGE_KEY = 'bm-cart-v1'

function readStoredLines(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (l): l is CartLine =>
        !!l &&
        typeof l === 'object' &&
        typeof (l as CartLine).id === 'string' &&
        typeof (l as CartLine).name === 'string' &&
        Number.isFinite((l as CartLine).unitPrice) &&
        Number.isFinite((l as CartLine).qty) &&
        (l as CartLine).qty > 0,
    )
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readStoredLines)
  const [customer, setCustomerState] = useState<CustomerDetails>(EMPTY_CUSTOMER)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      // storage full or blocked (private mode) — cart still works in-memory
    }
  }, [lines])

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
