import Pusher from 'pusher';
import emoji from 'node-emoji';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
});

// Add this at the top level of the file
let emojiCache = null;
const EMOJI_CACHE_DURATION = 1000 * 60 * 60; // 1 hour
let lastEmojiFetch = 0;

// Add the same mapping at the top of the file
const UNICODE_TO_SLACK_MAP = {
  '👍': 'thumbsup',
  '👎': 'thumbsdown',
  '✅': 'white_check_mark',
  '❤️': 'heart',
  // Add more as needed
};

// Add this function to fetch emojis from Slack
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
  // Add immediate debug logging
  console.log('=== START EVENT HANDLER ===');
  console.log('Request method:', req.method);
  console.log('Request headers:', req.headers);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('=== END EVENT HANDLER ===');

  if (req.body.type === 'url_verification') {
    console.log('Handling URL verification');
    return res.json({ challenge: req.body.challenge });
  }

  const event = req.body.event;
  
  // Log all incoming events
  console.log('Processing event:', {
    type: event?.type,
    subtype: event?.subtype,
    channel: event?.item?.channel,
    expected_channel: process.env.SLACK_CHANNEL_ID
  });

  // Handle regular messages
  if (event?.type === 'message' && !event.bot_id && event.channel === process.env.SLACK_CHANNEL_ID) {
    const emojis = await getSlackEmojis();
    const text = event.text.replace(/:([\w-]+):/g, (match, emojiName) => {
      if (emojis[emojiName]) {
        // Handle both URLs and aliases
        return emojis[emojiName].startsWith('alias:') 
          ? `:${emojis[emojiName].slice(6)}:` // Keep the original format for aliases
          : emojis[emojiName]; // Return URL for custom emoji
      }
      return emoji.get(emojiName) || match;
    });

    await pusher.trigger('pushrefresh-chat', 'message', {
      text: text,
      user: 'Rossi - Push Refresh',
      isUser: false,
      thread_ts: event.thread_ts || event.ts,
      ts: event.ts
    });
  }
  
  // Handle reactions being added
  if (event?.type === 'reaction_added' || event?.type === 'reaction_removed') {
    console.log('Processing reaction event:', event);
    const emojis = await getSlackEmojis();
    
    let emojiName = event.reaction;
    
    // Convert Unicode emoji to Slack name if it exists in our mapping
    if (UNICODE_TO_SLACK_MAP[emojiName]) {
      emojiName = UNICODE_TO_SLACK_MAP[emojiName];
    }
    
    // Get the emoji representation (either custom URL or standard format)
    const emoji = emojis[emojiName] || `:${emojiName}:`;
    
    try {
      await pusher.trigger('pushrefresh-chat', event.type === 'reaction_added' ? 'reaction' : 'reaction_removed', {
        emoji: emoji,
        thread_ts: event.item.ts
      });
      console.log('Successfully pushed reaction event');
    } catch (error) {
      console.error('Error pushing reaction:', error);
    }
  }

  res.status(200).json({ ok: true });
}