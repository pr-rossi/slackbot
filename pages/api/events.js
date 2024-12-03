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
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }

  const event = req.body.event;
  
  // Handle regular messages
  if (event?.type === 'message' && !event.bot_id && event.channel === process.env.SLACK_CHANNEL_ID) {
    await pusher.trigger('pushrefresh-chat', 'message', {
      text: event.text,
      user: 'Rossi - Push Refresh',
      isUser: false,
      thread_ts: event.thread_ts || event.ts,
      ts: event.ts
    });
  }
  
  // Handle reactions
  if (event?.type === 'reaction_added' || event?.type === 'reaction_removed') {
    const emojiName = event.reaction;
    const normalizedEmoji = normalizeEmoji(emojiName);
    
    await pusher.trigger('pushrefresh-chat', 
      event.type === 'reaction_added' ? 'reaction_added' : 'reaction_removed',
      {
        emoji: normalizedEmoji,
        thread_ts: event.item.ts
      }
    );
  }

  res.status(200).json({ ok: true });
}