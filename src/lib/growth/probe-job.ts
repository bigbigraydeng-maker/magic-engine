// probe: trial-run gate check — do not merge
import { inngest } from '../inngest/client'

export const probeJob = inngest.createFunction({ id: 'probe-do-not-merge' }, { event: 'probe/never' }, async () => null)
