import type { Metadata } from "next"
import { Inter, JetBrains_Mono, Lora } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/sonner"

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
})

const lora = Lora({
  variable: "--font-serif",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Agent",
  description: "Remote Claude Code sessions",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${lora.variable} antialiased bg-bg-100 text-text-100`}>
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  )
}
