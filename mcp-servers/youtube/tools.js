/**
 * YouTube MCP tool implementations — pure JS, no MCP coupling.
 *
 * Each tool returns { content: [{type:'text', text: <string|object>}], isError?: bool }
 * in the MCP format, so both the MCP-SDK transport AND direct HTTP callers
 * can share these.
 *
 * Matches the 6 tools we documented in README.md:
 *   - youtube_channel_stats(channelId)
 *   - youtube_video_stats(videoId)
 *   - youtube_my_channel()
 *   - youtube_my_recent_videos(maxResults)
 *   - youtube_search_videos(query, channelId?, maxResults, order)
 *   - youtube_my_analytics(metrics, days)
 */

import { google } from 'googleapis';

// OAuth + API-Key helpers are imported from auth.js (shared with server.js)
import {
  makeOAuth2Client,
  loadSavedToken,
  saveToken,
  hasValidToken,
  getAuthenticatedOAuth2,
  youtubeApiKey,
  youtubeOAuth,
  youtubeAnalytics,
} from './auth.js';

// ─── Tool: youtube_channel_stats ────────────────────────────────────────────
export async function youtubeChannelStats({ channelId }) {
  const yt = youtubeApiKey();
  let resolvedId = channelId;
  if (channelId.startsWith('@')) {
    const res = await yt.channels.list({ part: ['id'], forHandle: channelId.slice(1) });
    if (!res.data.items?.length) {
      return { isError: true, content: [{ type: 'text', text: `No channel for handle ${channelId}` }] };
    }
    resolvedId = res.data.items[0].id;
  }
  const res = await yt.channels.list({
    part: ['snippet', 'statistics', 'contentDetails'],
    id: [resolvedId],
  });
  if (!res.data.items?.length) {
    return { isError: true, content: [{ type: 'text', text: `Channel ${resolvedId} not found` }] };
  }
  const ch = res.data.items[0];
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        channelId: ch.id,
        title: ch.snippet.title,
        description: ch.snippet.description?.substring(0, 500),
        customUrl: ch.snippet.customUrl,
        thumbnail: ch.snippet.thumbnails?.default?.url,
        country: ch.snippet.country,
        publishedAt: ch.snippet.publishedAt,
        subscribers: parseInt(ch.statistics.subscriberCount, 10),
        views: parseInt(ch.statistics.viewCount, 10),
        videos: parseInt(ch.statistics.videoCount, 10),
        hiddenSubscribers: ch.statistics.hiddenSubscriberCount,
        uploadsPlaylist: ch.contentDetails.relatedPlaylists.uploads,
      }, null, 2),
    }],
  };
}

// ─── Tool: youtube_video_stats ──────────────────────────────────────────────
export async function youtubeVideoStats({ videoId }) {
  const yt = youtubeApiKey();
  const res = await yt.videos.list({
    part: ['snippet', 'statistics', 'contentDetails', 'status'],
    id: [videoId],
  });
  if (!res.data.items?.length) {
    return { isError: true, content: [{ type: 'text', text: `Video ${videoId} not found` }] };
  }
  const v = res.data.items[0];
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        videoId: v.id,
        title: v.snippet.title,
        description: v.snippet.description?.substring(0, 500),
        channelId: v.snippet.channelId,
        channelTitle: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
        duration: v.contentDetails.duration,
        definition: v.contentDetails.definition,
        views: parseInt(v.statistics.viewCount, 10),
        likes: parseInt(v.statistics.likeCount, 10),
        comments: parseInt(v.statistics.commentCount, 10),
        tags: v.snippet.tags || [],
        thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.default?.url,
        madeForKids: v.status.madeForKids,
      }, null, 2),
    }],
  };
}

// ─── Tool: youtube_my_channel ───────────────────────────────────────────────
export async function youtubeMyChannel() {
  const oauth2 = await getAuthenticatedOAuth2();
  const yt = await youtubeOAuth(oauth2);
  const res = await yt.channels.list({
    part: ['snippet', 'statistics', 'contentDetails'],
    mine: true,
  });
  if (!res.data.items?.length) {
    return { isError: true, content: [{ type: 'text', text: 'No authenticated channel.' }] };
  }
  const ch = res.data.items[0];
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        channelId: ch.id,
        title: ch.snippet.title,
        customUrl: ch.snippet.customUrl,
        thumbnail: ch.snippet.thumbnails?.default?.url,
        subscribers: parseInt(ch.statistics.subscriberCount, 10),
        views: parseInt(ch.statistics.viewCount, 10),
        videos: parseInt(ch.statistics.videoCount, 10),
        hiddenSubscribers: ch.statistics.hiddenSubscriberCount,
        uploadsPlaylist: ch.contentDetails.relatedPlaylists.uploads,
      }, null, 2),
    }],
  };
}

// ─── Tool: youtube_my_recent_videos ─────────────────────────────────────────
export async function youtubeMyRecentVideos({ maxResults = 10 }) {
  const oauth2 = await getAuthenticatedOAuth2();
  const yt = await youtubeOAuth(oauth2);
  const chRes = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const uploads = chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    return { isError: true, content: [{ type: 'text', text: 'No uploads playlist.' }] };
  }
  const plRes = await yt.playlistItems.list({
    part: ['contentDetails', 'snippet'],
    playlistId: uploads,
    maxResults,
  });
  const videos = await Promise.all(
    plRes.data.items.map(async (item) => {
      const vRes = await yt.videos.list({
        part: ['statistics', 'contentDetails'],
        id: [item.contentDetails.videoId],
      });
      const s = vRes.data.items?.[0]?.statistics || {};
      const d = vRes.data.items?.[0]?.contentDetails || {};
      return {
        videoId: item.contentDetails.videoId,
        title: item.snippet.title,
        publishedAt: item.contentDetails.videoPublishedAt,
        duration: d.duration,
        views: parseInt(s.viewCount, 10) || 0,
        likes: parseInt(s.likeCount, 10) || 0,
        comments: parseInt(s.commentCount, 10) || 0,
      };
    })
  );
  return { content: [{ type: 'text', text: JSON.stringify(videos, null, 2) }] };
}

// ─── Tool: youtube_search_videos ────────────────────────────────────────────
export async function youtubeSearchVideos({
  query,
  channelId,
  maxResults = 10,
  order = 'relevance',
}) {
  const yt = youtubeApiKey();
  const params = { part: ['snippet'], q: query, type: ['video'], maxResults, order };
  if (channelId) params.channelId = channelId;
  const res = await yt.search.list(params);
  const items = (res.data.items || []).map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    description: item.snippet.description?.substring(0, 200),
    thumbnail: item.snippet.thumbnails?.default?.url,
  }));
  return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
}

// ─── Tool: youtube_my_analytics ─────────────────────────────────────────────
export async function youtubeMyAnalytics({
  metrics = 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
  days = 28,
}) {
  const oauth2 = await getAuthenticatedOAuth2();
  const yt = await youtubeOAuth(oauth2);
  const ya = await youtubeAnalytics(oauth2);
  const chRes = await yt.channels.list({ part: ['id'], mine: true });
  const channelId = chRes.data.items?.[0]?.id;
  if (!channelId) {
    return { isError: true, content: [{ type: 'text', text: 'No channel.' }] };
  }
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);
  const res = await ya.reports.query({
    ids: `channel==${channelId}`,
    startDate,
    endDate,
    metrics,
  });
  return { content: [{ type: 'text', text: JSON.stringify(res.data, null, 2) }] };
}

// ─── Registry ───────────────────────────────────────────────────────────────
export const TOOLS = {
  youtube_channel_stats: {
    handler: youtubeChannelStats,
    description: 'Get snippet + statistics for a public YouTube channel by ID or @handle',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'YouTube channel ID (UC...) or @handle' },
      },
      required: ['channelId'],
    },
  },
  youtube_video_stats: {
    handler: youtubeVideoStats,
    description: 'Get stats + contentDetails for a YouTube video',
    inputSchema: {
      type: 'object',
      properties: { videoId: { type: 'string', description: 'YouTube video ID' } },
      required: ['videoId'],
    },
  },
  youtube_my_channel: {
    handler: youtubeMyChannel,
    description: 'Get own channel identity + stats (OAuth required)',
    inputSchema: { type: 'object', properties: {} },
  },
  youtube_my_recent_videos: {
    handler: youtubeMyRecentVideos,
    description: 'Get own latest uploads with per-video stats (OAuth)',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  youtube_search_videos: {
    handler: youtubeSearchVideos,
    description: 'Search YouTube, optionally filtered to one channel',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        channelId: { type: 'string' },
        maxResults: { type: 'number', minimum: 1, maximum: 50, default: 10 },
        order: { type: 'string', enum: ['date', 'rating', 'relevance', 'viewCount'] },
      },
      required: ['query'],
    },
  },
  youtube_my_analytics: {
    handler: youtubeMyAnalytics,
    description: 'YouTube Analytics for own channel (OAuth)',
    inputSchema: {
      type: 'object',
      properties: {
        metrics: { type: 'string' },
        days: { type: 'number', minimum: 1, maximum: 365, default: 28 },
      },
    },
  },
};

export async function callTool(name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
  try {
    return await tool.handler(args);
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: 'Error: ' + err.message }] };
  }
}
