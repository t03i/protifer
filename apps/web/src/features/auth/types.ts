export type AuthModalContextType = 'accession' | 'sequence' | 'generic'

export interface AuthModalState {
  isOpen: boolean
  dismissable: boolean
  contextType: AuthModalContextType
  contextValue?: string
  redirectTo: string
}

export interface OpenOptions {
  dismissable?: boolean
  contextType?: AuthModalContextType
  contextValue?: string
  redirectTo?: string
}

export interface AuthModalContextValue {
  open: (options?: OpenOptions) => void
  close: () => void
  state: AuthModalState
}
