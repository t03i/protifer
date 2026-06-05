import { NightingaleBase } from './NightingaleBase'

interface Props<TData> {
  tag: 'nightingale-track' | 'nightingale-linegraph-track'
  id: string
  length: number
  data: TData[]
  label: string
  height?: number
  layoutType?: 'non-overlapping' | 'default'
}

export function NightingaleLabeledTrack<TData>({
  tag,
  id,
  length,
  data,
  label,
  height = 20,
  layoutType,
}: Props<TData>) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 truncate text-right text-xs text-muted-foreground">
        {label}
      </span>
      <NightingaleBase
        tag={tag}
        data={data}
        id={id}
        length={length}
        height={height}
        layout-type={layoutType}
        class="flex-1"
      />
    </div>
  )
}
