import { Link } from '@tanstack/react-router'
import { ChevronDown, Github, KeyRound, LogOut } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Skeleton } from '#/components/ui/skeleton'
import { useAuthContext } from '#/features/auth/context'

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function AuthButton() {
  const { isAuthenticated, isLoading, user, login, logout } = useAuthContext()

  if (isLoading) {
    return <Skeleton className="h-8 w-24 rounded-md" />
  }

  if (!isAuthenticated) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => login(window.location.pathname)}
      >
        <Github className="h-4 w-4" />
        Sign in
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {getInitials(user!.name)}
          </span>
          <span className="hidden lg:inline">{user!.name}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/settings/api-keys" className="gap-2">
            <KeyRound className="h-4 w-4" />
            API keys
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => logout()} className="gap-2">
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
