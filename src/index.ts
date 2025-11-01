import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import admin from 'firebase-admin';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyCSqSXDtQ4EVlp9yExkHlpVRcuZ4qrc02o';

// Initialize Firebase Admin SDK with service account JSON file
const serviceAccount = require(path.resolve(__dirname, 'fir-f0f82-firebase-adminsdk-fbsvc-ee2de715cf.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());

// Server-side storage for user's cached videos (in-memory)
const userCachedVideos: { [userId: string]: any[] } = {};

// Cache for fetched videos from YouTube
let videosCache: any[] = [];
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// GET - trending videos with random selection
app.get('/api/videos', async (req, res) => {
  try {
    const now = Date.now();

    if (videosCache.length === 0 || (now - lastFetchTime) > CACHE_DURATION) {
      const url = `https://www.googleapis.com/youtube/v3/videos?key=${YOUTUBE_API_KEY}&part=snippet&chart=mostPopular&maxResults=50&regionCode=US`;
      const response = await axios.get(url);
      const items = response.data.items;

      videosCache = items.map((item: any) => ({
        videoId: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.medium.url,
        publishedAt: item.snippet.publishedAt,
      }));

      lastFetchTime = now;
    }

    const shuffled = [...videosCache].sort(() => Math.random() - 0.5);
    const selectedVideos = shuffled.slice(0, 10);

    return res.json(selectedVideos);
  } catch (error: unknown) {
    return res.status(500).json({
      error: 'Failed to fetch trending videos',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// GET - user's cached videos
app.get('/api/cache/:userId', (req, res) => {
  const userId = req.params.userId;
  const cachedVideos = userCachedVideos[userId] || [];
  res.json(cachedVideos);
});

// POST - add video to user's cache
app.post('/api/cache/:userId', (req, res) => {
  const userId = req.params.userId;
  const videoData = req.body;

  if (!videoData || !videoData.id) {
    return res.status(400).json({ error: 'Video data with id is required' });
  }

  if (!userCachedVideos[userId]) {
    userCachedVideos[userId] = [];
  }

  const existingIndex = userCachedVideos[userId].findIndex(v => v.id === videoData.id);
  if (existingIndex !== -1) {
    return res.status(409).json({
      error: 'Video already cached',
      message: 'This video is already in your cache',
    });
  }

  const cachedVideo = {
    ...videoData,
    cachedAt: new Date().toISOString(),
    status: 'cached',
  };

  userCachedVideos[userId].push(cachedVideo);

  res.json({
    message: 'Video cached successfully',
    video: cachedVideo,
    totalCached: userCachedVideos[userId].length,
  });
});

// DELETE - remove a video from user's cache
app.delete('/api/cache/:userId/:videoId', (req, res) => {
  const userId = req.params.userId;
  const videoId = req.params.videoId;

  if (!userCachedVideos[userId]) {
    return res.status(404).json({ error: 'No cache found for this user' });
  }

  const initialLen = userCachedVideos[userId].length;
  userCachedVideos[userId] = userCachedVideos[userId].filter(v => v.id !== videoId);

  if (userCachedVideos[userId].length === initialLen) {
    return res.status(404).json({ error: 'Video not found in cache' });
  }

  res.json({
    message: 'Video removed from cache',
    remainingCount: userCachedVideos[userId].length,
  });
});

// DELETE - clear all cached videos for user
app.delete('/api/cache/:userId', (req, res) => {
  const userId = req.params.userId;

  if (!userCachedVideos[userId] || userCachedVideos[userId].length === 0) {
    return res.status(404).json({ error: 'No cache found for this user' });
  }

  const clearedCount = userCachedVideos[userId].length;
  userCachedVideos[userId] = [];

  res.json({
    message: 'Cache cleared successfully',
    clearedCount: clearedCount,
  });
});

// Firebase notification sender
async function sendNotification(
  fcmToken: string,
  title: string,
  body: string,
  data?: { [key: string]: string }
) {
  const message: admin.messaging.Message = {
    notification: {
      title,
      body,
    },
    token: fcmToken,
    data: data || {},
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Successfully sent message:', response);
    return response;
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

// POST - send notification route
app.post('/api/sendNotification', async (req, res) => {
  const { fcmToken, title, body, data } = req.body;

  if (!fcmToken || !title || !body) {
    return res.status(400).json({ error: 'fcmToken, title, and body are required' });
  }

  try {
    const result = await sendNotification(fcmToken, title, body, data);
    res.json({ message: 'Notification sent successfully', result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send notification', details: error });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
