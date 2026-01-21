"use client"

import { ResizableSidebar } from "@/components/sidebar/ResizableSidebar"
import { QueryProvider } from "@/lib/context/QueryProvider"
import { AuthWrapper } from "@/components/auth/AuthWrapper"

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthWrapper>
      <QueryProvider>
        <div className="flex h-screen">
          <ResizableSidebar />
          <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
        </div>
      </QueryProvider>
    </AuthWrapper>
  )
}
