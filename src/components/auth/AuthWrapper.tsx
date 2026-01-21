"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "@/lib/auth/auth-client"

function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data: session, isPending } = useSession()

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/login")
    }
  }, [isPending, session, router])

  if (isPending || !session) {
    return null
  }

  return <>{children}</>
}

export function AuthWrapper({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>
}
