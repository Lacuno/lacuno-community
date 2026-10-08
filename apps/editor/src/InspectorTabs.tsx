import { type ReactNode, useId } from 'react'

export type InspectorTab = 'style' | 'content' | 'advanced'

const tabs = [
  ['style', 'Style'],
  ['content', 'Content'],
  ['advanced', 'Advanced'],
] as const

/** Keep every panel mounted: changing tabs must not discard an unsaved field or class draft. */
export function InspectorTabs({
  active,
  change,
  panels,
}: {
  active: InspectorTab
  change: (tab: InspectorTab) => void
  panels: Record<InspectorTab, ReactNode>
}) {
  const id = useId()
  return (
    <>
      <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
        {tabs.map(([tab, label], index) => (
          <button
            key={tab}
            type="button"
            id={`${id}-${tab}`}
            role="tab"
            aria-controls={`${id}-${tab}-panel`}
            aria-selected={active === tab}
            tabIndex={active === tab ? 0 : -1}
            onClick={() => change(tab)}
            onKeyDown={(event) => {
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : event.key === 'ArrowRight'
                      ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + tabs.length - 1) % tabs.length
                        : undefined
              if (next === undefined) return
              event.preventDefault()
              change(tabs[next]![0])
              document.getElementById(`${id}-${tabs[next]![0]}`)?.focus()
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tabs.map(([tab]) => (
        <div
          key={tab}
          id={`${id}-${tab}-panel`}
          className={`inspector-tab-panel inspector-tab-${tab}`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab}`}
          hidden={active !== tab}
        >
          {panels[tab]}
        </div>
      ))}
    </>
  )
}
