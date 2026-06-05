import { Outlet } from '@tanstack/react-router'

import { Footer } from './Footer'
import { Header } from './Header'

import { Toaster } from '#/components/ui/sonner'
import { TooltipProvider } from '#/components/ui/tooltip'
import { ServiceStatusBanner } from '#/features/status/ServiceStatus'

export function RootLayout() {
  return (
    <TooltipProvider>
      <div id="app-content" className="flex min-h-screen flex-col">
        <Header />
        <ServiceStatusBanner />
        <main className="container mx-auto flex-1 px-4 py-6">
          <Outlet />
        </main>
        <Footer />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
