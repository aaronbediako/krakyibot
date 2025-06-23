import 'dotenv/config';
import fs from 'fs';
import fsp from 'fs/promises';
import { readFile } from 'fs/promises';
import path from 'path';
import { TwitterApi } from 'twitter-api-v2';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CohereClientV2 } from "cohere-ai";

import admin from 'firebase-admin'; 
//import credentials from './firebaseCredentials.js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Validate env vars ---
const requiredEnvVars = [
  'TWITTER_APP_KEY',
  'TWITTER_APP_SECRET',
  'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET',
  'OPENAI_API_KEY',
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];
for (const key of requiredEnvVars) {
  if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
}

// --- Init Twitter client ---
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY,
  appSecret: process.env.TWITTER_APP_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// --- Init OpenAI client ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

//gemini ai
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

//cohere ai
const cohere = new CohereClientV2({
  token: process.env.COHERE_API_KEY,
});

// --- Init Firebase ---
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};


// --- Init Firebase Admin SDK ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// --- Fallback messages for when meme generation fails ---
// These are humorous fallback messages in Pidgin English
// to use when the AI fails to generate a meme or image.
// They are designed to be light-hearted and relatable
const fallbackMessages = [
  "Chale sorry oo, my brain dey jam small. Try me again later. 😂🙏",
  "Ei sorry o! The meme engine sleep small. Come back make we vibe. 😅🤖",
  "Network no dey my side, chale. Try me later wai. 🔌😂",
  "Abeg, system choke small. I no fit run am now. Try again later. 🙏😔",
  "My woman don give me wahala wey she bill me on top. I go sort am, come back rydee norrr! 😅🙏"
];

function getRandomFallbackMessage() {
  const index = Math.floor(Math.random() * fallbackMessages.length);
  return fallbackMessages[index];
}


// --- Helper: Generate meme text ---
async function generateMemeText(input) {
  const prompt = `You are a Ghanaian meme generator. Given this text, return a short, funny and culturally relevant meme in Pidgin. Be creative and local: "${input}"`;

    // Try GPT-4o
  try {
    const gpt4Response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 80,
    });
    return gpt4Response.choices[0].message.content.trim();
  } catch (err) {
    console.warn('GPT-4o failed:', err.message);
  }

  // Fallback: GPT-3.5
  try {
    const gpt3Response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 80,
    });
    return gpt3Response.choices[0].message.content.trim();
  } catch (err) {
    console.warn('GPT-3.5 failed:', err.message);
  }

  // Fallback: Gemini Pro
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (err) {
    console.error('Gemini failed:', err.message);
    //throw new Error('All fallback attempts failed.');
  }

  // 4. Try Cohere
  try {
    
    const response = await cohere.chat({
        model: "command-r-plus",
        messages: [
            { role: "user", content: prompt }
        ],
        temperature: 0.7,
        });

    return response.text.trim();
  } catch (err) {
    console.warn('Cohere failed:', err.message);
  }

  // If everything fails
  // 5. Final Static Fallback
  console.warn('❌ All fallbacks failed. Using static text.');
  return getRandomFallbackMessage();

    //return response.choices[0].message.content.trim();

}


async function generateMemeImage(memeText) {
  const prompt = `Generate a culturally relevant and funny Ghanaian meme image based on this text: "${memeText}"`;

  // 1. Try OpenAI DALL·E
  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '512x512',
    });

    const imageUrl = response.data[0].url;
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });

    const filename = `./temp_images/${uuidv4()}.png`;
    await fs.writeFile(filename, imageResponse.data);
    return filename;
  } catch (err1) {
    console.warn('OpenAI image generation failed. Trying Gemini…', err1.message);
  }

  // 2. Try Gemini (text → image base64; experimental)
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });
    const result = await model.generateContent({
      contents: [{ parts: [{ text: prompt }] }],
    });

    const base64Image = result.response?.candidates?.[0]?.content?.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
    if (base64Image && base64Image[0]) {
      const buffer = Buffer.from(base64Image[0].split(',')[1], 'base64');
      const filename = `./temp_images/${uuidv4()}.png`;
      await fs.writeFile(filename, buffer);
      return filename;
    }
    throw new Error('Gemini did not return a valid image.');
  } catch (err2) {
    console.warn('Gemini image generation failed. Trying Stability.ai…', err2.message);
  }

  // 3. Try Stability.ai
  try {
    const stabilityResponse = await axios.post(
      'https://api.stability.ai/v1/generation/stable-diffusion-v1-5/text-to-image',
      {
        text_prompts: [{ text: prompt }],
        cfg_scale: 7,
        height: 512,
        width: 512,
        samples: 1,
        steps: 30,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    const imageBase64 = stabilityResponse.data.artifacts[0].base64;
    const buffer = Buffer.from(imageBase64, 'base64');
    const filename = `./temp_images/${uuidv4()}.png`;
    await fs.writeFile(filename, buffer);
    return filename;
  } catch (err3) {
    console.error('Stability.ai image generation failed.' + err3.message);
    throw new Error('All image generation methods failed.');
  }
}


// --- Helper: Download image to temp file ---

async function downloadImage(url) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer',
  });
  const tempPath = path.join(__dirname, 'temp_image.png');
  fs.writeFileSync(tempPath, response.data);
  return tempPath;
}

// --- Rate limiting (2 replies per user per day) ---
async function canReplyToUserFirebase(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const userDocRef = db.doc(`rate_limits/${userId}`);
  const userDocSnap = await userDocRef.get();
  if (!userDocSnap.exists) {
    await userDocRef.set({ [today]: { count: 1, lastUpdated: new Date().toISOString() } });
    return true;
  }
  const data = userDocSnap.data();
  if (!data[today]) {
    data[today] = { count: 1, lastUpdated: new Date().toISOString() };
    await userDocRef.set(data);
    return true;
  }
  if (data[today].count < 2) {
    data[today].count += 1;
    data[today].lastUpdated = new Date().toISOString();
    await userDocRef.set(data);
    return true;
  }
  return false;
}

// --- Log meme reply metadata ---
async function logMemeReply({ userId, userHandle, tweetId, tweetText, replyText, replyStatus = 'success', errorMessage = null, parentTweet = null }) {
  try {
    const memeRepliesRef = db.collection('meme_replies');
    await memeRepliesRef.add({
      userId,
      userHandle,
      tweetId,
      tweetText,
      replyText,
      replyStatus,
      errorMessage,
      timestamp: new Date().toISOString(),
      parentTweet, // log parent tweet info if any
    });
  } catch (err) {
    console.error('Error logging meme reply:', err.message);
  }
}

// --- Get user handle by userId ---
async function getUserHandle(userId) {
  try {
    const user = await twitterClient.v2.user(userId);
    return user.data.username ? `@${user.data.username}` : null;
  } catch(err) {
    console.error('Error getting user handle:', err.message);
    return null;
  }
}

// --- Walk back to parent tweet if current tweet text is empty ---
async function getEffectiveTweet(tweet) {
  if (tweet.text && tweet.text.trim().length > 0) {
    return { tweet, parentTweet: null };
  }

  if (!tweet.referenced_tweets || tweet.referenced_tweets.length === 0) {
    return { tweet, parentTweet: null }; // no parent tweet to walk back to
  }

  const parentId = tweet.referenced_tweets[0].id;
  try {
    const parentTweetResponse = await twitterClient.v2.singleTweet(parentId, {
      'tweet.fields': ['author_id', 'text', 'created_at', 'referenced_tweets'],
    });
    const parentTweet = parentTweetResponse.data;
    // Return parent tweet as the effective one, and original tweet as parentTweet for logging
    return { tweet: parentTweet, parentTweet: tweet };
  } catch (err) {
    console.error('Error fetching parent tweet:', err.message);
    return { tweet, parentTweet: null };
  }
}

async function replyWithImageAndText(tweetId, text, imagePath) {
  try {
    // Upload media to Twitter (v1 for media upload is correct)
    const mediaId = await twitterClient.v1.uploadMedia(imagePath);

    // Post reply with text and media
    await twitterClient.v2.tweet({
      text,
      reply: {
        in_reply_to_tweet_id: tweetId,
      },
      media: {
        media_ids: [mediaId],
      },
    });

    // Delete temp image after successful post
    await fsp.unlink(imagePath);
  } catch (err) {
    console.error('❌ Error in replyWithImageAndText:', err.message);

    // Try deleting the image even if posting failed
    try {
      await fsp.unlink(imagePath);
    } catch (deleteErr) {
      console.warn('⚠️ Failed to delete image:', deleteErr.message);
    }

    console.warn('Falling back to text-only reply...');
    await replyWithText(tweet.id, memeText);

    throw err;
  }
}

async function replyWithText(tweetId, text) {
  try {
    await twitterClient.v2.tweet({
      text: text,
      reply: {
        in_reply_to_tweet_id: tweetId,
      },
    });
  } catch (err) {
    console.error('❌ Error in replyWithText:', err.message);
    throw err;
  }
}

// Collection and document to store lastMentionId
const LAST_MENTION_DOC = db.doc('bot_state/lastMention');

async function getLastMentionIdFromFirebase() {
  try {
    const docSnap = await LAST_MENTION_DOC.get();
    if (docSnap.exists) {
      return docSnap.data().lastMentionId || null;
    }
    return null;
  } catch (err) {
    console.error("Error fetching lastMentionId:", err);
    return null;
  }
}

async function setLastMentionIdToFirebase(lastMentionId) {
  try {
    await LAST_MENTION_DOC.set({ lastMentionId });
  } catch (err) {
    console.error("Error setting lastMentionId:", err);
  }
}



async function startBot() {
  console.log("🔧 Starting bot...");

  // Authenticate and get bot user info
  if (
    !process.env.TWITTER_APP_KEY ||
    !process.env.TWITTER_APP_SECRET ||
    !process.env.TWITTER_ACCESS_TOKEN ||
    !process.env.TWITTER_ACCESS_SECRET
  ) {
    console.error("❌ Missing one or more Twitter credentials.");
    process.exit(1);
  }

  let me;
  try {
    me = await twitterClient.v2.me();
    console.log("✅ Authenticated as:", me.data.username);
  } catch (err) {
        if (err.code === 429) {
    const resetEpochSeconds = Number(err.headers['x-user-limit-24hour-reset']);
    const nowEpochMillis = Date.now();
    const resetMillis = resetEpochSeconds * 1000;
    let waitTime = resetMillis - nowEpochMillis;

    if (isNaN(waitTime) || waitTime <= 0) {
        // fallback if header missing or invalid
        waitTime = 15 * 60 * 1000; // 15 minutes
        console.warn(`x-user-limit-24hour-reset header missing or invalid, fallback wait: ${waitTime / 1000} seconds.`);
    } else {
        const waitHours = Math.floor(waitTime / (1000 * 60 * 60));
        const waitMinutes = Math.floor((waitTime % (1000 * 60 * 60)) / (1000 * 60));
        const waitSeconds = Math.floor((waitTime % (1000 * 60)) / 1000);

        console.warn(
        `Rate limit hit. Backing off for approximately ${waitHours}h ${waitMinutes}m ${waitSeconds}s ` +
        `(until ${new Date(resetMillis).toLocaleString()})...`
        );
    }
    console.error("❌ Failed to authenticate with Twitter API.");
    console.error("Full error:", err);

    await new Promise(res => setTimeout(res, waitTime));
    }
    else {
       
        throw err;
      }
    
    return;
  }

  const botUserId = me.data.id;
  console.log(`🤖 Bot running as @${me.data.username} (ID: ${botUserId})`);

  let lastMentionId = await getLastMentionIdFromFirebase();
console.log('🔄 Loaded lastMentionId from Firebase:', lastMentionId);

  let retryDelay = 2000; // Start 2 seconds retry delay

  while (true) {
    try {
      const params = {
        'tweet.fields': ['author_id', 'text', 'created_at', 'referenced_tweets'],
        expansions: ['author_id', 'referenced_tweets.id'],
        max_results: 5,
      };
      if (lastMentionId) {
        params.since_id = lastMentionId;
      }

      const mentionsResponse = await twitterClient.v2.userMentionTimeline(botUserId, params);
      const mentions = mentionsResponse.data?.data || [];

      if (mentions.length > 0) {
        mentions.reverse(); // oldest first for processing in order

        for (const tweet of mentions) {
          if (tweet.author_id === botUserId) continue; // skip own tweets

          // Update lastMentionId to avoid reprocessing
          if (!lastMentionId || BigInt(tweet.id) > BigInt(lastMentionId)) {
            lastMentionId = tweet.id;
            console.log(`🔄 Updated lastMentionId to: ${lastMentionId}`);
          }

          console.log(`🐦 Mention received from user ID: ${tweet.author_id}`);

          try {
            // 1. Get effective tweet & parent tweet for context
            const { tweet: effectiveTweet, parentTweet } = await getEffectiveTweet(tweet);

            // 2. Check rate limiting for user
            const canReply = await canReplyToUserFirebase(tweet.author_id);
            if (!canReply) {
              console.log(`🚫 Rate limit exceeded for user ${tweet.author_id}, skipping reply.`);
              continue;
            }

            // 3. Get user handle for reply and logging
            const userHandle = "";//await getUserHandle(tweet.author_id);
            const tweetText = effectiveTweet.text;

            // // 4. Generate meme text and meme image URL
            
            const memeText = await generateMemeText(tweetText);

            let imagePath = null;
            try {
            // 5. Try to generate meme image and download it
            const imageUrl = await generateMemeImage(memeText);
            imagePath = await downloadImage(imageUrl);
            } catch (err) {
            console.warn('Image generation failed, proceeding with text only:', err.message);
            }

            // 6. Reply to the mention with meme text and optionally image if available
            if (imagePath) {
            await replyWithImageAndText(tweet.id, memeText, imagePath);
            } else {
            await replyWithText(tweet.id, memeText);
            }

            // 7. Log successful reply
            await logMemeReply({
              userId: tweet.author_id,
              userHandle,
              tweetId: tweet.id,
              tweetText,
              replyText: memeText,
              replyStatus: 'success',
              parentTweet,
            });

            await setLastMentionIdToFirebase(lastMentionId);
            console.log(`✅ Replied to @${userHandle} ${tweet.author_id} with meme and image.`);
          } catch (err) {
            console.error("❌ Error during tweet processing:", err);

            // Log failure to Firebase
            await logMemeReply({
              userId: tweet.author_id,
              userHandle: await getUserHandle(tweet.author_id),
              tweetId: tweet.id,
              tweetText: tweet.text,
              replyText: null,
              replyStatus: 'failure',
              errorMessage: err.message,
              parentTweet: null,
            });
          }

            
        }
      }

      // Reset retry delay after successful poll
      retryDelay = 2000;

      // Wait 60 seconds before next poll
      //await new Promise(res => setTimeout(res, 60000));
      //await new Promise(res => setTimeout(res, 3600 * 1000));
    } catch (err) {
      if (err.code === 429 && err.rateLimit?.reset) {
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        const waitSeconds = err.rateLimit.reset - now;
        const waitMs = waitSeconds * 1000;

        console.error('429:', err);
        console.warn(`Rate limit hit. Backing off until reset in ${waitSeconds}s (at ${new Date(err.rateLimit.reset * 1000).toLocaleTimeString()})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        //await new Promise(res => setTimeout(res, retryDelay));
        retryDelay = Math.min(retryDelay * 2, 15 * 60 * 1000); // max 15 minutes backoff
      } else {
        console.error('Polling error:', err);
        // await new Promise(res => setTimeout(res, retryDelay));
        await new Promise(res => setTimeout(res, 3600 * 1000));
      }
      // Optional: don't throw to keep polling alive, or uncomment to stop on fatal error
      // throw err;
    }
    //wait 1 hour before next poll
    console.log('Waiting 1 hour before next poll...');
    await new Promise(res => setTimeout(res, 3600 * 1000));
  }
}





// --- shutdown ---
let shuttingDown = false;
process.on('SIGINT', () => {
  console.log('Graceful shutdown requested');
  shuttingDown = true;
  process.exit(0);
});

// --- Run bot with retry logic ---
async function runBotWithRetry() {
  let attempts = 0;
  while (!shuttingDown) {
    try {
      await startBot();
      attempts = 0; // reset on success
    } catch (err) {
      attempts++;

        // Log full error to inspect structure
      console.dir(err, { depth: null });

      // Print custom rate-limit info if available
      const reset = err?.headers?.['x-rate-limit-reset'];
      const remaining = err?.headers?.['x-rate-limit-remaining'];

      if (err.code === 429 && reset) {
        const resetTime = new Date(parseInt(reset) * 1000);
        console.warn(`🚫 Rate limit hit. Retry allowed at: ${resetTime.toLocaleString()}`);
      }

      console.error(`Bot error (attempt ${attempts}):`, err.message);
      if (attempts > 5) {
        console.error('Too many failures, exiting.');
        break;
      }
      const wait = Math.min(60000, 2 ** attempts * 1000);
      console.log(`Retrying in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

runBotWithRetry();



//Initial bot code that used a stream rather than polling. was using up the free twitter api too quickly so had to pivot
// --- Main bot function ---
// async function startBot() {
//   console.log("🔧 Starting bot...");

//   if (
//   !process.env.TWITTER_APP_KEY ||
//   !process.env.TWITTER_APP_SECRET ||
//   !process.env.TWITTER_ACCESS_TOKEN ||
//   !process.env.TWITTER_ACCESS_SECRET
// ) {
//   console.error("❌ Missing one or more Twitter credentials.");
//   process.exit(1);
// }


//   let me;
//   try {
//     me = await twitterClient.v2.me();
//     console.log("✅ Authenticated as:", me.data.username);
//   } catch (err) {
//     console.error("❌ Failed to authenticate with Twitter API.");
//     console.error("Full error:", err);
//     console.error("Error code:", err.code);
//     console.error("Message:", err.message);
//     return;
//   }

//   const botUserId = me.data.id;
//   console.log(`🤖 Bot running as @${me.data.username} (ID: ${botUserId})`);

//   // Set up stream rules
//   try {
//     const existingRules = await twitterClient.v2.streamRules();
//     if (existingRules.data?.length) {
//       console.log("🧹 Deleting existing stream rules...");
//       await twitterClient.v2.updateStreamRules({
//         delete: { ids: existingRules.data.map(rule => rule.id) },
//       });
//       console.log("✅ Existing rules deleted.");
//     }

//     await twitterClient.v2.updateStreamRules({
//       add: [{ value: `@${me.data.username}` }],
//     });
//     console.log(`📜 Stream rule set to track: @${me.data.username}`);
//   } catch (err) {
//     console.error("❌ Failed to set stream rules.");
//     console.error("Error code:", err.code);
//     console.error("Message:", err.message);
//     return;
//   }

//   let stream;
//   try {
//     stream = await twitterClient.v2.searchStream({
//       expansions: ['author_id', 'referenced_tweets.id'],
//       'tweet.fields': ['author_id', 'text', 'created_at', 'referenced_tweets'],
//     });

//     stream.on('error', (err) => {
//       console.error('❌ Stream error:', err.message);
//     });

//     console.log("📡 Stream started. Listening for mentions...");
//   } catch (err) {
//     console.error("❌ Failed to start Twitter stream.");
//     console.error("Error code:", err.code);
//     console.error("Message:", err.message);
//     return;
//   }

//   for await (const { data: tweet } of stream) {
//     if (!tweet) continue;
//     if (tweet.author_id === botUserId) continue;

//     console.log(`🐦 Mention received from user ID: ${tweet.author_id}`);

//     try {
//       const { tweet: effectiveTweet, parentTweet } = await getEffectiveTweet(tweet);

//       const canReply = await canReplyToUserFirebase(tweet.author_id);
//       if (!canReply) {
//         console.log(`🚫 Rate limit exceeded for user ${tweet.author_id}, skipping reply.`);
//         continue;
//       }

//       const userHandle = await getUserHandle(tweet.author_id);
//       const tweetText = effectiveTweet.text;

//       const memeText = await generateMemeText(tweetText);
//       const imageUrl = await generateMemeImage(memeText);
//       const imagePath = await downloadImage(imageUrl);

//       await replyWithImageAndText(tweet.id, memeText, imagePath);

//       await logMemeReply({
//         userId: tweet.author_id,
//         userHandle,
//         tweetId: tweet.id,
//         tweetText,
//         replyText: memeText,
//         replyStatus: 'success',
//         parentTweet,
//       });

//       console.log(`✅ Replied to @${userHandle} with meme and image.`);
//     } catch (err) {
//       console.error("❌ Error during tweet processing.");
//       console.error("Message:", err.message);

//       await logMemeReply({
//         userId: tweet.author_id,
//         userHandle: await getUserHandle(tweet.author_id),
//         tweetId: tweet.id,
//         tweetText: tweet.text,
//         replyText: null,
//         replyStatus: 'failure',
//         errorMessage: err.message,
//         parentTweet: null,
//       });
//     }
//   }
// }
