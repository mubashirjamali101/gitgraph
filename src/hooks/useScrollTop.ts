/**
 * Scroll position as a subscription to the DOM.
 *
 * The previous implementation mirrored scrollTop into React state inside a
 * requestAnimationFrame callback. When frames were throttled — an occluded
 * window — or when scrollTop was set programmatically (keyboard navigation did
 * exactly that), the rendered window stayed behind the real position and the
 * list went blank until the next real scroll.
 *
 * Reading the value straight from the element removes the intermediate copy
 * that could go stale.
 */
import { useCallback, useSyncExternalStore } from 'react'

export function useScrollTop(element: HTMLElement | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!element) return () => {}
      element.addEventListener('scroll', onChange, { passive: true })
      // An occluded window may stop delivering scroll events; re-read on the
      // way back so the rendered window cannot be left behind the viewport.
      document.addEventListener('visibilitychange', onChange)
      window.addEventListener('focus', onChange)
      return () => {
        element.removeEventListener('scroll', onChange)
        document.removeEventListener('visibilitychange', onChange)
        window.removeEventListener('focus', onChange)
      }
    },
    [element],
  )

  const getSnapshot = useCallback(() => element?.scrollTop ?? 0, [element])

  return useSyncExternalStore(subscribe, getSnapshot, () => 0)
}

/** Element height, kept current through a ResizeObserver. */
export function useElementHeight(element: HTMLElement | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!element) return () => {}
      const observer = new ResizeObserver(onChange)
      observer.observe(element)
      return () => observer.disconnect()
    },
    [element],
  )

  const getSnapshot = useCallback(() => element?.clientHeight ?? 0, [element])

  return useSyncExternalStore(subscribe, getSnapshot, () => 0)
}
