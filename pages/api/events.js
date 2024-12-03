import Pusher from 'pusher';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
});

// Basic emoji mapping - add more as needed
const emojiMap = {
    'smile': '😊',
    'rolling_on_the_floor_laughing': '🤣',
    'laughing': '😄',
    'wink': '😉',
    'heart': '❤️',
    'thumbsup': '👍',
    'wave': '👋',
    'rocket': '🚀',
    'fire': '🔥',
    'tada': '🎉',
    'raised_hands': '🙌',
    'pray': '🙏',
    '+1': '👍',
    '-1': '👎',
    'ok_hand': '👌',
    'muscle': '💪',
    'clap': '👏',
    'star': '⭐',
    'sparkles': '✨',
    'sunny': '☀️',
    'thinking_face': '🤔',
    'check': '✅',
    'warning': '⚠️',
    'x': '❌',
};

export default async function handler(req, res) {
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }

  const event = req.body.event;
  
  // Handle regular messages
  if (event?.type === 'message' && !event.bot_id && event.channel === process.env.SLACK_CHANNEL_ID) {
    const text = event.text.replace(/:([\w-]+):/g, (match, emoji) => {
        return emojiMap[emoji] || match;
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
  if (event?.type === 'reaction_added' && event.item.channel === process.env.SLACK_CHANNEL_ID) {
    console.log('Reaction added in Slack:', event);
    const reaction = emojiMap[event.reaction] || '👍'; // Default to thumbsup if unknown
    await pusher.trigger('pushrefresh-chat', 'reaction', {
        emoji: reaction,
        count: 1,
        thread_ts: event.item.ts,
        user: event.user
    });
  }

  // Handle reactions being removed
  if (event?.type === 'reaction_removed' && event.item.channel === process.env.SLACK_CHANNEL_ID) {
    console.log('Reaction removed in Slack:', event);
    const reaction = emojiMap[event.reaction] || '👍'; // Default to thumbsup if unknown
    await pusher.trigger('pushrefresh-chat', 'reaction_removed', {
        emoji: reaction,
        thread_ts: event.item.ts,
        user: event.user
    });
  }

  res.status(200).json({ ok: true });
}