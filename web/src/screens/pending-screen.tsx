import { APP_ROUTES } from '../app/routes.ts'
import { ScreenState } from '../components/screen-state.tsx'

type PendingScreenProps = {
  title: string
  description?: string
  notFound?: boolean
}

const DEFAULT_PENDING_DESCRIPTION =
  'המסך מחובר כרגע לתצוגת פיתוח בלבד. לא מתבצעת כאן שמירה או פעולה על נתוני העסק.'

export function PendingScreen({
  title,
  description = DEFAULT_PENDING_DESCRIPTION,
  notFound = false,
}: PendingScreenProps) {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-8 sm:px-8 sm:py-10"
      data-route-status={notFound ? 'not-found' : 'pending'}
    >
      <ScreenState
        kind={notFound ? 'error' : 'empty'}
        title={title}
        description={description}
        action={
          notFound
            ? {
                label: 'חזרה למסך היום',
                to: APP_ROUTES.today,
                icon: 'ph:arrow-left-bold',
              }
            : undefined
        }
        className="min-h-0 px-0"
      />
    </div>
  )
}

export default PendingScreen
