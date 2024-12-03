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
      console.log('Available Slack emojis:', emojis); // Debug log

      // Try to find the emoji name
      const emojiEntry = Object.entries(emojis).find(([name, value]) => {
        console.log(`Comparing emoji: ${name} = ${value} with ${req.body.emoji}`); // Debug log
        return value === req.body.emoji;
      });
      
      let emojiName = emojiEntry?.[0] || req.body.emoji.replace(/:/g, '');
      
      console.log('Selected emoji name:', emojiName); // Debug log

      try {
        let result;
        if (req.body.type === 'reaction') {
          console.log('Adding reaction with name:', emojiName); // Debug log
          try {
            result = await client.reactions.add({
              channel: process.env.SLACK_CHANNEL_ID,
              timestamp: req.body.thread_ts,
              name: emojiName
            });
          } catch (error) {
            if (error.data?.error === 'already_reacted') {
              // If already reacted, remove the reaction instead
              result = await client.reactions.remove({
                channel: process.env.SLACK_CHANNEL_ID,
                timestamp: req.body.thread_ts,
                name: emojiName
              });
            } else {
              throw error; // Re-throw other errors
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

        // If we got here, the reaction was handled successfully
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
      } catch (error) {
        console.error('Slack API Error:', error);
        
        // Return more detailed error information
        return res.status(500).json({ 
          error: `An API error occurred: ${error.data?.error || error.message}`,
          details: error.data
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