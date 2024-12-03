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

// Update the emoji mapping at the top
const SLACK_TO_UNICODE_MAP = {
    'thumbsup': '👍',
    '+1': '👍',
    'thumbsdown': '👎',
    '-1': '👎',
    'white_check_mark': '✅',
    'white_check_ma': '✅',  // Add this variant
    'white_check_mark_1': '✅',  // Add this variant
    'heart': '❤️',
    // Add reverse mappings
    '👍': 'thumbsup',
    '👎': 'thumbsdown',
    '✅': 'white_check_mark',
    '❤️': 'heart',
};

// Add the normalizeEmoji function
const normalizeEmoji = (emoji) => {
    // Remove any numbers and underscores from the end of the emoji name
    const cleanEmoji = emoji.replace(/[0-9_]+$/, '').replace(/:/g, '');
    return SLACK_TO_UNICODE_MAP[cleanEmoji] || 
           SLACK_TO_UNICODE_MAP[emoji] || 
           emoji;
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
    const normalizedEmoji = normalizeEmoji(emojiName);
    
    try {
        await pusher.trigger('pushrefresh-chat', event.type === 'reaction_added' ? 'reaction' : 'reaction_removed', {
            emoji: normalizedEmoji,
            thread_ts: event.item.ts
        });
        console.log('Successfully pushed reaction event');
    } catch (error) {
        console.error('Error pushing reaction:', error);
    }
  }

  res.status(200).json({ ok: true });
}