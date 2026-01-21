"use client"

import { Code, User } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useSession } from "@/lib/auth/auth-client"
import { DeveloperSettings } from "@/components/settings/DeveloperSettings"

type Section = "account" | "developer"

function isValidSection(tab: string | undefined): tab is Section {
  return tab === "account" || tab === "developer"
}

export default function SettingsPage() {
  const params = useParams<{ tab?: string[] }>()
  const tabParam = params.tab?.[0]
  const activeSection: Section = isValidSection(tabParam) ? tabParam : "account"

  return (
    <div className="flex flex-col md:flex-row h-full bg-bg-200">
      {/* Settings sidebar */}
      <div className="w-full md:w-56 p-4 shrink-0">
        <div className="mb-4 md:mb-6 px-2">
          <h1 className="font-heading text-2xl font-medium text-text-100">
            <Link href="/code" className="cursor-pointer hover:text-text-200 transition-colors">
              Settings
            </Link>
          </h1>
        </div>
        <nav className="flex flex-row md:flex-col gap-1">
          <Link
            href="/settings/account"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
              activeSection === "account" ? "bg-bg-300 text-text-100" : "text-text-200 hover:bg-bg-300 hover:text-text-100"
            }`}
          >
            <User className="size-4" />
            Account
          </Link>
          <Link
            href="/settings/developer"
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
              activeSection === "developer" ? "bg-bg-300 text-text-100" : "text-text-200 hover:bg-bg-300 hover:text-text-100"
            }`}
          >
            <Code className="size-4" />
            Developer
          </Link>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 md:pl-10 md:pr-8 pb-8">
        <div className="hidden md:block h-[70px]" />
        <div className="max-w-2xl">
          {activeSection === "account" && <AccountSettings />}
          {activeSection === "developer" && <DeveloperSettings />}
        </div>
      </div>
    </div>
  )
}

function AccountSettings() {
  const { data: session, isPending } = useSession()

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text-100">Account</h2>
      <div className="py-4">
        <label className="text-sm font-medium text-text-200">Email</label>
        {isPending ? (
          <div className="mt-1 h-5 w-48 animate-pulse rounded bg-bg-300" />
        ) : (
          <p className="mt-1 text-sm text-text-100">{session?.user.email}</p>
        )}
      </div>
    </div>
  )
}
