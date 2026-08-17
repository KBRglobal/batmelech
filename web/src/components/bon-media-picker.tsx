import { BON_MEDIA_OPTIONS, type BonMedia } from '../services/bon-print.ts'

interface BonMediaPickerProps {
  readonly value: BonMedia
  readonly onChange: (media: BonMedia) => void
}

export function BonMediaPicker({ value, onChange }: BonMediaPickerProps) {
  return (
    <fieldset className="bm-no-print mx-auto mb-6 w-full max-w-2xl rounded-3xl border border-border bg-card p-4">
      <legend className="px-2 text-xs font-black text-muted-foreground">על מה מדפיסים?</legend>
      <div className="flex flex-wrap gap-2">
        {BON_MEDIA_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-black ${value === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-primary hover:bg-secondary'}`}
          >
            <input
              type="radio"
              name="bm-bon-media"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs font-bold text-muted-foreground">
        {BON_MEDIA_OPTIONS.find((option) => option.value === value)?.hint}
      </p>
    </fieldset>
  )
}

export default BonMediaPicker
