export { runAnomalyDetector, scanClient } from './AnomalyDetectorJob'
export { ANOMALY_RULES, MONITORED_METRICS } from './rules'
export type { AnomalySignal, AnomalyRule, AnomalySeverity, FlywheelName, MetricDataPoint } from './types'

// Standing watchers — recency/continuity detection, as opposed to the
// value-threshold rules above. See WatcherJob.ts for why both exist.
export { runWatchers, runWatchersOverSnapshot, buildClientSnapshot } from './WatcherJob'
export type { WatcherRunResult, ClientSnapshot } from './WatcherJob'
export { fetchServicedClients } from './roster'
export type { RosterClient, RosterResult } from './roster'
export { classifyDisposition } from './disposition'
export type { Disposition, RemedyProfile, DispositionVerdict } from './disposition'
export type { WatchSignal } from './watchers/types'
