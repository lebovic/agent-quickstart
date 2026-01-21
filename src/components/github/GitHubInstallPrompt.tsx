"use client"

import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type GitHubInstallPromptProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  installUrl?: string
}

export function GitHubInstallPrompt({ open, onOpenChange, installUrl }: GitHubInstallPromptProps) {
  const handleInstall = () => {
    if (installUrl) {
      window.open(installUrl, "_blank")
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install GitHub App</DialogTitle>
          <DialogDescription>
            Install the GitHub App to grant access to your repositories. You can choose which repositories to allow during
            installation.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInstall} disabled={!installUrl}>
            Install app
            <ExternalLink className="size-4 ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
