import { Link } from '@tanstack/react-router'
import { Menu, Moon, Sun, X } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'

import logo from '#/assets/logo.svg'
import { Button } from '#/components/ui/button'
import { AuthButton } from '#/features/auth/components/AuthButton'
import { ServiceStatusDot } from '#/features/status/ServiceStatus'

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/methods', label: 'Methods' },
  { to: '/about', label: 'About' },
  { to: '/faq', label: 'FAQ' },
  { to: '/cite', label: 'Cite' },
  { to: '/glossary', label: 'Glossary' },
] as const

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  )
}

export function Header() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <img src={logo} alt="protifer" className="h-8 w-8" />
          <span className="font-semibold text-sm">protifer</span>
        </Link>

        <nav className="hidden items-center gap-4 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <ThemeToggle />
          <ServiceStatusDot />
          <AuthButton />
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      {sidebarOpen && (
        <nav className="flex flex-col gap-2 border-t px-4 py-2 md:hidden">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-1">
            <AuthButton />
          </div>
        </nav>
      )}
    </header>
  )
}
