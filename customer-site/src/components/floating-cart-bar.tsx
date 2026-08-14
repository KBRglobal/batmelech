import { Icon } from '@iconify/react'
import { useNavigate } from 'react-router'
import { useCart } from '../cart-context'

export function FloatingCartBar() {
  const { lines, subtotal } = useCart()
  const navigate = useNavigate()
  const count = lines.reduce((n, l) => n + l.qty, 0)

  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={() => navigate('/checkout')}
      className="fixed bottom-6 left-6 md:bottom-10 md:left-10 z-[200] w-16 h-16 md:w-20 md:h-20 rounded-full bg-[#3B151A] hover:bg-black text-white shadow-2xl flex items-center justify-center transition-all group"
    >
      <Icon icon="ph:basket-fill" className="text-2xl md:text-3xl group-hover:scale-110 transition-transform" />
      <span className="absolute -top-1.5 -right-1.5 min-w-6 h-6 px-1 rounded-full bg-[#F5A83A] text-[#3B151A] text-xs font-black flex items-center justify-center shadow-lg">
        {count}
      </span>
      <span className="absolute top-full mt-2 left-0 whitespace-nowrap text-xs font-black bg-white text-[#3B151A] px-2 py-1 rounded-lg shadow-md">
        ${subtotal} USD
      </span>
    </button>
  )
}
