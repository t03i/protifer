import componentUrl from 'pdbe-molstar/build/pdbe-molstar-component.js?url'
import cssUrl from 'pdbe-molstar/build/pdbe-molstar.css?url'
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

// Module-level flags survive React re-renders and component remounts.
let cssInjected = false
let scriptInjected = false
let scriptLoaded = false
// Callbacks waiting for the script to finish loading.
const onLoadCallbacks: Array<() => void> = []

function injectAssets(onLoaded: () => void) {
  if (scriptLoaded) {
    onLoaded()
    return
  }

  onLoadCallbacks.push(onLoaded)

  if (scriptInjected) return // already in flight, just queued the callback
  scriptInjected = true

  if (!cssInjected) {
    cssInjected = true
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = cssUrl
    document.head.appendChild(link)
  }

  const script = document.createElement('script')
  script.src = componentUrl
  script.onload = () => {
    scriptLoaded = true
    for (const cb of onLoadCallbacks) cb()
    onLoadCallbacks.length = 0
  }
  document.head.appendChild(script)
}

export function useLazyPdbeMolstarAssets(
  containerRef: RefObject<HTMLElement | null>,
): boolean {
  const [assetsLoaded, setAssetsLoaded] = useState(scriptLoaded)

  useEffect(() => {
    if (scriptLoaded) {
      setAssetsLoaded(true)
      return
    }

    const el = containerRef.current
    if (!el) return

    let triggered = false

    const observer = new IntersectionObserver(
      (entries) => {
        if (triggered) return
        if (entries.some((e) => e.isIntersecting)) {
          triggered = true
          observer.disconnect()
          injectAssets(() => setAssetsLoaded(true))
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef])

  return assetsLoaded
}
