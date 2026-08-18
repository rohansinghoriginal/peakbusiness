import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">PB</span>
        <span>Peak Business</span>
      </div>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </main>
  )
}
