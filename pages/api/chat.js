import { WebClient } from '@slack/web-api';
import Pusher from 'pusher';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
});

const SLACK_TO_UNICODE_MAP = {
  // Define both directions for each emoji
  'thumbsup': '👍',
  '👍': 'thumbsup',
  
  'heart': '❤️',
  '❤️': 'heart',
  
  'tada': '🎉',
  '🎉': 'tada',
  
  'rocket': '🚀',
  '🚀': 'rocket',
};

const normalizeEmoji = (emoji, forSlackApi = false) => {
  const cleanEmoji = emoji.replace(/[0-9_]+$/, '').replace(/:/g, '');
  
  if (forSlackApi) {
      // When sending to Slack API, convert Unicode to Slack name
      return SLACK_TO_UNICODE_MAP[cleanEmoji] || cleanEmoji;
  }
  
  // When displaying, convert Slack name to Unicode
  return SLACK_TO_UNICODE_MAP[cleanEmoji] || emoji;
};

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
    if (req.body.type === 'reaction' || req.body.type === 'remove_reaction') {
      const emojiName = req.body.emoji;
      const normalizedEmojiForApi = normalizeEmoji(emojiName, true);
      
      try {
        if (req.body.type === 'reaction') {
          try {
            await client.reactions.add({
              channel: process.env.SLACK_CHANNEL_ID,
              timestamp: req.body.thread_ts,
              name: normalizedEmojiForApi
            });
          } catch (error) {
            if (error.data?.error === 'already_reacted') {
              await client.reactions.remove({
                channel: process.env.SLACK_CHANNEL_ID,
                timestamp: req.body.thread_ts,
                name: normalizedEmojiForApi
              });
              return res.status(200).json({ 
                success: true,
                action: 'removed'
              });
            }
            throw error;
          }
        } else {
          try {
            await client.reactions.remove({
              channel: process.env.SLACK_CHANNEL_ID,
              timestamp: req.body.thread_ts,
              name: normalizedEmojiForApi
            });
          } catch (error) {
            if (error.data?.error === 'no_reaction') {
              return res.status(200).json({
                success: true,
                action: 'already_removed'
              });
            }
            throw error;
          }
        }

        return res.status(200).json({ 
          success: true,
          action: req.body.type === 'reaction' ? 'added' : 'removed'
        });
      } catch (error) {
        console.error('Slack API Error Details:', {
          error: error.data?.error,
          emojiName: normalizedEmojiForApi,
          originalEmoji: emojiName
        });
        return res.status(200).json({ 
          success: false,
          error: error.data?.error 
        });
      }
    }

    const result = await client.chat.postMessage({
      channel: process.env.SLACK_CHANNEL_ID,
      text: req.body.message,
      thread_ts: req.body.thread_ts || undefined
    });

    res.status(200).json({ 
      success: true,
      thread_ts: result.ts,
      ts: result.ts
    });
  } catch (error) {
    console.error('Slack API Error:', error);
    res.status(500).json({ error: error.message });
  }
}