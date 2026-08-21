import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const plugin = readFileSync(join(
  process.cwd(),
  'integrations/wordpress/magic-engine-page-apply/magic-engine-page-apply.php',
), 'utf8')

describe('Magic Engine WordPress CAS plugin contract', () => {
  it('uses a transaction and row lock for the exact post version', () => {
    expect(plugin).toContain("$wpdb->query('START TRANSACTION')")
    expect(plugin).toContain('FOR UPDATE')
    expect(plugin).toContain("$wpdb->query('COMMIT')")
    expect(plugin).toContain("$wpdb->query('ROLLBACK')")
    expect(plugin).toContain('hash_equals($previous_modified, $expected)')
    expect(plugin).toContain('hash_equals($live_meta[$key], $value)')
    expect(plugin).toContain('FROM {$wpdb->postmeta}')
  })

  it('allows only the two governed Yoast meta keys', () => {
    expect(plugin).toContain("'_yoast_wpseo_title'")
    expect(plugin).toContain("'_yoast_wpseo_metadesc'")
    expect(plugin).not.toContain("'_yoast_wpseo_focuskw'")
    expect(plugin).toContain("array_keys($update) !== array('meta')")
  })

  it('fails the capability probe closed without transactional tables', () => {
    expect(plugin).toContain("strtoupper((string) $row->Engine) !== 'INNODB'")
    expect(plugin).toContain("'atomic_compare_and_set' => magic_engine_page_apply_tables_are_transactional()")
  })
})
