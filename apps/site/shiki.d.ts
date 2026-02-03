// Type declarations for shiki's bundled dynamic imports
// These paths are valid at runtime via shiki's ./dist/* export pattern
declare module 'shiki/langs/typescript' {
  import type { LanguageRegistration } from 'shiki'
  const lang: LanguageRegistration[]
  export default lang
}

declare module 'shiki/langs/bash' {
  import type { LanguageRegistration } from 'shiki'
  const lang: LanguageRegistration[]
  export default lang
}

declare module 'shiki/themes/github-light' {
  import type { ThemeRegistration } from 'shiki'
  const theme: ThemeRegistration
  export default theme
}
