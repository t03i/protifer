import { Button } from '#/components/ui/button'
import { exampleSequences } from '#/content/example-sequences'

interface Props {
  onSelect: (value: string) => void
  label?: string
  className?: string
}

export function ExampleSequenceChips({
  onSelect,
  label = 'Try an example',
  className,
}: Props) {
  return (
    <div
      className={className}
      role="group"
      aria-label="Prefill an example sequence"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{label}:</span>
        {exampleSequences.map((ex) => (
          <Button
            key={ex.format}
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onSelect(ex.value)}
            aria-label={`Prefill ${ex.label} example`}
            title={ex.description}
          >
            {ex.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
