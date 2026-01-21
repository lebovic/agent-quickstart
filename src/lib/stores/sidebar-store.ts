import { create } from "zustand"

type SidebarStore = {
  isCollapsed: boolean
  collapse: () => void
  expand: () => void
  toggle: () => void
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  isCollapsed: false,
  collapse: () => set({ isCollapsed: true }),
  expand: () => set({ isCollapsed: false }),
  toggle: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
}))
