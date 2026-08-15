Migration notes: Next.js middleware -> proxy

Context
- Next.js build emitted a deprecation warning: "The 'middleware' file convention is deprecated. Please use 'proxy' instead." The repository contains a middleware.ts that uses Clerk's clerkMiddleware.
- The current middleware provides route protection for authenticated pages via Clerk.

Goal
- Replace the middleware.ts convention with the recommended Next.js 16+ proxy approach so the app has no deprecation warnings and follows the latest Next.js guidance.

High-level migration steps
1. Read Next.js docs for the new 'proxy' approach and Clerk's Next 16 integration docs.
2. Identify what the middleware does:
   - Protect routes (non-public) using Clerk auth
   - Matchers: '/', '/sign-in(.*)', '/sign-up(.*)', '/api/health' are public; everything else requires auth
3. Implement the proxy equivalent. Options:
   - Use a custom Edge function or a server layer (Cloudflare Workers / Vercel Edge) to enforce auth before hitting Next handlers.
   - Move auth checks into server-route handlers and server components where feasible (explicit checks in API routes and pageServer.tsx handlers).
4. Replace middleware.ts with a proxy configuration in next.config or cloud adapter as documented by Next.js and Clerk.

Notes & Risks
- Clerk's "clerkMiddleware" currently expects middleware runtime; moving to proxy requires verifying Clerk has an official adapter for the chosen proxy target (Cloudflare, Vercel, etc.).
- This migration can affect routes, cookies, and SSR behaviour — test thoroughly.

Recommended minimal plan (safe, incremental)
1. Keep middleware.ts in place while adding integration tests to ensure auth behaviour remains intact.
2. Implement proxy on staging first and validate behavior for all protected routes.
3. When stable, remove middleware.ts and ensure CI/build reports no deprecation warnings.

If you'd like, I can: 
- Create a working proof-of-concept proxy implementation for your deployment target (Cloudflare via @opennextjs/cloudflare is in this repo), or
- Start the incremental approach: add tests for middleware behavior, then attempt a proxy proof-of-concept and run full test/build.

Which option do you prefer? (ask me to proceed and provide the target deployment platform if POC is desired).