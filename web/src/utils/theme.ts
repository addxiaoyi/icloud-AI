import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const THEME_KEY = 'ui-theme'

function apply(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', choice)
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 主题切换: system/light/dark, 持久化到 localStorage; 返回当前实际是否暗色 */
export function useTheme(): {
  theme: ThemeChoice
  isDark: boolean
  setTheme: (t: ThemeChoice) => void
} {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  })
  const [isDark, setIsDark] = useState(() =>
    theme === 'dark' || (theme === 'system' && systemPrefersDark()),
  )

  useEffect(() => {
    apply(theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (theme === 'system') {
        setIsDark(media.matches)
      }
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t)
    localStorage.setItem(THEME_KEY, t)
    apply(t)
    setIsDark(t === 'dark' || (t === 'system' && systemPrefersDark()))
  }, [])

  return { theme, isDark, setTheme }
}
