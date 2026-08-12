// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_ROUTES } from '../app/routes.ts'
import { useStore } from '../data/use-store.ts'
import type { RestoreRequestHandler } from '../domain/settings-backup.ts'
import type { StoreSaveHandler } from '../domain/settings-catalog.ts'
import type { LegacyStore } from '../domain/store.ts'
import { SettingsBackupScreen } from './settings-backup-screen.tsx'

vi.mock('../data/use-store.ts', () => ({ useStore: vi.fn() }))
const mockedUseStore = vi.mocked(useStore)
const HASH = 'c'.repeat(64)

function queryResult(options: {
  readonly pending?: boolean
  readonly error?: boolean
  readonly store?: LegacyStore | null
  readonly refetch?: ReturnType<typeof vi.fn>
  readonly revision?: number
} = {}): ReturnType<typeof useStore> {
  const revision = options.revision ?? 1
  const data = options.pending || options.error
    ? undefined
    : { revision, ts: revision, hash: HASH, data: options.store ?? { orders: [] } }
  return {
    isPending: options.pending === true,
    isError: options.error === true,
    data,
    refetch: options.refetch ?? vi.fn().mockResolvedValue({ data }),
  } as unknown as ReturnType<typeof useStore>
}

function renderSettings(props: {
  readonly onSave?: StoreSaveHandler
  readonly onRestore?: RestoreRequestHandler
} = {}) {
  return render(
    <MemoryRouter initialEntries={[APP_ROUTES.settings]}>
      <SettingsBackupScreen {...props} />
    </MemoryRouter>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  mockedUseStore.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('SettingsBackupScreen', () => {
  it('renders loading and retryable error states without a write callback', async () => {
    mockedUseStore.mockReturnValue(queryResult({ pending: true }))
    const pending = renderSettings()
    expect(screen.getByText('טוענת את ההגדרות')).toBeTruthy()
    pending.unmount()

    const refetch = vi.fn()
    mockedUseStore.mockReturnValue(queryResult({ error: true, refetch }))
    renderSettings()
    await userEvent.setup().click(screen.getByRole('button', { name: 'ניסיון נוסף' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows all seven safe sections, real status, and no destructive whole-store reset', () => {
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'real-1' }, { id: 'real-2' }], lastBackup: Date.UTC(2026, 7, 11) },
    }))
    renderSettings()

    for (const title of [
      'תקרת עומס',
      'מחירון ותפריט',
      'תשלומים וקישורים',
      'אזל מהמלאי',
      'גיבוי ושחזור',
      'נתוני דוגמה',
      'מצב נוכחי',
    ]) expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByText(/2 הזמנות שמורות/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'עריכת תפריט ומחירים' }).getAttribute('href')).toBe(APP_ROUTES.menuSettings)
    expect(screen.getByRole('link', { name: 'מתכונים ומצרכים' }).getAttribute('href')).toBe(APP_ROUTES.recipeSettings)
    expect(screen.queryByRole('button', { name: /איפוס כל הנתונים/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'מחיקת נתוני הדוגמה' }).hasAttribute('disabled')).toBe(true)
  })

  it('copies an exact complete JSON export without mutating the store', async () => {
    const store = {
      orders: [{ id: 'actual', unknownOrderField: { exact: true } }],
      unknownRootField: ['preserve', 7],
    } as LegacyStore
    const snapshot = structuredClone(store)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    renderSettings()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    fireEvent.click(screen.getByRole('button', { name: 'העתקת הגיבוי כטקסט' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(store, null, 2)))
    expect(store).toEqual(snapshot)
    expect(await screen.findByText('הגיבוי הועתק.')).toBeTruthy()
  })

  it('refetches the latest versioned state before backup and never exports a stale opened snapshot', async () => {
    const openedStore = { orders: [{ id: 'opened' }], marker: 'old' } as LegacyStore
    const latestStore = {
      orders: [{ id: 'opened' }, { id: 'new-from-another-device' }],
      marker: 'latest',
    } as LegacyStore
    const refetch = vi.fn().mockResolvedValue({
      data: { revision: 2, ts: 2, hash: 'd'.repeat(64), data: latestStore },
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mockedUseStore.mockReturnValue(queryResult({ store: openedStore, refetch }))
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'העתקת הגיבוי כטקסט' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(latestStore, null, 2)))
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalledWith(JSON.stringify(openedStore, null, 2))
  })

  it('fails closed without clipboard output when the latest versioned state cannot be verified', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mockedUseStore.mockReturnValue(queryResult({
      store: { orders: [{ id: 'stale' }] },
      refetch: vi.fn().mockResolvedValue({ data: undefined }),
    }))
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'העתקת הגיבוי כטקסט' }))

    expect((await screen.findByRole('alert')).textContent).toContain('ההעתקה נכשלה')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects stale cached backup data when a background refetch reports failure', async () => {
    const staleStore = { orders: [{ id: 'stale-cached' }] } as LegacyStore
    const staleEnvelope = { revision: 1, ts: 1, hash: HASH, data: staleStore }
    const refetch = vi.fn().mockResolvedValue({
      data: staleEnvelope,
      isError: true,
      isRefetchError: true,
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mockedUseStore.mockReturnValue(queryResult({ store: staleStore, refetch }))
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'העתקת הגיבוי כטקסט' }))

    expect((await screen.findByRole('alert')).textContent).toContain('ההעתקה נכשלה')
    expect(refetch).toHaveBeenCalledWith({ throwOnError: true })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('validates settings and sends one protected whole-store request only on save', async () => {
    const store = {
      orders: [{ id: 'keep' }],
      settings: { privateSetting: 'preserve' },
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store }))
    const user = userEvent.setup()
    renderSettings({ onSave })

    await user.clear(screen.getByLabelText('מקסימום ארוחות זוגיות לשישי'))
    await user.type(screen.getByLabelText('מקסימום ארוחות זוגיות לשישי'), '20')
    await user.type(screen.getByLabelText('לינק תשלום'), 'javascript:bad')
    await user.click(screen.getByRole('button', { name: 'שמירת ההגדרות' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('HTTP או HTTPS')

    await user.clear(screen.getByLabelText('לינק תשלום'))
    await user.type(screen.getByLabelText('לינק תשלום'), 'https://pay.example')
    await user.click(screen.getByRole('button', { name: 'שמירת ההגדרות' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const request = onSave.mock.calls[0]![0]
    expect(request.reason).toBe('settings')
    expect(request.baseEnvelope).toMatchObject({ revision: 1, hash: HASH, data: store })
    expect(request.baseStore).toBe(store)
    expect(request.nextStore.orders).toEqual([{ id: 'keep' }])
    expect(request.nextStore.settings).toMatchObject({
      maxMeals: 20,
      payLink: 'https://pay.example',
      privateSetting: 'preserve',
    })
  })

  it('rejects invalid import text and never invokes restore before review and confirmation', async () => {
    const onRestore = vi.fn<RestoreRequestHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'current' }] } }))
    const user = userEvent.setup()
    renderSettings({ onRestore })
    const textarea = screen.getByLabelText('טקסט גיבוי')
    const restoreButton = screen.getByRole('button', { name: 'שחזור (מחליף את כל הנתונים הנוכחיים)' })

    fireEvent.change(textarea, { target: { value: '{bad' } })
    expect(screen.getByText('הטקסט לא תקין — זה לא קובץ גיבוי.')).toBeTruthy()
    expect(restoreButton.hasAttribute('disabled')).toBe(true)
    expect(onRestore).not.toHaveBeenCalled()

    const sourceText = JSON.stringify({ orders: [{ id: 'incoming-a' }, { id: 'incoming-b' }], preserved: true })
    fireEvent.change(textarea, { target: { value: sourceText } })
    expect(restoreButton.hasAttribute('disabled')).toBe(false)
    await user.click(restoreButton)
    expect(onRestore).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('לשחזר 2 הזמנות')
    await user.click(within(dialog).getByRole('button', { name: 'שחזור הנתונים' }))

    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore.mock.calls[0]![0]).toMatchObject({
      sourceText,
      currentOrderCount: 1,
      incomingOrderCount: 2,
      incomingStore: { orders: [{ id: 'incoming-a' }, { id: 'incoming-b' }], preserved: true },
    })
  })

  it('retains the reviewed import and reports no change when restore conflicts', async () => {
    const onRestore = vi.fn<RestoreRequestHandler>().mockRejectedValue(new Error('version conflict'))
    mockedUseStore.mockReturnValue(queryResult({ store: { orders: [{ id: 'current' }] } }))
    const user = userEvent.setup()
    renderSettings({ onRestore })
    const sourceText = JSON.stringify({ orders: [{ id: 'incoming' }] })
    const textarea = screen.getByLabelText('טקסט גיבוי') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: sourceText } })

    await user.click(screen.getByRole('button', { name: 'שחזור (מחליף את כל הנתונים הנוכחיים)' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'שחזור הנתונים' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('הנתונים הנוכחיים לא השתנו'))
    expect(textarea.value).toBe(sourceText)
    expect(screen.getByText(/1 הזמנות שמורות/)).toBeTruthy()
  })

  it('keeps settings and backup review on the initialization envelope and invokes no stale write', async () => {
    const initialStore = {
      orders: [{ id: 'current' }],
      settings: { maxMeals: 5 },
      marker: 'initial',
    } as LegacyStore
    const refreshedStore = {
      orders: [{ id: 'current' }, { id: 'remote' }],
      settings: { maxMeals: 9 },
      marker: 'refreshed',
    } as LegacyStore
    const onSave = vi.fn<StoreSaveHandler>().mockResolvedValue(undefined)
    const onRestore = vi.fn<RestoreRequestHandler>().mockResolvedValue(undefined)
    mockedUseStore.mockReturnValue(queryResult({ store: initialStore, revision: 20 }))
    const user = userEvent.setup()
    const view = renderSettings({ onSave, onRestore })

    await user.clear(screen.getByLabelText('מקסימום ארוחות זוגיות לשישי'))
    await user.type(screen.getByLabelText('מקסימום ארוחות זוגיות לשישי'), '7')
    fireEvent.change(screen.getByLabelText('טקסט גיבוי'), {
      target: { value: '{"orders":[{"id":"incoming"}]}' },
    })
    mockedUseStore.mockReturnValue(queryResult({ store: refreshedStore, revision: 21 }))
    view.rerender(
      <MemoryRouter initialEntries={[APP_ROUTES.settings]}>
        <SettingsBackupScreen onSave={onSave} onRestore={onRestore} />
      </MemoryRouter>,
    )

    expect((screen.getByLabelText('מקסימום ארוחות זוגיות לשישי') as HTMLInputElement).value).toBe('7')
    expect(screen.getByText(/1 הזמנות שמורות/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'שמירת ההגדרות' }))
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'שחזור (מחליף את כל הנתונים הנוכחיים)' }))
    expect(screen.getByRole('dialog').textContent).toContain('תחליף את 1 ההזמנות הנוכחיות')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'שחזור הנתונים' }))
    expect(onRestore).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('הנתונים התעדכנו'))).toBe(true)
  })

  it('does not claim settings or restore persistence when callbacks are absent', async () => {
    mockedUseStore.mockReturnValue(queryResult())
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByRole('button', { name: 'שמירת ההגדרות' }))
    expect(screen.getByRole('alert').textContent).toContain('לא בוצע שינוי בשרת')

    fireEvent.change(screen.getByLabelText('טקסט גיבוי'), { target: { value: '{"orders":[]}' } })
    await user.click(screen.getByRole('button', { name: 'שחזור (מחליף את כל הנתונים הנוכחיים)' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'שחזור הנתונים' }))
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('שום נתון נוכחי לא השתנה'))).toBe(true)
  })
})
