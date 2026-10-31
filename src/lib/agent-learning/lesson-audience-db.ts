import { supabaseAdmin } from '@/lib/supabase'
import type { AudienceStore } from '@/lib/agent-learning/lesson-audience'

function warn(step: string, lessonKey: string): void {
  console.warn(`[lesson-audience] ${step} failed`, lessonKey)
}

/** Service-role adapter. Evidence is replaced as a whole object, so callers must merge first. */
export function supabaseAudienceStore(): AudienceStore {
  return {
    async readLesson(lessonKey) {
      const { data, error } = await supabaseAdmin
        .from('global_learned_lessons')
        .select('evidence')
        .eq('lesson_key', lessonKey)
        .maybeSingle()
      if (error) {
        warn('read', lessonKey)
        return { found: false, evidence: null, error: '没能读取这条经验' }
      }
      if (!data) return { found: false, evidence: null }
      return { found: true, evidence: (data as { evidence: unknown }).evidence }
    },
    async clientExists(clientId) {
      const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .maybeSingle()
      if (error) return { exists: false, error: '没能核对客户' }
      return { exists: data !== null }
    },
    async writeLesson(lessonKey, isActive, evidence) {
      const { error } = await supabaseAdmin
        .from('global_learned_lessons')
        .update({ is_active: isActive, evidence, updated_at: new Date().toISOString() })
        .eq('lesson_key', lessonKey)
      if (error) {
        warn('write', lessonKey)
        return { error: '没能保存，请再试一次' }
      }
      return {}
    },
  }
}
