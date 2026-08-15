'use client'

import { useEffect, useLayoutEffect, useState } from 'react'

const TOUR_KEY = 'peak-tour-seen'

type TourStep = {
  id: string
  title: string
  body: string
  target?: string
  view?: string
}

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Peak Business',
    body: 'Your operations command center — sales, stock, margins, costs and marketplace imports in one calm workspace. This short tour takes about a minute.',
  },
  {
    id: 'overview',
    title: 'The command center',
    body: 'Net profit, revenue, material value and restock watch update automatically from every order, purchase and expense you record.',
    target: 'overview',
    view: 'overview',
  },
  {
    id: 'orders',
    title: 'Orders',
    body: 'A full sales ledger with search, filters, sorting and pagination. Deliveries and returns automatically update product and material stock.',
    target: 'orders',
    view: 'orders',
  },
  {
    id: 'analytics',
    title: 'Analytics',
    body: 'SKU-level gross margins, platform breakdowns and return-rate impact — with All time, Month, 30-day and 7-day views.',
    target: 'analytics',
    view: 'analytics',
  },
  {
    id: 'products',
    title: 'Products',
    body: 'Your SKU master. Maintain price, cost, opening stock and platform-specific mapping for every product you sell.',
    target: 'catalog',
    view: 'catalog',
  },
  {
    id: 'materials',
    title: 'Materials',
    body: 'Track what is physically on the shelf. Purchases, adjustments and sales consumption form a clear stock ledger.',
    target: 'materials',
    view: 'materials',
  },
  {
    id: 'purchasing',
    title: 'Purchasing',
    body: 'Buy with a complete paper trail — supplier templates keep GST, transport and purchase costs repeatable.',
    target: 'purchasing',
    view: 'purchasing',
  },
  {
    id: 'finance',
    title: 'Finance',
    body: 'Keep operating expenses distinct from borrowed and lent material positions.',
    target: 'finance',
    view: 'finance',
  },
  {
    id: 'imports',
    title: 'Marketplace imports',
    body: 'Drop an Excel, CSV or PDF report and Peak auto-detects the platform, maps columns, creates missing SKUs and skips duplicates.',
    target: 'imports',
    view: 'imports',
  },
  {
    id: 'settings',
    title: 'Workspace & export',
    body: 'Manage your business profile and integration health, download a full Excel backup — and replay this tour anytime.',
    target: 'settings',
    view: 'settings',
  },
  {
    id: 'done',
    title: "You're all set",
    body: 'Start by recording your first order or importing a marketplace report. Everything stays private with Clerk + Supabase.',
  },
]

export function replayTour() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(TOUR_KEY)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent('peak:tour:start'))
}

export function ProductTour({ onNavigate, enabled }: { onNavigate: (view: string) => void; enabled: boolean }) {
  const [active, setActive] = useState<number | null>(null)
  const [spot, setSpot] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [isSheet, setIsSheet] = useState(false)

  const close = () => {
    setActive(null)
    setSpot(null)
    try {
      localStorage.setItem(TOUR_KEY, '1')
    } catch {
      /* storage unavailable */
    }
  }

  useEffect(() => {
    if (!enabled) return
    let seen = true
    try {
      seen = localStorage.getItem(TOUR_KEY) === '1'
    } catch {
      /* storage unavailable */
    }
    if (seen) return
    const timer = window.setTimeout(() => setActive(0), 650)
    return () => window.clearTimeout(timer)
  }, [enabled])

  useEffect(() => {
    const start = () => setActive(0)
    window.addEventListener('peak:tour:start', start)
    return () => window.removeEventListener('peak:tour:start', start)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const update = () => setIsSheet(window.innerWidth < 780)
    setIsSheet(typeof window !== 'undefined' && window.innerWidth < 780)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const step = active !== null ? STEPS[active] : null

  useLayoutEffect(() => {
    if (!step) {
      setSpot(null)
      return
    }
    if (step.view) onNavigate(step.view)
    const measure = () => {
      if (!step.target) {
        setSpot(null)
        return
      }
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        const rect = el.getBoundingClientRect()
        setSpot({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
      }
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure))
    return () => cancelAnimationFrame(raf)
  }, [active, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!step) return null

  const stepNumber = active !== null ? active + 1 : 0
  const isLast = active !== null && active === STEPS.length - 1
  const next = () => {
    if (isLast) {
      close()
      onNavigate('overview')
      return
    }
    if (active !== null) setActive(active + 1)
  }

  const cardStyle: React.CSSProperties = {}
  let cardClass = 'tour-card'
  if (isSheet) {
    cardClass += ' tour-card--sheet'
  } else if (spot) {
    const cardWidth = 340
    const gap = 18
    let left = spot.left + spot.width + gap
    if (left + cardWidth > window.innerWidth - 12) {
      left = Math.max(12, spot.left - cardWidth - gap)
    }
    cardStyle.left = left
    cardStyle.top = Math.max(12, spot.top + spot.height / 2)
    cardClass += ' tour-card--side'
  } else {
    cardClass += ' tour-card--center'
  }

  return (
    <div
      className="tour-overlay"
      role="presentation"
      onMouseDown={() => next()}
      onTouchStart={(event) => {
        if (event.target === event.currentTarget) next()
      }}
    >
      {spot ? (
        <div
          className="tour-spotlight"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          aria-hidden="true"
        />
      ) : null}
      <div
        className={cardClass}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <div className="tour-card__head">
          <span className="tour-card__step">Step {stepNumber} of {STEPS.length}</span>
          <button type="button" className="tour-skip" onClick={close}>Skip</button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-card__actions">
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((item, index) => <span key={item.id} className={index === active ? 'on' : ''} />)}
          </div>
          <div className="tour-nav">
            {active !== null && active > 0 ? <button type="button" className="button" onClick={() => setActive(active - 1)}>Back</button> : null}
            <button type="button" className="button primary" onClick={next}>{isLast ? 'Get started' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}