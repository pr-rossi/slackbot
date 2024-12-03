import { WebClient } from '@slack/web-api';
import Pusher from 'pusher';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
});

let emojiCache = null;
const EMOJI_CACHE_DURATION = 1000 * 60 * 60; // 1 hour
let lastEmojiFetch = 0;

const SLACK_TO_UNICODE_MAP = {
  '👍': 'thumbsup',
  '👎': 'thumbsdown',
  '✅': 'white_check_mark',
  '❤️': 'heart',
  'thumbsup': '👍',
  '+1': '👍',
  'thumbsdown': '👎',
  '-1': '👎',
  'white_check_mark': '✅',
  'white_check_ma': 'white_check_mark',
  'white_check_mark_1': 'white_check_mark',
  'heart': '❤️'
};

const normalizeEmoji = (emoji, forSlackApi = false) => {
  // Remove any numbers and underscores from the end of the emoji name
  const cleanEmoji = emoji.replace(/[0-9_]+$/, '').replace(/:/g, '');
  
  if (forSlackApi) {
    // For Slack API, we need the name, not the Unicode
    return SLACK_TO_UNICODE_MAP[cleanEmoji] || 
           (SLACK_TO_UNICODE_MAP[emoji] || cleanEmoji);
  }
  
  // For display/storage, we want the Unicode
  return SLACK_TO_UNICODE_MAP[cleanEmoji] || 
         SLACK_TO_UNICODE_MAP[emoji] || 
         emoji;
};

async function getSlackEmojis() {
  if (emojiCache && (Date.now() - lastEmojiFetch) < EMOJI_CACHE_DURATION) {
    return emojiCache;
  }

  try {
    const response = await fetch('https://slack.com/api/emoji.list', {
      headers: {
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Failed to fetch Slack emojis:', data.error);
      return emojiCache || {};
    }

    emojiCache = data.emoji;
    lastEmojiFetch = Date.now();
    return emojiCache;
  } catch (error) {
    console.error('Error fetching Slack emojis:', error);
    return emojiCache || {};
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') return res.status(405).end();
  
  const client = new WebClient(process.env.SLACK_BOT_TOKEN);
  
  try {
    // Handle reactions
    if (req.body.type === 'reaction' || req.body.type === 'remove_reaction') {
      console.log('Handling reaction:', req.body);
      
      // Clean up the emoji input
      let emojiName = req.body.emoji;
      const normalizedEmojiForDisplay = normalizeEmoji(emojiName);
      const normalizedEmojiForApi = normalizeEmoji(emojiName, true);
      
      try {
        let result;
        if (req.body.type === 'reaction') {
          console.log('Adding reaction with name:', normalizedEmojiForApi);
          try {
            result = await client.reactions.add({
              channel: process.env.SLACK_CHANNEL_ID,
              timestamp: req.body.thread_ts,
              name: normalizedEmojiForApi
            });
          } catch (error) {
            if (error.data?.error === 'already_reacted') {
              result = await client.reactions.remove({
                channel: process.env.SLACK_CHANNEL_ID,
                timestamp: req.body.thread_ts,
                name: normalizedEmojiForApi
              });
            } else {
              throw error;
            }
          }
        } else {
          result = await client.reactions.remove({
            channel: process.env.SLACK_CHANNEL_ID,
            timestamp: req.body.thread_ts,
            name: normalizedEmojiForApi
          });
        }

        if (req.body.type === 'reaction') {
          await pusher.trigger('pushrefresh-chat', 'reaction', {
            emoji: normalizedEmojiForDisplay,
            count: 1,
            thread_ts: req.body.thread_ts
          });
        }

        return res.status(200).json({ 
          success: true,
          action: req.body.type === 'reaction' ? 'added' : 'removed',
          details: result,
          emojiName: normalizedEmojiForDisplay
        });
      } catch (error) {
        console.error('Slack API Error:', error);
        return res.status(500).json({ 
          error: `An API error occurred: ${error.data?.error || error.message}`,
          details: error.data,
          emojiName: normalizedEmojiForDisplay
        });
      }
    }

    // Handle regular messages
    const result = await client.chat.postMessage({
      channel: process.env.SLACK_CHANNEL_ID,
      text: req.body.message,
      thread_ts: req.body.thread_ts || undefined
    });

    res.status(200).json({ 
      success: true,
      thread_ts: result.ts,
      ts: result.ts // Add this to ensure we have the message timestamp
    });
  } catch (error) {
    console.error('General Error:', error);
    res.status(500).json({ error: error.message });
  }
}