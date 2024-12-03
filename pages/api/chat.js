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

      // Get emoji name from Slack
      const emojis = await getSlackEmojis();
      const emojiName = Object.entries(emojis).find(([_, value]) => value === req.body.emoji)?.[0] || 'thumbsup';

      try {
        let result;
        if (req.body.type === 'reaction') {
          try {
            result = await client.reactions.add({
              channel: process.env.SLACK_CHANNEL_ID,
              timestamp: req.body.thread_ts,
              name: emojiName
            });
          } catch (error) {
            // If already reacted, try to remove the reaction instead
            if (error.data?.error === 'already_reacted') {
              result = await client.reactions.remove({
                channel: process.env.SLACK_CHANNEL_ID,
                timestamp: req.body.thread_ts,
                name: emojiName
              });
              
              // Trigger Pusher event for reaction removal
              await pusher.trigger('pushrefresh-chat', 'reaction_removed', {
                emoji: req.body.emoji,
                thread_ts: req.body.thread_ts
              });
              
              return res.status(200).json({ 
                success: true, 
                action: 'removed',
                details: result 
              });
            } else {
              throw error; // Re-throw if it's a different error
            }
          }
        } else {
          // Handle explicit removal request
          result = await client.reactions.remove({
            channel: process.env.SLACK_CHANNEL_ID,
            timestamp: req.body.thread_ts,
            name: emojiName
          });
        }

        // If we got here, the reaction was added successfully
        if (req.body.type === 'reaction') {
          await pusher.trigger('pushrefresh-chat', 'reaction', {
            emoji: req.body.emoji,
            count: 1,
            thread_ts: req.body.thread_ts
          });
        }

        return res.status(200).json({ 
          success: true,
          action: req.body.type === 'reaction' ? 'added' : 'removed',
          details: result 
        });
      } catch (slackError) {
        console.error('Slack API Error:', {
          message: slackError.message,
          data: slackError.data,
          stack: slackError.stack
        });
        
        // Return more detailed error information
        return res.status(500).json({ 
          error: `An API error occurred: ${slackError.data?.error || slackError.message}`,
          details: slackError.data
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