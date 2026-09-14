import 'dotenv/config';
import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN_PATH = '/home/dirk/contentix/mcp-servers/youtube/data/oauth-token.json';
const t = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:8190/auth/callback'
);
oauth2.setCredentials(t);
oauth2.on('tokens', (newTokens) => {
  if (newTokens.refresh_token) t.refresh_token = newTokens.refresh_token;
  if (newTokens.access_token) t.access_token = newTokens.access_token;
  if (newTokens.expiry_date) t.expiry_date = newTokens.expiry_date;
  writeFileSync(TOKEN_PATH, JSON.stringify(t, null, 2));
});

async function main() {
  console.log('=== Test 1: youtube_my_recent_videos (eigene letzten 5) ===');
  const yt = google.youtube({ version: 'v3', auth: oauth2 });
  const chRes = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const uploads = chRes.data.items[0].contentDetails.relatedPlaylists.uploads;
  const plRes = await yt.playlistItems.list({
    part: ['contentDetails', 'snippet'],
    playlistId: uploads,
    maxResults: 5,
  });
  for (const item of plRes.data.items) {
    const vRes = await yt.videos.list({
      part: ['statistics', 'contentDetails'],
      id: [item.contentDetails.videoId],
    });
    const s = vRes.data.items[0].statistics;
    console.log('  ' + item.snippet.title.substring(0, 55));
    console.log('    views: ' + s.viewCount + ', likes: ' + s.likeCount + ', comments: ' + s.commentCount);
  }

  console.log('\n=== Test 2: youtube_channel_stats (Linus Tech Tips) ===');
  const ytApiKey = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
  const lttRes = await ytApiKey.channels.list({
    part: ['snippet', 'statistics'],
    forUsername: 'LinusTechTips',
  });
  if (lttRes.data.items?.length) {
    const c = lttRes.data.items[0];
    console.log('  Title: ' + c.snippet.title);
    console.log('  Subscribers: ' + parseInt(c.statistics.subscriberCount).toLocaleString());
    console.log('  Views: ' + parseInt(c.statistics.viewCount).toLocaleString());
    console.log('  Videos: ' + c.statistics.videoCount);
  } else {
    console.log('  (nicht gefunden)');
  }

  console.log('\n=== Test 3: youtube_search_videos (Linux Mint auf The Dirk) ===');
  const searchRes = await ytApiKey.search.list({
    part: ['snippet'],
    q: 'Linux Mint',
    channelId: 'UC-YmLEIgdESaoVN3ZKNT_QA',
    type: ['video'],
    maxResults: 3,
    order: 'date',
  });
  for (const item of searchRes.data.items || []) {
    console.log('  ' + item.snippet.title.substring(0, 60));
    console.log('    ' + item.snippet.publishedAt + ' | ' + item.id.videoId);
  }

  console.log('\n=== Test 4: youtube_my_analytics (eigene letzte 28d) ===');
  const ya = google.youtubeAnalytics({ version: 'v2', auth: oauth2 });
  const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);
  const anaRes = await ya.reports.query({
    ids: 'channel==UC-YmLEIgdESaoVN3ZKNT_QA',
    startDate,
    endDate,
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained',
  });
  console.log(JSON.stringify(anaRes.data, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  if (err.response) console.error('Response:', err.response.data);
  process.exit(1);
});
