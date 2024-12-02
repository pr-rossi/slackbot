import Pusher from 'pusher';

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
});

export default async function handler(req, res) {
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }

  const event = req.body.event;
  if (event?.type === 'message' && !event.bot_id) {
    await pusher.trigger('pushrefresh-chat', 'message', {
      text: event.text,
      isUser: false
    });
  }

  res.status(200).json({ ok: true });
}