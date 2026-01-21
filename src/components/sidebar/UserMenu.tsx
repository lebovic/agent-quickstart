"use client"

import Link from "next/link"
import { Settings, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSession, signOut } from "@/lib/auth/auth-client"
import { useSidebarStore } from "@/lib/stores/sidebar-store"

function getInitials(email: string): string {
  const name = email.split("@")[0]
  const parts = name.split(/[._-]/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function UserMenu() {
  const { data: session, isPending } = useSession()
  const collapse = useSidebarStore((state) => state.collapse)

  if (isPending || !session) {
    return (
      <Avatar className="size-8">
        <AvatarFallback className="bg-bg-200 animate-pulse" />
      </Avatar>
    )
  }

  const initials = getInitials(session.user.email)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="size-8 cursor-pointer hover:opacity-90 transition-opacity">
            <AvatarFallback className="bg-teal-600 text-white text-xs font-medium">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="font-normal text-text-100">{session.user.email}</DropdownMenuLabel>
        <DropdownMenuItem asChild className="cursor-pointer" onClick={collapse}>
          <Link href="/settings">
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-2" />
        <DropdownMenuItem onClick={() => signOut()} className="cursor-pointer">
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
