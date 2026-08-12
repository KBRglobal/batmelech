import { Link } from 'react-router'
import type { To } from 'react-router'
import { LocalIcon, type LocalIconName } from './local-icon'

export type ScreenStateKind = 'loading' | 'error' | 'empty'

type ScreenStateButtonAction = {
  label: string
  icon?: LocalIconName
  onClick: () => void
  to?: never
}

type ScreenStateLinkAction = {
  label: string
  icon?: LocalIconName
  to: To
  onClick?: never
}

export type ScreenStateAction = ScreenStateButtonAction | ScreenStateLinkAction

export type ScreenStateProps = {
  kind: ScreenStateKind
  title?: string
  description?: string
  retry?: () => void
  retryLabel?: string
  action?: ScreenStateAction
  className?: string
}

const STATE_PRESENTATION = {
  loading: {
    icon: 'ph:arrow-counter-clockwise-bold',
    title: 'טוענת נתונים',
    description: 'המידע יופיע כאן מיד כשהטעינה תסתיים.',
    iconClassName: 'bg-secondary text-primary motion-safe:animate-spin',
  },
  error: {
    icon: 'ph:warning-circle-bold',
    title: 'לא הצלחנו לטעון את המסך',
    description: 'אפשר לנסות שוב בעוד רגע.',
    iconClassName: 'bg-red-50 text-destructive',
  },
  empty: {
    icon: 'ph:package-bold',
    title: 'אין עדיין מה להציג',
    description: 'כשהמידע יהיה זמין הוא יופיע כאן.',
    iconClassName: 'bg-secondary text-primary',
  },
} as const satisfies Record<
  ScreenStateKind,
  {
    icon: string
    title: string
    description: string
    iconClassName: string
  }
>

const primaryActionClassName =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function StateAction({ action }: { action: ScreenStateAction }) {
  const content = (
    <>
      <LocalIcon name={action.icon ?? 'ph:arrow-left-bold'} className="text-lg" />
      <span>{action.label}</span>
    </>
  )

  if (action.to !== undefined) {
    return (
      <Link to={action.to} className={primaryActionClassName}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={action.onClick} className={primaryActionClassName}>
      {content}
    </button>
  )
}

export function ScreenState({
  kind,
  title,
  description,
  retry,
  retryLabel = 'ניסיון נוסף',
  action,
  className,
}: ScreenStateProps) {
  const presentation = STATE_PRESENTATION[kind]
  const resolvedClassName = [
    'flex min-h-[18rem] w-full items-center justify-center px-6 py-12 text-center',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      className={resolvedClassName}
      data-state={kind}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-busy={kind === 'loading' || undefined}
    >
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-8 shadow-[0_24px_70px_rgba(99,33,40,0.08)] sm:p-10">
        <div
          className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${presentation.iconClassName}`}
        >
          <LocalIcon name={presentation.icon} className="text-3xl" />
        </div>

        <h1 className="text-xl font-black text-primary sm:text-2xl">
          {title ?? presentation.title}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
          {description ?? presentation.description}
        </p>

        {(retry || action) && (
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {retry && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <LocalIcon name="ph:arrow-counter-clockwise-bold" className="text-lg" />
                <span>{retryLabel}</span>
              </button>
            )}
            {action && <StateAction action={action} />}
          </div>
        )}
      </div>
    </section>
  )
}
