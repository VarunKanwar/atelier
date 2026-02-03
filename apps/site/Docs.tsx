import { Box, Code, Link, Stack, Text } from '@chakra-ui/react'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { NavLink, useParams } from 'react-router-dom'

type DocItem = {
  path: string
  title: string
}

type NavSection = {
  title: string
  items: DocItem[]
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
  if (target.startsWith('./') || target.startsWith('../')) {
    const baseDir = currentDoc.includes('/')
      ? currentDoc.slice(0, currentDoc.lastIndexOf('/') + 1)
      : ''
    return normalizeDocPath(`${baseDir}${target}`)
  }
  return normalizeDocPath(target)
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
    const entries = import.meta.glob('./generated/docs/**/*.md', { as: 'raw', eager: true })
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
    return [
      { title: 'Index', items: [{ title: 'Overview', path: 'README.md' }] },
      ...parseIndex(indexContent),
    ]
  }, [indexContent])

  const defaultDoc = 'README.md'
  const rawPath = params['*'] ? decodeURIComponent(params['*']) : defaultDoc
  const normalizedPath = normalizeDocPath(
    rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`
  )
  const resolvedDoc = docs.has(normalizedPath) ? normalizedPath : defaultDoc
  const content = docs.get(resolvedDoc) ?? ''

  return (
    <Box bg="gray.50" minH="100vh">
      <Box maxW="1200px" mx="auto" px={{ base: 5, md: 8 }} py={{ base: 8, md: 10 }}>
        <Stack gap={8} direction={{ base: 'column', lg: 'row' }} align="start">
          <Box
            w={{ base: 'full', lg: '280px' }}
            bg="white"
            borderWidth="1px"
            borderColor="gray.200"
            rounded="lg"
            p={4}
          >
            <Stack gap={5} fontSize="sm">
              {sections.map(section => (
                <Stack key={section.title} gap={2}>
                  <Text fontWeight="semibold" color="gray.800">
                    {section.title}
                  </Text>
                  <Stack gap={1} color="gray.600">
                    {section.items.map(item => (
                      <NavLink
                        key={item.path}
                        to={`/docs/${encodeURI(item.path)}`}
                        style={{ textDecoration: 'none' }}
                      >
                        {({ isActive }) => (
                          <Link
                            fontWeight={isActive ? 'semibold' : 'normal'}
                            color={isActive ? 'gray.900' : 'gray.600'}
                          >
                            {item.title}
                          </Link>
                        )}
                      </NavLink>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Box>

          <Box
            flex="1"
            bg="white"
            borderWidth="1px"
            borderColor="gray.200"
            rounded="lg"
            p={{ base: 5, md: 8 }}
          >
            {content ? (
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <Text fontSize="2xl" fontWeight="semibold" mb={4}>
                      {children}
                    </Text>
                  ),
                  h2: ({ children }) => (
                    <Text fontSize="xl" fontWeight="semibold" mt={6} mb={3}>
                      {children}
                    </Text>
                  ),
                  h3: ({ children }) => (
                    <Text fontSize="lg" fontWeight="semibold" mt={5} mb={2}>
                      {children}
                    </Text>
                  ),
                  p: ({ children }) => (
                    <Text color="gray.700" fontSize="md" mb={4}>
                      {children}
                    </Text>
                  ),
                  li: ({ children }) => (
                    <Text as="li" color="gray.700" mb={2} ml={4}>
                      {children}
                    </Text>
                  ),
                  ul: ({ children }) => (
                    <Box as="ul" mb={4} ml={4} style={{ listStyleType: 'disc' }}>
                      {children}
                    </Box>
                  ),
                  code: ({ children }) => (
                    <Code fontSize="sm" px={1} py={0.5} rounded="md" whiteSpace="pre-wrap">
                      {children}
                    </Code>
                  ),
                  pre: ({ children }) => (
                    <Box
                      as="pre"
                      bg="gray.100"
                      borderWidth="1px"
                      borderColor="gray.200"
                      rounded="md"
                      p={4}
                      fontSize="sm"
                      overflowX="auto"
                      mb={4}
                    >
                      {children}
                    </Box>
                  ),
                  a: ({ children, href }) => {
                    if (!href) {
                      return <Link color="gray.800">{children}</Link>
                    }
                    if (href.startsWith('http')) {
                      return (
                        <Link href={href} color="gray.800" target="_blank" rel="noreferrer">
                          {children}
                        </Link>
                      )
                    }
                    if (href.startsWith('#')) {
                      return (
                        <Link href={href} color="gray.800">
                          {children}
                        </Link>
                      )
                    }
                    if (href.includes('.md')) {
                      const [file, hash] = href.split('#')
                      const resolved = resolveDocPath(resolvedDoc, file)
                      const to = `/docs/${encodeURI(resolved)}${hash ? `#${hash}` : ''}`
                      return (
                        <NavLink to={to} style={{ textDecoration: 'none' }}>
                          <Link color="gray.800">{children}</Link>
                        </NavLink>
                      )
                    }
                    return (
                      <Link href={href} color="gray.800">
                        {children}
                      </Link>
                    )
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            ) : (
              <Text color="gray.500" fontSize="sm">
                Documentation has not been generated yet. Run the docs build first.
              </Text>
            )}
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}

export default Docs
