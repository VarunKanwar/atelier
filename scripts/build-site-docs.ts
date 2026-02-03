import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type NavItem = { title: string; path: string }

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const outputDir = path.join(repoRoot, 'apps/site/generated/docs')

const guidesSrc = path.join(repoRoot, 'docs/guides')
const designSrc = path.join(repoRoot, 'docs/design')
const testingSrc = path.join(repoRoot, 'docs/testing.md')
const apiRefSrc = path.join(repoRoot, 'docs/api-reference.md')

const exists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true })
}

const copyFileIfExists = async (src: string, dest: string) => {
  if (!(await exists(src))) return
  await ensureDir(path.dirname(dest))
  await fs.copyFile(src, dest)
}

const copyMarkdownTree = async (srcDir: string, destDir: string) => {
  if (!(await exists(srcDir))) return
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      await copyMarkdownTree(src, dest)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    await ensureDir(destDir)
    await fs.copyFile(src, dest)
  }
}

const readFileIfExists = async (target: string): Promise<string> => {
  try {
    return await fs.readFile(target, 'utf8')
  } catch {
    return ''
  }
}

const parseMarkdownLinks = (markdown: string): NavItem[] => {
  const items: NavItem[] = []
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\)/)
    if (!match) continue
    const [, title, linkPath] = match
    items.push({ title: title.trim(), path: linkPath.trim() })
  }
  return items
}

const parseDesignIndex = (markdown: string): string[] => {
  const files: string[] = []
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    const match = line.match(/^- ([^:]+\.md):/)
    if (!match) continue
    files.push(match[1].trim())
  }
  return files
}

const extractTitle = (markdown: string, fallback: string): string => {
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('# ')) {
      return line.slice(2).trim()
    }
  }
  return fallback
}

const toNavLines = (items: NavItem[]): string[] =>
  items.map(item => `- [${item.title}](${item.path})`)

const buildGuides = async (): Promise<NavItem[]> => {
  const items: NavItem[] = []
  const guidesReadme = path.join(guidesSrc, 'README.md')
  if (await exists(guidesReadme)) {
    items.push({ title: 'Guides overview', path: 'guides/README.md' })
    const content = await readFileIfExists(guidesReadme)
    const links = parseMarkdownLinks(content)
    for (const link of links) {
      const normalized = link.path.replace(/^\.\//, '')
      const pathWithPrefix = normalized.startsWith('guides/')
        ? normalized
        : `guides/${normalized}`
      items.push({ title: link.title, path: pathWithPrefix })
    }
  }
  return items
}

const buildExplanation = async (): Promise<NavItem[]> => {
  const items: NavItem[] = []
  const designReadme = path.join(designSrc, 'README.md')
  if (await exists(designReadme)) {
    items.push({ title: 'Design notes overview', path: 'design/README.md' })
    const content = await readFileIfExists(designReadme)
    const files = parseDesignIndex(content)
    for (const file of files) {
      const docPath = path.join(designSrc, file)
      const docContent = await readFileIfExists(docPath)
      const title = extractTitle(docContent, file.replace(/\.md$/, ''))
      items.push({ title, path: `design/${file}` })
    }
  }
  if (await exists(testingSrc)) {
    items.push({ title: 'Testing', path: 'testing.md' })
  }
  return items
}

const buildReference = async (): Promise<NavItem[]> => {
  const items: NavItem[] = []
  if (await exists(apiRefSrc)) {
    items.push({ title: 'API reference (overview)', path: 'api-reference.md' })
  }
  const candidates = ['modules.md', 'index.md']
  for (const candidate of candidates) {
    if (await exists(path.join(outputDir, candidate))) {
      items.push({ title: 'API reference (generated)', path: candidate })
      break
    }
  }
  return items
}

const writeIndex = async () => {
  const guides = await buildGuides()
  const explanation = await buildExplanation()
  const reference = await buildReference()

  const lines = [
    '# Documentation',
    '',
    'This section includes practical guides, design notes, and API reference material.',
    '',
    '## Guides',
    ...toNavLines(guides),
    '',
    '## Explanation',
    ...toNavLines(explanation),
    '',
    '## Reference',
    ...toNavLines(reference),
    '',
  ]

  await ensureDir(outputDir)
  await fs.writeFile(path.join(outputDir, 'README.md'), lines.join('\n'))
}

const main = async () => {
  await ensureDir(outputDir)
  await copyMarkdownTree(guidesSrc, path.join(outputDir, 'guides'))
  await copyMarkdownTree(designSrc, path.join(outputDir, 'design'))
  await copyFileIfExists(testingSrc, path.join(outputDir, 'testing.md'))
  await copyFileIfExists(apiRefSrc, path.join(outputDir, 'api-reference.md'))
  await writeIndex()
}

main().catch(error => {
  console.error('Failed to build site docs.')
  console.error(error)
  process.exitCode = 1
})
