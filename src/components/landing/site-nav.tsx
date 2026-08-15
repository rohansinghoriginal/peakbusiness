'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ThemeToggle } from '@/components/ThemeToggle'

const navLinks = [
  { href: '/#features', label: 'Features' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/overview', label: 'Dashboard' },
]

export function SiteNav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="landing-nav">
      <div className="nav-inner">
        <Link href="/" className="nav-logo" aria-label="Peak Business home" onClick={() => setOpen(false)}>
          <span className="nav-logo-mark">PB</span>
          <span><b>Peak</b> Business</span>
        </Link>

        <nav className="nav-links" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href}>{link.label}</Link>
          ))}
        </nav>

        <div className="nav-actions">
          <ThemeToggle showLabel />
          <Link href="/sign-up" className="btn btn-primary nav-cta">Get Started</Link>
        </div>

        <button
          className={`hamburger ${open ? 'open' : ''}`}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <div className={`mobile-menu ${open ? 'open' : ''}`} hidden={!open}>
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>
        ))}
        <Link href="/sign-up" className="btn btn-primary btn-block" onClick={() => setOpen(false)}>Get Started</Link>
      </div>
    </header>
  )
}