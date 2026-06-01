'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { fetchFeedback } from '@/lib/api/feedback';
import { PROJECT_ID } from '@/lib/config';
import { StatsCard } from '@/components/dashboard/stats-card';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const TIME_RANGES = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
];

export default function AnalyticsPage() {
  const [daysBack, setDaysBack] = useState(7);
  const { data, loading, error } = useApi(() => fetchFeedback(PROJECT_ID, daysBack), [daysBack]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">Analytics</h1>
        <div className="flex gap-2">
          {TIME_RANGES.map((r) => (
            <Button
              key={r.value}
              variant={daysBack === r.value ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setDaysBack(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <Card>
          <p className="text-sm text-me-charcoal/45 text-center py-8">
            No analytics data available yet. Generate and publish content to see analytics.
          </p>
        </Card>
      ) : data ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatsCard label="Total Posts" value={data.totalPosts} />
            <StatsCard label="Total Engagement" value={data.totalEngagement} />
            <StatsCard label="Avg Score" value={data.averageScore.toFixed(1)} />
          </div>

          {/* Platform Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Facebook">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-me-charcoal/45">Posts</span>
                  <span className="text-me-charcoal/25">{data.platformBreakdown.facebook.posts}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-me-charcoal/45">Engagement</span>
                  <span className="text-me-charcoal/25">{data.platformBreakdown.facebook.engagement}</span>
                </div>
              </div>
            </Card>
            <Card title="Xiaohongshu">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-me-charcoal/45">Posts</span>
                  <span className="text-me-charcoal/25">{data.platformBreakdown.xiaohongshu.posts}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-me-charcoal/45">Engagement</span>
                  <span className="text-me-charcoal/25">{data.platformBreakdown.xiaohongshu.engagement}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Top Posts */}
          <Card title="Top Posts">
            {data.topPosts.length === 0 ? (
              <p className="text-sm text-me-charcoal/55">No posts collected yet.</p>
            ) : (
              <div className="space-y-3">
                {data.topPosts.map((post) => (
                  <div key={post.id} className="p-3 bg-me-charcoal/30 rounded">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant={post.platform === 'facebook' ? 'info' : 'error'}>{post.platform}</Badge>
                      <span className="text-xs text-me-charcoal/55">{new Date(post.collected_at).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm text-me-charcoal/25 line-clamp-2">{post.content}</p>
                    <div className="flex gap-4 mt-2 text-xs text-me-charcoal/45">
                      <span>{post.metrics.likes} likes</span>
                      <span>{post.metrics.comments} comments</span>
                      <span>{post.metrics.shares} shares</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
