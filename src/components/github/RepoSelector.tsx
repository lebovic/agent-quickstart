"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Github, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { GitHubInstallPrompt } from "./GitHubInstallPrompt"

export type RepoItem = {
  repo: {
    name: string
    owner: { login: string }
    default_branch: string
    visibility: string
    archived: boolean
  }
  status: unknown
}

type RepoSelectorProps = {
  value?: { owner: string; repo: string } | null
  onChange: (repo: { owner: string; repo: string; default_branch: string } | null) => void
  disabled?: boolean
}

async function fetchRepos(): Promise<{ repos: RepoItem[] }> {
  const response = await fetch("/api/code/repos")
  if (!response.ok) {
    throw new Error("Failed to fetch repos")
  }
  return response.json()
}

async function fetchInstallationUrl(): Promise<{ url: string; installed: boolean }> {
  const response = await fetch("/api/github/installation-url")
  if (!response.ok) {
    throw new Error("Failed to fetch installation URL")
  }
  return response.json()
}

export function RepoSelector({ value, onChange, disabled }: RepoSelectorProps) {
  const [open, setOpen] = useState(false)
  const [installPromptOpen, setInstallPromptOpen] = useState(false)

  const { data: installData } = useQuery({
    queryKey: ["github", "installation-url"],
    queryFn: fetchInstallationUrl,
  })

  const { data: reposData, isLoading } = useQuery({
    queryKey: ["github", "repos"],
    queryFn: fetchRepos,
    enabled: installData?.installed === true,
  })

  const repos = reposData?.repos ?? []

  const handleSelect = (item: RepoItem) => {
    onChange({
      owner: item.repo.owner.login,
      repo: item.repo.name,
      default_branch: item.repo.default_branch,
    })
    setOpen(false)
  }

  const handleInstallClick = () => {
    setOpen(false)
    setInstallPromptOpen(true)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className="group flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-300 hover:text-text-100 hover:bg-bg-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-0 flex-1"
            disabled={disabled}
          >
            <Github className="size-4 shrink-0" />
            <span className="truncate">{value ? value.repo : "Select repository"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-0" align="start">
          <Command>
            <div className="px-2 pt-2">
              <div className="rounded-md bg-bg-200">
                <CommandInput placeholder="Search repositories" showIcon={false} wrapperClassName="h-8 px-2 border-0" />
              </div>
            </div>
            <CommandList className="max-h-[280px]">
              {isLoading && <div className="py-6 text-center text-sm text-text-500">Loading...</div>}
              {!isLoading && repos.length === 0 && installData?.installed && (
                <div className="py-6 text-center text-xs text-text-500">No repositories found</div>
              )}
              {!isLoading && repos.length > 0 && (
                <CommandGroup heading="All Repositories" className="px-1">
                  {repos.map((item) => (
                    <CommandItem
                      key={`${item.repo.owner.login}/${item.repo.name}`}
                      value={`${item.repo.owner.login}/${item.repo.name}`}
                      onSelect={() => handleSelect(item)}
                      className="cursor-pointer data-[selected=true]:bg-bg-200"
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate font-medium">{item.repo.name}</span>
                        <span className="truncate text-xs text-text-500">{item.repo.owner.login}</span>
                      </div>
                      {value?.owner === item.repo.owner.login && value?.repo === item.repo.name && (
                        <Check className="size-4 text-accent-main-100" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            <div className="px-2 pb-2">
              <div className="border-t border-border-300 mx-2 my-3" />
              <p className="text-xs text-text-500 mb-2 px-1">
                Repo missing? Install the GitHub App to grant access to additional repositories.
              </p>
              <Button variant="ghost" size="sm" className="w-full gap-2 justify-start text-xs font-normal" onClick={handleInstallClick}>
                <Github className="size-4" />
                Install GitHub App
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <GitHubInstallPrompt open={installPromptOpen} onOpenChange={setInstallPromptOpen} installUrl={installData?.url} />
    </>
  )
}
