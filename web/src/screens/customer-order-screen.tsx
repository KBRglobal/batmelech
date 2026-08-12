import { LocalIcon } from '../components/local-icon.tsx'

export const VERIFIED_CUSTOMER_ORDER_PATH = '/order-form.html'

export function CustomerOrderScreen() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-5 py-12"
      data-admin-state-access="none"
      dir="rtl"
      lang="he"
    >
      <section className="w-full max-w-xl rounded-[2rem] border border-border bg-card p-7 text-center shadow-[0_24px_70px_rgba(99,33,40,0.08)] sm:p-10">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary">
          <LocalIcon name="ph:shopping-cart-bold" className="text-3xl" />
        </div>
        <h1 className="mt-5 font-heading text-3xl font-black text-primary">הזמנה ממטעמי בת מלך</h1>
        <p className="mx-auto mt-3 max-w-md text-sm font-bold leading-7 text-muted-foreground">
          כדי לשמור במדויק על כל השדות וחישובי המחיר של טופס ההזמנה הציבורי הקיים,
          ממשיכים אליו באותה כתובת של האתר.
        </p>
        <a
          href={VERIFIED_CUSTOMER_ORDER_PATH}
          className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-black text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span>מעבר לטופס ההזמנה המלא</span>
          <LocalIcon name="ph:arrow-left-bold" className="text-lg" />
        </a>
        <p className="mt-4 text-xs font-bold text-muted-foreground">המעבר נשאר בתוך האתר ואינו פותח מערכת ניהול.</p>
      </section>
    </main>
  )
}

export default CustomerOrderScreen
