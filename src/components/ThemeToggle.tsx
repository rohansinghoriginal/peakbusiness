'use client'

import { useTheme } from '@/lib/theme-context'

export function ThemeToggle({ className = '', showLabel = true }: { className?: string; showLabel?: boolean }) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      className={`theme-toggle ${className}`}
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      <span aria-hidden="true">{theme === 'light' ? '◐' : '☀'}</span>
      {showLabel && (
        <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
      )}
    </button>
  )
}