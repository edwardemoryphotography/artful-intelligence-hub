/**
 * Static enforcement of the exposure contract at the source.
 *
 * exposure.test.ts guards the client at runtime. This guards the migrations at
 * commit time: any anon-granted function that so much as names a user-content
 * column fails the suite, before it can ever be applied to foundry-console.
 *
 * This is the check that would have caught a widening migration written by an
 * agent who never read the contract — which is the exact failure mode the
 * SECURITY DEFINER + anon grant combination invites.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORBIDDEN_FIELDS } from '../exposure'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/** Strip `--` line comments so the contract prose doesn't trip its own test. */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
}

/** Functions we deliberately grant to anon. These carry the whole contract. */
const ANON_GRANTED = /grant\s+execute\s+on\s+function\s+([a-z_.()\s]*?)\s+to\s+[^;]*\banon\b/gi

describe('migration exposure contract', () => {
  const files = migrationFiles()

  it('finds the migrations directory', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s does not expose user-content columns', (file) => {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    for (const field of FORBIDDEN_FIELDS) {
      const hit = new RegExp(`\\b${field}\\b`, 'i').test(sql)
      expect(
        hit,
        `${file} references "${field}". Anon-granted functions must return coarse ` +
          `aggregates only — see the exposure contract in supabase/migrations/` +
          `20260810020000_constellation_ladder.sql.`,
      ).toBe(false)
    }
  })

  it('every anon-granted function is one of the two reviewed constellation functions', () => {
    // A new anon-granted function is a deliberate security decision. Adding one
    // should require editing this list, which forces the author to look at the
    // exposure contract first.
    const reviewed = new Set(['public.constellation_status()', 'public.constellation_ladder()'])
    const found = new Set<string>()

    for (const file of files) {
      const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      for (const match of sql.matchAll(ANON_GRANTED)) {
        found.add(match[1].trim().replace(/\s+/g, ''))
      }
    }

    for (const fn of found) {
      expect(
        reviewed.has(fn),
        `${fn} is granted to anon but is not in the reviewed set. Adding an ` +
          `anon-callable function widens the public attack surface — review its ` +
          `exposure contract, then add it here deliberately.`,
      ).toBe(true)
    }
  })

  it('constellation_ladder is SECURITY DEFINER with a pinned search_path', () => {
    const sql = readFileSync(
      join(MIGRATIONS_DIR, '20260810020000_constellation_ladder.sql'),
      'utf8',
    )
    // An unpinned search_path on a SECURITY DEFINER function is a privilege
    // escalation vector: a caller-controlled schema can shadow the tables.
    expect(sql).toMatch(/security\s+definer/i)
    expect(sql).toMatch(/set\s+search_path\s*=\s*public/i)
  })

  it('ladder_rules and ladder_territories deny browser writes', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '20260810010000_ladder_rules.sql'), 'utf8')
    expect(sql).toMatch(/alter\s+table\s+ladder_rules\s+enable\s+row\s+level\s+security/i)
    expect(sql).toMatch(/alter\s+table\s+ladder_territories\s+enable\s+row\s+level\s+security/i)
    // Only SELECT may be granted to the browser roles.
    const grants = [...sql.matchAll(/grant\s+([a-z, ]+)\s+on\s+table[^;]*to\s+([^;]*);/gi)]
    for (const [, privileges, roles] of grants) {
      if (/anon|authenticated/i.test(roles)) {
        expect(privileges.trim().toLowerCase()).toBe('select')
      }
    }
  })
})
