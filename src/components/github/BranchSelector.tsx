"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { GitBranch, Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

type Branch = {
  name: string
  is_default: boolean
}

type BranchSelectorProps = {
  owner: string
  repo: string
  value?: string | null
  onChange: (branch: string | null) => void
  disabled?: boolean
}

async function fetchBranches(owner: string, repo: string): Promise<{ branches: Branch[] }> {
  const response = await fetch(`/api/code/repos/${owner}/${repo}/branches`)
  if (!response.ok) {
    throw new Error("Failed to fetch branches")
  }
  return response.json()
}

export function BranchSelector({ owner, repo, value, onChange, disabled }: BranchSelectorProps) {
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["github", "branches", owner, repo],
    queryFn: () => fetchBranches(owner, repo),
    enabled: Boolean(owner && repo),
  })

  const branches = data?.branches ?? []
  const selectedBranch = value ? branches.find((b) => b.name === value) : null

  const handleSelect = (branch: Branch) => {
    onChange(branch.name)
    setOpen(false)
  }

  // Sort branches: default first, then alphabetically
  const sortedBranches = [...branches].sort((a, b) => {
    if (a.is_default && !b.is_default) return -1
    if (!a.is_default && b.is_default) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className="group flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-300 hover:text-text-100 hover:bg-bg-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-0"
          disabled={disabled || !owner || !repo}
        >
          <GitBranch className="size-4" />
          <span className="truncate">{selectedBranch ? selectedBranch.name : "Select branch"}</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search branches" />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-text-500">Loading...</div>
            ) : branches.length === 0 ? (
              <CommandEmpty>No branches found</CommandEmpty>
            ) : (
              <CommandGroup>
                {sortedBranches.map((branch) => (
                  <CommandItem key={branch.name} value={branch.name} onSelect={() => handleSelect(branch)} className="cursor-pointer">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="truncate">{branch.name}</span>
                      {branch.is_default && <span className="text-xs text-text-500 bg-bg-200 px-1.5 py-0.5 rounded">default</span>}
                    </div>
                    {selectedBranch?.name === branch.name && <Check className="size-4 text-accent-main-100" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
