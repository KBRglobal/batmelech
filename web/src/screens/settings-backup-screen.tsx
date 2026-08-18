import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { APP_ROUTES } from '../app/routes.ts'
import { LocalIcon } from '../components/local-icon.tsx'
import { ScreenState } from '../components/screen-state.tsx'
import { StaffLoginSection } from '../components/staff-login-section.tsx'
import { StateHistorySection } from '../components/state-history-section.tsx'
import { MeyAuditSection } from '../components/mey-audit-section.tsx'
import { DeliveryWindowsSection } from '../components/delivery-windows-section.tsx'
import { HolidayMenusSection } from '../components/holiday-menus-section.tsx'
import { isSameVersionedStateEnvelope } from '../data/versioned-screen-save.tsx'
import { useStore } from '../data/use-store.ts'
import { buildDishCostIndex } from '../domain/cost-lookup.ts'
import {
  applySettingsToStore,
  createBackupArtifact,
  describeOrderingState,
  formatLastBackup,
  readSettingsDraft,
  reviewBackupText,
  toggleOrderingOpen,
  validateSettingsDraft,
  type BackupReview,
  type RestoreRequestHandler,
  type SettingsDraft,
} from '../domain/settings-backup.ts'
import {
  loadSettingsCatalog,
  type CatalogResult,
  type StoreSaveHandler,
} from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'
import { isVersionedStateEnvelope, type VersionedStateEnvelope } from '../services/state-api.ts'

type OperationState =
  | { readonly kind: 'idle'; readonly message: '' }
  | { readonly kind: 'busy'; readonly message: string }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

const IDLE: OperationState = { kind: 'idle', message: '' }
const actionClassName =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-sm font-black text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50'

interface SettingsInitialization {
  readonly baseEnvelope: VersionedStateEnvelope | null
  readonly baseStore: LegacyStore
  readonly catalogResult: CatalogResult
  readonly draft: SettingsDraft
}

function StatusMessage({ state }: { state: OperationState }) {
  if (state.kind === 'idle') return null
  return (
    <p
      role={state.kind === 'error' ? 'alert' : 'status'}
      className={`text-xs font-black ${state.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {state.message}
    </p>
  )
}

function reviewClassName(review: BackupReview): string {
  return review.status === 'ready'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : review.status === 'empty'
      ? 'border-border bg-secondary/50 text-muted-foreground'
      : 'border-rose-200 bg-rose-50 text-destructive'
}

export interface SettingsBackupScreenProps {
  readonly onSave?: StoreSaveHandler
  readonly onRestore?: RestoreRequestHandler
}

export function SettingsBackupScreen({ onSave, onRestore }: SettingsBackupScreenProps) {
  const storeQuery = useStore()
  const [searchParams] = useSearchParams()
  const developerTools = searchParams.get('dev') === '1'
  const initializationRef = useRef<SettingsInitialization | null>(null)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [backupText, setBackupText] = useState('')
  const [settingsState, setSettingsState] = useState<OperationState>(IDLE)
  const [backupState, setBackupState] = useState<OperationState>(IDLE)
  const [restoreState, setRestoreState] = useState<OperationState>(IDLE)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const downloadRef = useRef<HTMLAnchorElement>(null)

  if (initializationRef.current === null && storeQuery.data?.data != null) {
    const baseStore = storeQuery.data.data
    const catalogResult = loadSettingsCatalog(baseStore)
    initializationRef.current = {
      baseEnvelope: isVersionedStateEnvelope(storeQuery.data) ? storeQuery.data : null,
      baseStore,
      catalogResult,
      draft: readSettingsDraft(baseStore, catalogResult.catalog),
    }
  }

  if (storeQuery.isPending) return <ScreenState kind="loading" title="טוענת את ההגדרות" />
  if (storeQuery.isError || initializationRef.current === null) {
    return (
      <ScreenState
        kind="error"
        title="לא הצלחנו לטעון את ההגדרות"
        description="לא בוצע שינוי. אפשר לנסות שוב."
        retry={() => void storeQuery.refetch()}
      />
    )
  }

  const { baseEnvelope, baseStore, catalogResult, draft: initialDraft } = initializationRef.current
  const currentDraft = draft ?? initialDraft
  const validation = validateSettingsDraft(currentDraft)
  const review = reviewBackupText(backupText, baseStore)
  const stockItems = Object.values(catalogResult.catalog.categories).flat()
  const dishCostsByName = buildDishCostIndex(baseStore).byName

  const latestBackupStore = async (): Promise<LegacyStore> => {
    const refreshed = await storeQuery.refetch({ throwOnError: true })
    const refreshStatus = refreshed as { readonly isError?: boolean; readonly isRefetchError?: boolean }
    if (
      refreshStatus.isError === true ||
      refreshStatus.isRefetchError === true ||
      !refreshed.data ||
      !isVersionedStateEnvelope(refreshed.data)
    ) {
      throw new Error('Fresh versioned state is unavailable.')
    }
    return refreshed.data.data
  }

  const saveSettings = async () => {
    if (!validation.valid) {
      setSettingsState({ kind: 'error', message: validation.issues.join(' ') })
      return
    }
    if (!onSave) {
      setSettingsState({ kind: 'error', message: 'השמירה המוגנת עדיין אינה מחוברת. לא בוצע שינוי בשרת.' })
      return
    }
    if (baseEnvelope === null || !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)) {
      setSettingsState({
        kind: 'error',
        message: 'הנתונים התעדכנו מאז פתיחת הטיוטה. לא בוצעה שמירה; צריך לפתוח מחדש את המסך.',
      })
      return
    }
    setSettingsState({ kind: 'busy', message: 'שומרת...' })
    try {
      await onSave({
        reason: 'settings',
        baseEnvelope,
        baseStore,
        nextStore: applySettingsToStore(baseStore, currentDraft, catalogResult.catalog),
      })
      setSettingsState({ kind: 'success', message: 'ההגדרות נשמרו.' })
    } catch {
      setSettingsState({ kind: 'error', message: 'השמירה נכשלה. הנתונים הקיימים לא סומנו כנשמרו.' })
    }
  }

  const copyBackup = async () => {
    setBackupState({ kind: 'busy', message: 'מעתיקה...' })
    try {
      if (!navigator.clipboard?.writeText) {
        setBackupState({ kind: 'error', message: 'העתקה אינה זמינה בדפדפן הזה. אפשר לשמור קובץ.' })
        return
      }
      const artifact = createBackupArtifact(await latestBackupStore())
      await navigator.clipboard.writeText(artifact.content)
      setBackupState({ kind: 'success', message: 'הגיבוי הועתק.' })
    } catch {
      setBackupState({ kind: 'error', message: 'ההעתקה נכשלה. לא נרשם גיבוי מוצלח.' })
    }
  }

  const downloadBackup = async () => {
    setBackupState({ kind: 'busy', message: 'מכינה קובץ עדכני...' })
    try {
      const artifact = createBackupArtifact(await latestBackupStore())
      const blob = new Blob([artifact.content], { type: artifact.mimeType })
      const url = URL.createObjectURL(blob)
      const anchor = downloadRef.current
      if (anchor === null) {
        URL.revokeObjectURL(url)
        setBackupState({ kind: 'error', message: 'שמירת הקובץ אינה זמינה כרגע.' })
        return
      }
      anchor.href = url
      anchor.download = artifact.filename
      anchor.click()
      URL.revokeObjectURL(url)
      setBackupState({ kind: 'success', message: 'הורדת קובץ הגיבוי הופעלה.' })
    } catch {
      setBackupState({ kind: 'error', message: 'יצירת הגיבוי נכשלה. לא נשמר קובץ חלקי.' })
    }
  }

  const requestRestore = async () => {
    if (review.status !== 'ready') return
    if (baseEnvelope === null || !isSameVersionedStateEnvelope(storeQuery.data, baseEnvelope)) {
      setRestoreState({
        kind: 'error',
        message: 'הנתונים התעדכנו מאז בדיקת הגיבוי. השחזור לא הופעל; צריך לפתוח מחדש את המסך.',
      })
      setConfirmRestore(false)
      return
    }
    if (!onRestore) {
      setRestoreState({ kind: 'error', message: 'שחזור מאובטח עדיין אינו מחובר. שום נתון נוכחי לא השתנה.' })
      setConfirmRestore(false)
      return
    }
    setRestoreState({ kind: 'busy', message: 'יוצרת נקודת שחזור ומאמתת...' })
    try {
      await onRestore({
        currentStore: baseStore,
        incomingStore: review.incomingStore,
        sourceText: review.sourceText,
        currentOrderCount: review.currentOrderCount,
        incomingOrderCount: review.incomingOrderCount,
      })
      setRestoreState({ kind: 'success', message: 'השחזור הושלם ואומת.' })
      setConfirmRestore(false)
    } catch {
      setRestoreState({ kind: 'error', message: 'השחזור נכשל. הנתונים הנוכחיים לא השתנו.' })
      setConfirmRestore(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <header>
        <h1 className="text-3xl font-black text-primary sm:text-4xl">הגדרות וגיבוי</h1>
        <p className="mt-2 text-sm font-bold text-muted-foreground">הגדרות תפעוליות, מלאי וגיבוי מבוקר של כל הנתונים.</p>
      </header>

      <div className="mt-8 space-y-8">
        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <LocalIcon name="ph:chart-pie-slice-bold" className="text-xl text-accent" />
            <h2 className="text-xl font-black text-primary">תקרת עומס</h2>
          </div>
          <label className="mt-5 block max-w-md text-xs font-black text-muted-foreground">
            מקסימום ארוחות זוגיות לשישי (0 = בלי הגבלה)
            <input
              aria-label="מקסימום ארוחות זוגיות לשישי"
              inputMode="numeric"
              value={currentDraft.maxMeals}
              onChange={(event) => setDraft({ ...currentDraft, maxMeals: event.currentTarget.value })}
              className="mt-2 min-h-11 w-full rounded-2xl border border-border bg-secondary/40 px-5 text-lg font-black text-primary outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <p className="mt-3 text-xs font-bold leading-6 text-muted-foreground">כשקובעים תקרה, מסך היום מציג כמה מקום נשאר ומתריע כשתאריך מתמלא.</p>
        </section>

        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-primary">מחירון ותפריט</h2>
          <p className="mt-2 text-xs font-bold text-muted-foreground">העריכה המלאה מופרדת כדי למנוע שינוי מחיר בטעות.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to={APP_ROUTES.menuSettings} className={actionClassName}>
              <LocalIcon name="ph:list-checks-bold" />
              <span>עריכת תפריט ומחירים</span>
            </Link>
            <Link to={APP_ROUTES.recipeSettings} className={actionClassName}>
              <LocalIcon name="ph:cooking-pot-bold" />
              <span>מתכונים ומצרכים</span>
            </Link>
            <Link to={APP_ROUTES.productLibrary} className={actionClassName}>
              <LocalIcon name="ph:package-bold" />
              <span>ספריית מוצרים ורכש</span>
            </Link>
            <Link to={APP_ROUTES.costReport} className={actionClassName}>
              <LocalIcon name="ph:calculator-bold" />
              <span>דוח עלויות ורווחיות</span>
            </Link>
          </div>
        </section>

        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-primary">פרטי חשבונית (מע"מ)</h2>
          <p className="mt-2 text-xs font-bold text-muted-foreground">מוצג על כל חשבונית שנשלחת ללקוחות. באחריותך לוודא שהפרטים נכונים ולהגיש דיווח מע"מ בעצמך.</p>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-black text-muted-foreground">
              שם העסק הרשמי
              <input
                aria-label="שם העסק הרשמי"
                value={currentDraft.businessName}
                onChange={(event) => setDraft({ ...currentDraft, businessName: event.currentTarget.value })}
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-sm font-bold outline-none"
              />
            </label>
            <label className="text-xs font-black text-muted-foreground">
              מספר TRN (אם רשומים למע"מ)
              <input
                aria-label="מספר TRN"
                dir="ltr"
                value={currentDraft.trn}
                onChange={(event) => setDraft({ ...currentDraft, trn: event.currentTarget.value })}
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-left text-sm font-bold outline-none"
              />
            </label>
            <label className="text-xs font-black text-muted-foreground md:col-span-2">
              כתובת לחשבונית
              <input
                aria-label="כתובת לחשבונית"
                value={currentDraft.businessAddress}
                onChange={(event) => setDraft({ ...currentDraft, businessAddress: event.currentTarget.value })}
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-sm font-bold outline-none"
              />
            </label>
            <label className="text-xs font-black text-muted-foreground">
              מטבע לחשבונית
              <select
                aria-label="מטבע לחשבונית"
                value={currentDraft.invoiceCurrency}
                onChange={(event) => setDraft({ ...currentDraft, invoiceCurrency: event.currentTarget.value === 'USD' ? 'USD' : 'AED' })}
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-sm font-bold outline-none"
              >
                <option value="AED">AED (דירהם)</option>
                <option value="USD">USD (דולר)</option>
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-primary">תשלומים וקישורים</h2>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-black text-muted-foreground">
              לינק תשלום (ביט / PayBox / Stripe...)
              <input
                aria-label="לינק תשלום"
                dir="ltr"
                value={currentDraft.paymentLink}
                onChange={(event) => setDraft({ ...currentDraft, paymentLink: event.currentTarget.value })}
                placeholder="https://..."
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-left text-sm font-bold outline-none"
              />
            </label>
            <label className="text-xs font-black text-muted-foreground">
              קישור לטופס ההזמנה ללקוחות
              <input
                aria-label="קישור לטופס ההזמנה ללקוחות"
                dir="ltr"
                value={currentDraft.customerOrderFormUrl}
                onChange={(event) => setDraft({ ...currentDraft, customerOrderFormUrl: event.currentTarget.value })}
                placeholder="https://..."
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-left text-sm font-bold outline-none"
              />
            </label>
          </div>
        </section>

        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-primary">פרטי תשלום וביקורות</h2>
          <p className="mt-2 text-xs font-bold text-muted-foreground">
            נכנס להודעות המוכנות שאת שולחת מהוואטסאפ שלך. שום הודעה לא נשלחת ללקוח לבד.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-4">
            <label className="text-xs font-black text-muted-foreground">
              איך משלמים לך (נכנס להודעת בקשת התשלום)
              <textarea
                aria-label="איך משלמים לך"
                value={currentDraft.paymentRequestDetails}
                onChange={(event) =>
                  setDraft({ ...currentDraft, paymentRequestDetails: event.currentTarget.value })
                }
                placeholder="לדוגמה: ביט למספר 050-1234567, או העברה לחשבון..."
                className="mt-2 min-h-20 w-full resize-y rounded-xl border border-border px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <label className="text-xs font-black text-muted-foreground">
              קישור לביקורות בגוגל (בלי זה כפתור בקשת הביקורת לא מופיע)
              <input
                aria-label="קישור לביקורות בגוגל"
                dir="ltr"
                value={currentDraft.googleReviewUrl}
                onChange={(event) =>
                  setDraft({ ...currentDraft, googleReviewUrl: event.currentTarget.value })
                }
                placeholder="https://..."
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-left text-sm font-bold outline-none"
              />
            </label>
          </div>
        </section>

        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-primary">משלוחים</h2>
          <p className="mt-2 text-xs font-bold text-muted-foreground">הגבלות מינימום לפי אזור.</p>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-xs font-black text-muted-foreground">
              מינימום הזמנה לאבו דאבי (USD)
              <input
                aria-label="מינימום הזמנה לאבו דאבי"
                dir="ltr"
                inputMode="decimal"
                value={currentDraft.minOrderAbuDhabi}
                onChange={(event) => setDraft({ ...currentDraft, minOrderAbuDhabi: event.currentTarget.value })}
                placeholder="120.00"
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-left text-sm font-bold outline-none"
              />
            </label>
          </div>
        </section>

        <StaffLoginSection />

        <StateHistorySection />

        <MeyAuditSection />

        <DeliveryWindowsSection />

        <HolidayMenusSection dishCostsByName={dishCostsByName} />

        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-primary">מצב האתר</h2>
          <p className="mt-2 text-xs font-bold text-muted-foreground">מה שהלקוחות רואים באתר ההזמנות ברגע זה.</p>
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-secondary/30 p-5">
              <div>
                <p className="text-sm font-black text-primary">{describeOrderingState(currentDraft)}</p>
                <p className="mt-1 text-xs font-bold text-muted-foreground">
                  סגירה היא לשבת הקרובה בלבד: לקוחות עדיין רואים את התפריט, וההזמנות נפתחות שוב לבד ביום ראשון.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={currentDraft.orderingOpen}
                aria-label="האתר פתוח להזמנות"
                onClick={() => setDraft(toggleOrderingOpen(currentDraft))}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-black ${
                  currentDraft.orderingOpen
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-destructive'
                }`}
              >
                <LocalIcon name={currentDraft.orderingOpen ? 'ph:check-circle-bold' : 'ph:warning-circle-bold'} className="text-lg" />
                <span>{currentDraft.orderingOpen ? 'פתוח' : 'סגור'}</span>
              </button>
            </div>
            <label className="block text-xs font-black text-muted-foreground">
              הודעה לראש האתר (ריק = בלי הודעה)
              <input
                aria-label="הודעה לראש האתר"
                value={currentDraft.siteBanner}
                onChange={(event) => setDraft({ ...currentDraft, siteBanner: event.currentTarget.value })}
                placeholder="לדוגמה: חוזרים לקבל הזמנות ביום ראשון"
                className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-sm font-bold outline-none"
              />
            </label>
          </div>

          <h3 className="mt-8 text-xl font-black text-primary">אזל מהמלאי</h3>
          <p className="mt-2 text-xs font-bold text-muted-foreground">לוחצים על מנה שנגמרה; אקסטרות וצהריים אינן חלק ממלאי זה.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {stockItems.map((item) => {
              const selected = currentDraft.outOfStock.includes(item.name)
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setDraft({
                      ...currentDraft,
                      outOfStock: selected
                        ? currentDraft.outOfStock.filter((name) => name !== item.name)
                        : [...currentDraft.outOfStock, item.name],
                    })
                  }
                  className={`rounded-full border px-4 py-2 text-xs font-black ${
                    selected
                      ? 'border-rose-200 bg-rose-50 text-destructive line-through'
                      : 'border-border bg-card text-primary'
                  }`}
                >
                  {item.name}
                </button>
              )
            })}
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button type="button" onClick={() => void saveSettings()} disabled={settingsState.kind === 'busy'} className="min-h-11 rounded-xl bg-primary px-6 text-sm font-black text-primary-foreground disabled:opacity-50">שמירת ההגדרות</button>
            <StatusMessage state={settingsState} />
          </div>
        </section>

        <section className="rounded-[2.5rem] border-2 border-rose-200 bg-card p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <LocalIcon name="ph:cloud-arrow-up-bold" className="text-xl text-destructive" />
            <div>
              <h2 className="text-xl font-black text-primary">גיבוי ושחזור</h2>
              <p className="mt-1 text-xs font-black text-destructive">אזור מוגן — שחזור לעולם אינו מתבצע בלי אימות ואישור.</p>
            </div>
          </div>
          <label className="mt-5 block max-w-md text-xs font-black text-muted-foreground">
            אימייל לגיבוי שבועי (ריק = לא שולחים)
            <input
              aria-label="אימייל לגיבוי שבועי"
              dir="ltr"
              type="email"
              value={currentDraft.weeklyBackupEmail}
              onChange={(event) => setDraft({ ...currentDraft, weeklyBackupEmail: event.currentTarget.value })}
              placeholder="backup@example.com"
              className="mt-2 min-h-11 w-full rounded-xl border border-border px-4 text-left text-sm font-bold outline-none"
            />
          </label>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => void downloadBackup()} disabled={backupState.kind === 'busy'} className={`${actionClassName} bg-primary text-primary-foreground`}>
              <LocalIcon name="ph:cloud-arrow-up-bold" />
              <span>שמירת קובץ גיבוי</span>
            </button>
            <button type="button" onClick={() => void copyBackup()} disabled={backupState.kind === 'busy'} className={actionClassName}>
              <LocalIcon name="ph:list-checks-bold" />
              <span>העתקת הגיבוי כטקסט</span>
            </button>
            <a ref={downloadRef} className="hidden" aria-hidden="true" />
          </div>
          <div className="mt-3"><StatusMessage state={backupState} /></div>
          <label className="mt-6 block text-xs font-black text-muted-foreground">
            שחזור מגיבוי — לבחור קובץ או להדביק טקסט
            <input
              aria-label="בחירת קובץ גיבוי"
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (!file) return
                void file.text().then((value) => {
                  setBackupText(value)
                  setRestoreState({ kind: 'success', message: 'הקובץ נטען — עכשיו אפשר לבדוק את השחזור.' })
                }).catch(() => setRestoreState({ kind: 'error', message: 'לא הצלחנו לקרוא את הקובץ. שום נתון לא השתנה.' }))
              }}
              className="mt-2 block w-full text-sm font-bold"
            />
            <textarea
              aria-label="טקסט גיבוי"
              dir="ltr"
              value={backupText}
              onChange={(event) => { setBackupText(event.currentTarget.value); setRestoreState(IDLE) }}
              placeholder={'{"orders":[...]}' }
              className="mt-3 min-h-36 w-full resize-y rounded-2xl border border-border p-4 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <div className={`mt-3 rounded-2xl border p-4 text-xs font-black ${reviewClassName(review)}`} role="status">
            {review.message}
            {'issues' in review && review.issues.length > 0 && (
              <ul className="mt-2 list-inside list-disc"><li>{review.issues[0]}</li></ul>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" disabled={review.status !== 'ready' || restoreState.kind === 'busy'} onClick={() => setConfirmRestore(true)} className="min-h-11 rounded-xl bg-destructive px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">שחזור (מחליף את כל הנתונים הנוכחיים)</button>
            <StatusMessage state={restoreState} />
          </div>
        </section>

        {developerTools && (
          <section className="rounded-[2.5rem] border border-border bg-muted/40 p-6 sm:p-8">
            <div className="flex items-center gap-3"><h2 className="text-xl font-black text-primary">נתוני דוגמה</h2><span className="rounded-full bg-secondary px-3 py-1 text-xs font-black text-primary">פיתוח בלבד</span></div>
            <p className="mt-3 text-sm font-bold text-muted-foreground">נתוני דוגמה אינם זמינים בסביבת הייצור.</p>
            <div className="mt-4 flex gap-3"><button type="button" disabled className={actionClassName}>טעינת נתוני הדוגמה</button><button type="button" disabled className={actionClassName}>מחיקת נתוני הדוגמה</button></div>
          </section>
        )}

        <section className="rounded-[2.5rem] border border-border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-primary">מצב נוכחי</h2>
          <p className="mt-3 text-sm font-bold text-primary">{baseStore.orders.length} הזמנות שמורות · גיבוי אחרון: {formatLastBackup(baseStore.lastBackup)} · מסונכרן</p>
          <p className="mt-2 text-xs font-bold text-muted-foreground">הנתונים מסונכרנים למערכת. גיבוי ידני מאפשר שחזור מבוקר.</p>
        </section>
      </div>

      {confirmRestore && review.status === 'ready' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <div className="w-full max-w-lg rounded-3xl bg-card p-7 shadow-2xl">
            <h2 id="restore-title" className="text-xl font-black text-primary">לשחזר {review.incomingOrderCount} הזמנות?</h2>
            <p className="mt-3 text-sm font-bold leading-6 text-muted-foreground">הפעולה תחליף את {review.currentOrderCount} ההזמנות הנוכחיות רק לאחר יצירת נקודת שחזור.</p>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setConfirmRestore(false)} className={actionClassName}>ביטול</button><button type="button" onClick={() => void requestRestore()} className="min-h-11 rounded-xl bg-destructive px-5 text-sm font-black text-white">שחזור הנתונים</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SettingsBackupScreen
