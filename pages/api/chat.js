import { WebClient } from '@slack/web-api';
import Pusher from 'pusher';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
});

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
    if (req.body.type === 'reaction') {
      const result = await client.reactions.add({
        channel: process.env.SLACK_CHANNEL_ID,
        timestamp: req.body.thread_ts,
        name: req.body.emoji.replace(/[:\s]/g, '') // Remove colons and spaces from emoji
      });

      // Trigger Pusher event for reaction
      await pusher.trigger('pushrefresh-chat', 'reaction', {
        emoji: req.body.emoji,
        count: 1,
        thread_ts: req.body.thread_ts,
        messageIndex: req.body.thread_ts
      });

      return res.status(200).json({ success: true });
    }

    // Handle reaction removal
    if (req.body.type === 'remove_reaction') {
      const result = await client.reactions.remove({
        channel: process.env.SLACK_CHANNEL_ID,
        timestamp: req.body.thread_ts,
        name: req.body.emoji.replace(/[:\s]/g, '') // Remove colons and spaces from emoji
      });

      // Trigger Pusher event for reaction removal
      await pusher.trigger('pushrefresh-chat', 'reaction_removed', {
        emoji: req.body.emoji,
        thread_ts: req.body.thread_ts,
        messageIndex: req.body.thread_ts
      });

      return res.status(200).json({ success: true });
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
    console.error('Slack API Error:', error);
    res.status(500).json({ error: error.message });
  }
}