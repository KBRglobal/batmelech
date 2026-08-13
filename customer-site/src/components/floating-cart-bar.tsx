import { Icon } from '@iconify/react'
import { useNavigate } from 'react-router'
import { useCart } from '../cart-context'

export function FloatingCartBar() {
  const { lines, subtotal } = useCart()
  const navigate = useNavigate()
  const count = lines.reduce((n, l) => n + l.qty, 0)

  return (
    <div className="fixed bottom-0 left-0 right-0 p-6 md:p-10 bg-[#F7ECE6]/95 backdrop-blur-3xl border-t-4 border-[#EDB2C1]/20 z-[200] shadow-[0_-30px_60px_rgba(0,0,0,0.15)]">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 md:gap-10">
        <div className="flex items-center gap-6 md:gap-10 w-full sm:w-auto justify-center sm:justify-start">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl md:rounded-3xl bg-[#3B151A] text-white flex items-center justify-center text-2xl md:text-3xl font-black shadow-2xl relative shrink-0">
            {count}
          </div>
          <div className="flex flex-col">
            <span className="text-[#3B151A]/40 text-xs md:text-sm font-black uppercase tracking-[0.2em] mb-1">
              הסל שלך
            </span>
            <span className="text-2xl md:text-3xl font-black text-[#3B151A] leading-none">${subtotal}</span>
          </div>
        </div>
        <button
          type="button"
          disabled={count === 0}
          onClick={() => navigate('/checkout')}
          className="w-full sm:w-auto bg-[#3B151A] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white px-10 md:px-14 py-5 md:py-7 rounded-[2rem] md:rounded-[2.5rem] font-black text-xl md:text-2xl shadow-2xl transition-all flex items-center justify-center gap-4 group"
        >
          המשך להזמנה
          <Icon icon="ph:basket-fill" className="text-2xl md:text-3xl group-hover:scale-125 transition-transform" />
        </button>
      </div>
    </div>
  )
}
