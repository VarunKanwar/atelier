import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type NavItem = { title: string; path: string }

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const outputDir = path.join(repoRoot, 'apps/site/generated/docs')

const guidesSrc = path.join(repoRoot, 'docs/guides')
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

const copyMarkdownTree = async (
  srcDir: string,
  destDir: string,
  options?: { skip?: (entryPath: string, entry: fs.Dirent) => boolean }
) => {
  if (!(await exists(srcDir))) return
  const entries = await fs.readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (options?.skip?.(src, entry)) continue
    if (entry.isDirectory()) {
      await copyMarkdownTree(src, dest, options)
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

const isExternalLink = (linkPath: string): boolean => /^https?:\/\//.test(linkPath)

const toNavLines = (items: NavItem[]): string[] =>
  items.map(item => `- [${item.title}](${item.path})`)

const buildGuides = async (): Promise<NavItem[]> => {
  const items: NavItem[] = []
  const guidesReadme = path.join(guidesSrc, 'README.md')
  if (await exists(guidesReadme)) {
    const content = await readFileIfExists(guidesReadme)
    const links = parseMarkdownLinks(content)
    for (const link of links) {
      if (isExternalLink(link.path)) continue
      if (link.path.startsWith('#')) continue
      if (link.path === 'README.md') continue
      const normalized = link.path.replace(/^\.\//, '')
      const pathWithPrefix = normalized.startsWith('guides/')
        ? normalized
        : `guides/${normalized}`
      items.push({ title: link.title, path: pathWithPrefix })
    }
  }
  return items
}

const buildReference = async (): Promise<NavItem[]> => {
  const items: NavItem[] = []
  if (await exists(apiRefSrc)) {
    items.push({ title: 'API reference', path: 'api-reference.md' })
  }
  return items
}

const writeIndex = async () => {
  const guides = await buildGuides()
  const reference = await buildReference()
  const lines: string[] = [
    '# Documentation',
    '',
    'Start with the guides and use the API reference when you need signatures or defaults.',
    '',
  ]
  if (guides.length > 0) {
    lines.push('## Guides', ...toNavLines(guides), '')
  }
  if (reference.length > 0) {
    lines.push('## Reference', ...toNavLines(reference), '')
  }

  await ensureDir(outputDir)
  await fs.writeFile(path.join(outputDir, 'README.md'), lines.join('\n'))
}

const main = async () => {
  await fs.rm(outputDir, { recursive: true, force: true })
  await ensureDir(outputDir)
  await copyMarkdownTree(guidesSrc, path.join(outputDir, 'guides'), {
    skip: (_path, entry) => entry.isFile() && entry.name === 'README.md',
  })
  await copyFileIfExists(apiRefSrc, path.join(outputDir, 'api-reference.md'))
  await writeIndex()
}

main().catch(error => {
  console.error('Failed to build site docs.')
  console.error(error)
  process.exitCode = 1
})
