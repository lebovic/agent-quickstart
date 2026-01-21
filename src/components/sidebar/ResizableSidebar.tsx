"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { PanelLeft } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { SessionList } from "./SessionList"
import { SessionCreator } from "./SessionCreator"
import { UserMenu } from "./UserMenu"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { useSidebarStore } from "@/lib/stores/sidebar-store"

const MIN_WIDTH = 240
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 340
const COLLAPSED_WIDTH = 56

export function ResizableSidebar() {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const pathname = usePathname()
  const isMobile = useIsMobile()

  const { isCollapsed, collapse, expand } = useSidebarStore()

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return

      const newWidth = e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
      }
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // On mobile, hide sidebar when viewing a session or settings
  const isViewingSession = pathname.startsWith("/code/") && pathname !== "/code"
  const isViewingSettings = pathname.startsWith("/settings")
  if (isMobile && (isViewingSession || isViewingSettings)) {
    return null
  }

  const sidebarWidth = isCollapsed ? COLLAPSED_WIDTH : width

  return (
    <aside
      ref={sidebarRef}
      className={`relative flex flex-col bg-bg-200 ${isDragging ? "" : "transition-[width] duration-200"} ${isMobile ? "" : "border-r-[0.5px] border-border-300"}`}
      style={isMobile ? { width: "100%" } : { width: sidebarWidth }}
    >
      {isCollapsed ? (
        // Collapsed state
        <div className="flex flex-col h-full items-center py-3 gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={expand} className="text-text-400 hover:text-text-100 hover:bg-bg-300">
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
          <SessionCreator collapsed onExpand={expand} />
          <div className="mt-auto pb-1">
            <UserMenu />
          </div>
        </div>
      ) : (
        // Expanded state
        <>
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <h1 className="font-heading text-2xl font-medium text-text-100">Code</h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={collapse} className="text-text-400 hover:text-text-100 hover:bg-bg-300">
                    <PanelLeft className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse sidebar</TooltipContent>
              </Tooltip>
            </div>
            <SessionCreator />
            <SessionList />
          </div>

          {/* User menu at bottom */}
          <div className="px-4 pb-4 pt-2">
            <UserMenu />
          </div>

          {/* Resize handle - only on desktop */}
          {!isMobile && (
            <div onMouseDown={handleMouseDown} className="absolute top-0 -right-px w-[3px] h-full cursor-col-resize group">
              <div className={`w-[2px] h-full mx-auto transition-colors ${isDragging ? "bg-primary/50" : "group-hover:bg-primary/30"}`} />
            </div>
          )}
        </>
      )}
    </aside>
  )
}
