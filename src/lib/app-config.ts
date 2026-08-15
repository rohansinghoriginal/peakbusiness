/**
 * Central non-secret application configuration.
 *
 * Put actual credentials only in `.env.local` locally and in Cloudflare Workers
 * secrets in production. Those values are read centrally by `src/lib/env.ts`.
 */
export const appConfig = {
  appName: 'Peak Business',
  appDescription: 'Business operations, inventory, and marketplace reporting.',
  supportedPlatforms: ['Amazon', 'Flipkart', 'Meesho', 'Shopify', 'Offline'],
  expenseCategories: ['Packaging', 'Shipping', 'Ads', 'Tools', 'Marketplace fees', 'Other'],
  currency: 'INR',
  locale: 'en-IN',
  defaultTheme: 'system' as const,
} as const
