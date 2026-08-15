import Link from 'next/link'
import type { Metadata } from 'next'

import { AuthGate } from '@/components/landing/auth-gate'
import { SiteNav } from '@/components/landing/site-nav'
import { DashboardPreview } from '@/components/landing/dashboard-preview'

export const metadata: Metadata = {
  title: 'Peak Business · Operations OS for modern sellers',
  description:
    'Unify orders, inventory, materials, and finances into one live ledger. Import from Amazon, Meesho, Flipkart, Shopify, or your own workbook.',
}

const features = [
  {
    icon: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm2 3h12M8 12h8M8 16h5',
    title: 'Smart Ingestion',
    desc: 'Drop any marketplace export or your own workbook. AI maps columns, detects platform, creates missing SKUs, and flags duplicates automatically.',
  },
  {
    icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
    title: 'Live Inventory Ledger',
    desc: 'Every order updates SKU stock and explodes BOMs to consume raw materials in real time. Weighted-average costing tracks true COGS. Low-stock alerts keep you ahead.',
  },
  {
    icon: 'M3 3v18h18M7 15l4-6 4 4 5-8',
    title: 'Profitability Analytics',
    desc: 'SKU-level margins, platform breakdowns, return-rate impact, and trend lines — all computed from your ledger, not sampled.',
  },
  {
    icon: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-9 7V6.5M13 6.5V10m0 3h3.5M10 13v3.5M13 13H9.5',
    title: 'Materials & BOM',
    desc: 'Define recipes per SKU. Purchase materials, track weighted-average costs, and watch consumption auto-post to the material ledger.',
  },
  {
    icon: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
    title: 'Finance Desk',
    desc: 'Log expenses by category and platform. Track borrow and lend with counterparties. Reconcile settlements from every marketplace. Export a full workbook anytime.',
  },
  {
    icon: 'M4 5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm6 13v-4m-3 0h6',
    title: 'Multi-Platform, One Ledger',
    desc: 'Amazon, Meesho, Flipkart, Shopify, Offline — all in one place. Per-row platform detection keeps every order tagged correctly.',
  },
]

const pricing = [
  {
    title: 'Starter',
    price: 'Free',
    period: '/month',
    features: ['Up to 500 orders/month', 'Up to 100 SKUs', 'All platforms supported', 'Basic analytics', 'Email support'],
    cta: { label: 'Start Free', href: '/sign-up', className: 'btn btn-outline btn-block' },
  },
  {
    title: 'Growth',
    price: '₹2,999',
    period: '/month',
    featured: true,
    features: ['Up to 10,000 orders/month', 'Unlimited SKUs', 'Advanced analytics & exports', 'Materials & BOM', 'Priority support'],
    cta: { label: 'Start Free Trial', href: '/sign-up', className: 'btn btn-primary btn-block' },
  },
  {
    title: 'Scale',
    price: 'Custom',
    period: '',
    features: ['Unlimited orders & SKUs', 'Dedicated onboarding', 'API access', 'SSO & audit logs', 'SLA guarantee'],
    cta: { label: 'Contact Sales', href: '/sign-up', className: 'btn btn-outline btn-block' },
  },
]

export default function LandingPage() {
  return (
    <div className="landing-shell">
      <AuthGate />
      <SiteNav />

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-inner hero-inner--split">
            <div className="hero-content">
              <p className="hero-eyebrow">Operations OS for modern sellers</p>
              <h1 id="hero-title" className="hero-title">
                Stop reconciling spreadsheets.<br />Start running your business.
              </h1>
              <p className="hero-subtitle">
                Peak Business unifies orders, inventory, materials, and finances into one live ledger.
                Import from Amazon, Meesho, Flipkart, Shopify, or your own workbook.
              </p>
              <div className="hero-ctas">
                <Link href="/sign-up" className="btn btn-primary btn-lg">Start free — no credit card</Link>
                <Link href="#features" className="btn btn-ghost btn-lg">Explore features</Link>
              </div>
              <p className="hero-trust">
                Join sellers who closed their spreadsheet tabs for good. Data is protected by Clerk + Supabase.
              </p>
            </div>
            <div className="hero-visual" aria-hidden="false">
              <DashboardPreview />
            </div>
          </div>
        </section>

        <section id="features" className="features" aria-labelledby="features-title">
          <div className="section-header">
            <p className="eyebrow">What you get</p>
            <h2 id="features-title">Everything you need to run lean operations</h2>
            <p className="muted">One workspace that replaces your spreadsheet tabs — built for Indian marketplace sellers.</p>
          </div>
          <div className="features-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <div className="feature-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={feature.icon} />
                  </svg>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="pricing" className="pricing" aria-labelledby="pricing-title">
          <div className="section-header">
            <p className="eyebrow">Simple, transparent</p>
            <h2 id="pricing-title">Pricing that scales with you</h2>
            <p className="muted">Start free. Upgrade only when the ledger starts paying for itself.</p>
          </div>
          <div className="pricing-cards">
            {pricing.map((tier) => (
              <article className={`pricing-card${tier.featured ? ' pricing-card--featured' : ''}`} key={tier.title}>
                <h3>{tier.title}</h3>
                <p className="price">{tier.price}<span>{tier.period}</span></p>
                <ul>
                  {tier.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Link href={tier.cta.href} className={tier.cta.className}>{tier.cta.label}</Link>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer" role="contentinfo">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" className="footer-logo"><span className="logo-mark">PB</span><span><b>Peak</b> Business</span></Link>
            <p>Operations OS for modern sellers. One ledger for orders, inventory, materials, and finance.</p>
          </div>
          <nav className="footer-nav" aria-label="Footer navigation">
            <FooterSection title="Product" links={[{ href: '/#features', label: 'Features' }, { href: '/#pricing', label: 'Pricing' }, { href: '/overview', label: 'Dashboard' }]} />
            <FooterSection title="Start" links={[{ href: '/sign-up', label: 'Create account' }, { href: '/sign-in', label: 'Sign in' }]} />
          </nav>
        </div>
        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} Peak Business. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

function FooterSection({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div className="footer-section">
      <h4>{title}</h4>
      <ul>
        {links.map((link) => (
          <li key={link.href}><Link href={link.href}>{link.label}</Link></li>
        ))}
      </ul>
    </div>
  )
}