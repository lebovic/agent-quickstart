"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth/auth-client"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/",
    })

    setLoading(false)

    if (error) {
      setError("Failed to send magic link")
      return
    }

    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="w-full max-w-sm space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Check your email</h1>
          <p className="text-muted-foreground">
            We sent a sign-in link to <span className="font-medium">{email}</span>
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => setSubmitted(false)}>
          Use a different email
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md space-y-8 p-8">
      <div className="absolute top-6 left-6">
        <h1 className="font-heading text-2xl font-medium text-text-100">Agent</h1>
      </div>
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold">Sign in</h2>
        <p className="text-muted-foreground">Enter your email to receive a sign-in link</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 border border-border-300 rounded-2xl shadow-sm p-6">
        <div>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 text-base bg-white"
          />
        </div>
        <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
          {loading ? "Sending..." : "Continue with email"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground text-center pt-2">
          By continuing, you agree to our{" "}
          <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            Privacy Policy
          </a>
        </p>
      </form>
    </div>
  )
}
