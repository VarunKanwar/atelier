import { Box, Link as ChakraLink, Stack, Text } from '@chakra-ui/react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { createBundledHighlighter, createSingletonShorthands } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

type DocItem = {
  path: string
  title: string
}

type NavSection = {
  title: string
  items: DocItem[]
}

const createHighlighter = createBundledHighlighter({
  langs: {
    typescript: () => import('shiki/langs/typescript'),
    bash: () => import('shiki/langs/bash'),
  },
  themes: {
    'github-light': () => import('shiki/themes/github-light'),
  },
  engine: () => createJavaScriptRegexEngine(),
})

const { codeToHtml } = createSingletonShorthands(createHighlighter)

const normalizeLanguage = (language?: string): string => {
  if (!language) return 'typescript'
  const normalized = language.toLowerCase()
  if (['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript'].includes(normalized)) {
    return 'typescript'
  }
  if (['bash', 'sh', 'shell', 'zsh'].includes(normalized)) {
    return 'bash'
  }
  return 'typescript'
}

const highlightCache = new Map<string, string>()

const CodeBlock = ({ code, language }: { code: string; language?: string }) => {
  const lang = normalizeLanguage(language)
  const cacheKey = `${lang}::${code}`
  const [html, setHtml] = useState<string>(() => highlightCache.get(cacheKey) ?? '')

  useEffect(() => {
    let active = true
    const cached = highlightCache.get(cacheKey)
    if (cached) {
      setHtml(cached)
      return () => {
        active = false
      }
    }
    codeToHtml(code, {
      lang,
      theme: 'github-light',
      transformers: [
        {
          pre(node) {
            node.properties.style = ''
          },
        },
      ],
    })
      .then(result => {
        if (active) {
          highlightCache.set(cacheKey, result)
          setHtml(result)
        }
      })
      .catch(() => {
        if (active) setHtml('')
      })
    return () => {
      active = false
    }
  }, [cacheKey, code, lang])

  if (!html) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="docs-codeblock"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki outputs trusted HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

const normalizeDocPath = (input: string): string => {
  const parts = input.split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.' || part.length === 0) continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

const resolveDocPath = (currentDoc: string, target: string): string => {
  if (target.startsWith('/')) {
    return normalizeDocPath(target.slice(1))
  }
  const baseDir = currentDoc.includes('/') ? currentDoc.slice(0, currentDoc.lastIndexOf('/') + 1) : ''
  if (target.startsWith('./') || target.startsWith('../')) {
    return normalizeDocPath(`${baseDir}${target}`)
  }
  return normalizeDocPath(`${baseDir}${target}`)
}

const parseIndex = (markdown: string): NavSection[] => {
  const lines = markdown.split(/\r?\n/)
  const sections: NavSection[] = []
  let current: NavSection | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim()
      current = { title, items: [] }
      sections.push(current)
      continue
    }
    if (!current || !line.startsWith('- [')) continue
    const match = line.match(/^- \[(.+?)\]\((.+?)\)/)
    if (!match) continue
    const [, title, path] = match
    if (!title || !path) continue
    current.items.push({ title, path })
  }

  return sections.filter(section => section.items.length > 0)
}

const Docs = () => {
  const params = useParams()
  const docs = useMemo(() => {
    const entries = import.meta.glob('./generated/docs/**/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const map = new Map<string, string>()
    for (const [path, content] of Object.entries(entries)) {
      const file = path
        .replace(/^\.\/generated\/docs\//, '')
        .replace(/^.*\/generated\/docs\//, '')
      if (file && typeof content === 'string') {
        map.set(file, content)
      }
    }
    return map
  }, [])

  const indexContent = docs.get('README.md') ?? ''
  const sections = useMemo(() => {
    if (!indexContent) return []
    return parseIndex(indexContent)
  }, [indexContent])

  const preferredDefaults = ['guides/getting-started.md', 'api-reference.md', 'README.md']
  const defaultDoc = preferredDefaults.find(path => docs.has(path)) ?? 'README.md'
  const rawPath = params['*'] ? decodeURIComponent(params['*']) : defaultDoc
  const normalizedPath = normalizeDocPath(
    rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`
  )
  const resolvedDoc = docs.has(normalizedPath) ? normalizedPath : defaultDoc
  const content = docs.get(resolvedDoc) ?? ''

  return (
    <Box bg="var(--page-bg)" minH="100vh">
      <Box borderTopWidth="1px" borderColor="var(--border-subtle)">
        <Box
          maxW="var(--content-max-width)"
          mx="auto"
          px={{ base: 5, md: 8 }}
          py={{ base: 10, md: 12 }}
        >
          <Stack
            gap={{ base: 8, lg: 12 }}
            direction={{ base: 'column', lg: 'row' }}
            align={{ base: 'start', lg: 'stretch' }}
            minH={{ base: 'calc(100vh - 80px)', md: 'calc(100vh - 96px)' }}
          >
            <Box
              w={{ base: 'full', lg: '240px' }}
              pr={{ base: 0, lg: 6 }}
              borderRightWidth={{ base: '0', lg: '1px' }}
              borderColor="var(--border-subtle)"
              position={{ lg: 'sticky' }}
              top={{ lg: '96px' }}
            >
              <Stack gap={7} fontSize="sm" py={{ base: 0, lg: 2 }}>
                {sections.map(section => (
                  <Stack key={section.title} gap={3}>
                    <Text
                      fontSize="xs"
                      fontWeight="semibold"
                      textTransform="uppercase"
                      letterSpacing="0.08em"
                      color="gray.500"
                    >
                      {section.title}
                    </Text>
                    <Stack gap={2} color="gray.600">
                    {section.items.map(item => {
                      const navPath = normalizeDocPath(item.path)
                      const isActive = resolvedDoc === navPath
                      return (
                        <ChakraLink
                          key={item.path}
                          as={RouterLink}
                          to={`/docs/${encodeURI(navPath)}`}
                          className={`docs-nav-link${isActive ? ' docs-nav-link-active' : ''}`}
                          aria-current={isActive ? 'page' : undefined}
                          fontSize="sm"
                          fontWeight={isActive ? 'semibold' : 'normal'}
                          color={isActive ? 'gray.900' : 'gray.600'}
                          textDecoration="none"
                          lineHeight="1.6"
                          _hover={{ color: 'gray.900', textDecoration: 'none' }}
                          _focusVisible={{ outline: 'none', boxShadow: 'none' }}
                          _focus={{ outline: 'none', boxShadow: 'none' }}
                        >
                          {item.title}
                        </ChakraLink>
                      )
                    })}
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Box>

            <Box flex="1" minW={0} pt={{ base: 2, md: 4 }}>
              {content ? (
                <Box className="docs-content">
                  <ReactMarkdown
                    components={{
                      pre: ({ children }) => <>{children}</>,
                      code: ({ className, children, inline }) => {
                        const rawCode = String(children).replace(/\n$/, '')
                        const inferredInline =
                          inline ??
                          (!className || (!rawCode.includes('\n') && !rawCode.includes('\r')))
                        if (inferredInline) {
                          return <code className={className}>{children}</code>
                        }
                        const match = /language-([\w-]+)/.exec(className ?? '')
                        const language = match?.[1]
                        return <CodeBlock code={rawCode} language={language} />
                      },
                      a: ({ children, href }) => {
                        if (!href) return <a>{children}</a>
                        if (href.startsWith('http')) {
                          return (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          )
                        }
                        if (href.startsWith('#')) {
                          return <a href={href}>{children}</a>
                        }
                        if (href.includes('.md')) {
                          const [file, hash] = href.split('#')
                          const resolved = resolveDocPath(resolvedDoc, file)
                          const to = `/docs/${encodeURI(resolved)}${hash ? `#${hash}` : ''}`
                          return <RouterLink to={to}>{children}</RouterLink>
                        }
                        return <a href={href}>{children}</a>
                      },
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                </Box>
              ) : (
                <Text color="gray.500" fontSize="sm">
                  Documentation has not been generated yet. Run the docs build first.
                </Text>
              )}
            </Box>
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}

export default Docs
