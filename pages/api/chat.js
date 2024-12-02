import { WebClient } from '@slack/web-api';

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
   await client.chat.postMessage({
     channel: process.env.SLACK_CHANNEL_ID,
     text: req.body.message
   });
   res.status(200).json({ success: true });
 } catch (error) {
   res.status(500).json({ error: error.message });
 }
}