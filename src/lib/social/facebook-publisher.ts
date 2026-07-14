/**
 * Facebook Graph API Publisher
 * Handles content publishing to Facebook pages
 */

import { supabase } from '@/lib/supabase';

export interface FacebookPublishInput {
  projectId: string;
  taskId: string;
  sourceId: string;
  caption: string;
  hashtags: string[];
  imageUrl?: string;
  scheduledTime?: Date;
}

export interface FacebookPublishResponse {
  postId: string;
  pageId: string;
  createdTime: string;
  permalink: string;
  scheduledPublishTime?: string;
}

/**
 * Get Facebook page access token from database
 * (exported for factory publish-worker FacebookReelAdapter reuse)
 */
export async function getFacebookPageToken(sourceId: string): Promise<{
  accessToken: string;
  pageId: string;
} | null> {
  try {
    const { data, error } = await supabase
      .from('social_sources')
      .select('id, metadata')
      .eq('id', sourceId)
      .eq('platform', 'facebook')
      .eq('is_active', true)
      .single();

    if (error || !data) {
      throw new Error(`Facebook source not found: ${sourceId}`);
    }

    const metadata = data.metadata as any;
    if (!metadata?.accessToken || !metadata?.pageId) {
      throw new Error('Missing Facebook credentials in source metadata');
    }

    return {
      accessToken: metadata.accessToken,
      pageId: metadata.pageId,
    };
  } catch (error) {
    console.error('[Facebook] Failed to get page token:', error);
    throw error;
  }
}

/**
 * Build Facebook post content
 */
function buildFacebookContent(caption: string, hashtags: string[]): string {
  const hashtagString = hashtags.length > 0 ? `\n\n${hashtags.join(' ')}` : '';
  return caption + hashtagString;
}

/**
 * Publish content to Facebook
 */
export async function publishToFacebook(
  input: FacebookPublishInput
): Promise<FacebookPublishResponse> {
  console.log(`[Facebook] Publishing task ${input.taskId} to Facebook`);

  try {
    // Get page credentials
    const credentials = await getFacebookPageToken(input.sourceId);
    if (!credentials) {
      throw new Error('Could not retrieve Facebook credentials');
    }

    const { accessToken, pageId } = credentials;
    const content = buildFacebookContent(input.caption, input.hashtags);

    // Prepare publish request
    const publishData: Record<string, any> = {
      message: content,
      access_token: accessToken,
    };

    // Add image if provided
    if (input.imageUrl) {
      publishData.link = input.imageUrl;
      // For direct image upload, would need to handle file upload differently
      // For now, we'll use link format
    }

    // Add scheduled publish time if provided
    if (input.scheduledTime && input.scheduledTime > new Date()) {
      const unixTimestamp = Math.floor(input.scheduledTime.getTime() / 1000);
      publishData.published = false;
      publishData.scheduled_publish_time = unixTimestamp;
    }

    // Call Facebook Graph API
    const response = await callFacebookAPI(
      `/v18.0/${pageId}/feed`,
      'POST',
      publishData
    );

    if (!response.id) {
      throw new Error('No post ID returned from Facebook API');
    }

    console.log(`[Facebook] Published successfully. Post ID: ${response.id}`);

    // Log the publication
    await supabase.from('generation_logs').insert([
      {
        project_id: input.projectId,
        task_id: input.taskId,
        operation: 'publish_facebook',
        output_result: {
          postId: response.id,
          pageId: pageId,
          permalink: `https://facebook.com/${response.id}`,
        },
        cost_usd: 0,
        status: 'success',
      },
    ]);

    return {
      postId: response.id,
      pageId: pageId,
      createdTime: new Date().toISOString(),
      permalink: `https://facebook.com/${response.id}`,
      scheduledPublishTime: input.scheduledTime?.toISOString(),
    };
  } catch (error) {
    console.error('[Facebook] Publishing failed:', error);

    // Log the failure
    await supabase.from('generation_logs').insert([
      {
        project_id: input.projectId,
        task_id: input.taskId,
        operation: 'publish_facebook',
        cost_usd: 0,
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      },
    ]);

    throw error;
  }
}

/**
 * Call Facebook Graph API
 */
async function callFacebookAPI(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  data?: Record<string, any>
): Promise<any> {
  const url = `https://graph.facebook.com${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `Facebook API error: ${errorData.error?.message || response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error('[Facebook API] Call failed:', error);
    throw error;
  }
}

/**
 * Refresh Facebook access token (for long-lived tokens)
 */
export async function refreshFacebookToken(sourceId: string): Promise<string> {
  console.log(`[Facebook] Refreshing token for source ${sourceId}`);

  try {
    const { data: source, error } = await supabase
      .from('social_sources')
      .select('metadata')
      .eq('id', sourceId)
      .eq('platform', 'facebook')
      .single();

    if (error || !source) {
      throw new Error('Facebook source not found');
    }

    const metadata = source.metadata as any;
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!appId || !appSecret) {
      throw new Error('Missing Facebook app credentials in environment');
    }

    const response = await callFacebookAPI(
      `/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${metadata.accessToken}`,
      'GET'
    );

    if (!response.access_token) {
      throw new Error('Failed to refresh token');
    }

    // Update in database
    const { error: updateError } = await supabase
      .from('social_sources')
      .update({
        metadata: {
          ...metadata,
          accessToken: response.access_token,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', sourceId);

    if (updateError) {
      throw updateError;
    }

    console.log(`[Facebook] Token refreshed successfully`);
    return response.access_token;
  } catch (error) {
    console.error('[Facebook] Token refresh failed:', error);
    throw error;
  }
}

/**
 * Get engagement metrics for a post
 */
export async function getFacebookPostMetrics(
  postId: string,
  accessToken: string
): Promise<{
  likes: number;
  comments: number;
  shares: number;
}> {
  try {
    const response = await callFacebookAPI(
      `/${postId}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${accessToken}`,
      'GET'
    );

    return {
      likes: response.likes?.summary?.total_count || 0,
      comments: response.comments?.summary?.total_count || 0,
      shares: response.shares?.data?.length || 0,
    };
  } catch (error) {
    console.error('[Facebook] Failed to get post metrics:', error);
    throw error;
  }
}
