import React, { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface Props<TData> {
  tag: string
  data?: TData
  children?: ReactNode
  'margin-left'?: number
  'margin-right'?: number
  [key: string]: unknown
}

export function NightingaleBase<TData>({
  tag: Tag,
  data,
  children,
  'margin-left': marginLeft = 0,
  'margin-right': marginRight = 0,
  ...attrs
}: Props<TData>) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (ref.current && data !== undefined) {
      // @ts-expect-error — web component imperative property
      ref.current.data = data
    }
  }, [data])

  const El = Tag as unknown as React.ElementType<{
    ref: React.RefObject<HTMLElement | null>
    children?: ReactNode
    [key: string]: unknown
  }>
  return (
    <El
      ref={ref}
      margin-left={marginLeft}
      margin-right={marginRight}
      {...attrs}
    >
      {children}
    </El>
  )
}
