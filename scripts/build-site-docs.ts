import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type NavItem = { title: string; path: string }
type ManifestSection = { title: string; items: NavItem[] }
type Manifest = { intro?: string; sections: ManifestSection[] }

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const outputDir = path.join(repoRoot, 'apps/site/generated/docs')

const docsRoot = path.join(repoRoot, 'docs')
const manifestPath = path.join(docsRoot, 'site-manifest.json')

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

const readManifest = async (): Promise<Manifest> => {
  const raw = await fs.readFile(manifestPath, 'utf8')
  const data = JSON.parse(raw) as Manifest
  if (!data.sections || !Array.isArray(data.sections)) {
    throw new Error('site-manifest.json must include a sections array.')
  }
  return data
}

const normalizeManifestPath = (value: string): string => value.trim().replace(/^\.\//, '')

const isLocalDocPath = (value: string): boolean => {
  if (!value.endsWith('.md')) return false
  if (/^[a-zA-Z]+:\/\//.test(value)) return false
  if (value.startsWith('#')) return false
  return true
}

const assertValidDocPath = (value: string): string => {
  const normalized = normalizeManifestPath(value)
  if (!isLocalDocPath(normalized)) {
    throw new Error(`Invalid doc path in site-manifest.json: ${value}`)
  }
  const posix = path.posix.normalize(normalized)
  if (path.posix.isAbsolute(posix) || posix.startsWith('..')) {
    throw new Error(`Invalid doc path in site-manifest.json: ${value}`)
  }
  return posix
}

const toNavLines = (items: NavItem[]): string[] =>
  items.map(item => `- [${item.title}](${item.path})`)

const copyDocFile = async (docPath: string) => {
  const segments = docPath.split('/')
  const src = path.join(docsRoot, ...segments)
  const dest = path.join(outputDir, ...segments)
  if (!(await exists(src))) {
    throw new Error(`Missing doc referenced in site-manifest.json: ${docPath}`)
  }
  await ensureDir(path.dirname(dest))
  await fs.copyFile(src, dest)
}

const writeIndex = async (manifest: Manifest) => {
  const lines: string[] = ['# Documentation', '']
  if (manifest.intro) {
    lines.push(manifest.intro, '')
  }
  for (const section of manifest.sections) {
    if (!section.items || section.items.length === 0) continue
    lines.push(`## ${section.title}`, ...toNavLines(section.items), '')
  }
  await ensureDir(outputDir)
  await fs.writeFile(path.join(outputDir, 'README.md'), lines.join('\n'))
}

const main = async () => {
  await fs.rm(outputDir, { recursive: true, force: true })
  await ensureDir(outputDir)
  const manifest = await readManifest()
  const seen = new Set<string>()
  for (const section of manifest.sections) {
    if (!section.items || !Array.isArray(section.items)) continue
    for (const item of section.items) {
      const docPath = assertValidDocPath(item.path)
      item.path = docPath
      if (seen.has(docPath)) continue
      seen.add(docPath)
      await copyDocFile(docPath)
    }
  }
  await writeIndex(manifest)
}

main().catch(error => {
  console.error('Failed to build site docs.')
  console.error(error)
  process.exitCode = 1
})
