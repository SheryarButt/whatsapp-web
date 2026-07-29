import type { ShellApi } from './shell'

declare global {
  interface Window {
    shell: ShellApi
  }
}

export {}
