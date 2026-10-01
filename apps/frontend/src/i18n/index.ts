import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'

/**
 * Every string the shells show. Screens add their own keys as they land; the words must match
 * their Figma frame exactly (specs/frontend/screens.md, "copy word for word").
 *
 * English is the only language in the build. A person's `locale` comes from GET /me and D12
 * Account switches it, so a second language is a second JSON file here and nothing more.
 */
export const defaultNS = 'translation'
export const resources = { en: { translation: en } } as const

void i18next.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  defaultNS,
  interpolation: { escapeValue: false }, // React escapes already
  returnNull: false,
})

export { i18next }
