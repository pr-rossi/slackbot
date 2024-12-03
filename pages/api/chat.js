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
      // Log the incoming request
      console.log('Incoming reaction request:', req.body);
      console.log('Channel ID:', process.env.SLACK_CHANNEL_ID);
      console.log('Thread TS:', req.body.thread_ts);

      // Convert emoji to Slack format
      let emojiName = 'thumbsup'; // Default to thumbsup
      if (req.body.emoji === '👍') {
        emojiName = 'thumbsup';
      } else if (req.body.emoji === '❤️') {
        emojiName = 'heart';
      } // Add more emoji mappings as needed

      console.log('Using emoji name:', emojiName);

      // Validate required fields
      if (!process.env.SLACK_CHANNEL_ID) {
        return res.status(500).json({ error: 'Missing SLACK_CHANNEL_ID' });
      }
      if (!req.body.thread_ts) {
        return res.status(400).json({ error: 'Missing thread_ts' });
      }

      try {
        const params = {
          channel: process.env.SLACK_CHANNEL_ID,
          timestamp: req.body.thread_ts,
          name: emojiName
        };
        
        console.log('Sending to Slack API:', params);
        
        const result = await client.reactions.add(params);
        console.log('Slack API Response:', result);

        // Trigger Pusher event for reaction
        await pusher.trigger('pushrefresh-chat', 'reaction', {
          emoji: req.body.emoji,
          count: 1,
          thread_ts: req.body.thread_ts
        });

        return res.status(200).json({ success: true });
      } catch (slackError) {
        console.error('Slack API Error:', {
          message: slackError.message,
          data: slackError.data,
          stack: slackError.stack
        });
        return res.status(500).json({ 
          error: slackError.message,
          details: slackError.data
        });
      }
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
    console.error('General Error:', error);
    res.status(500).json({ error: error.message });
  }
}