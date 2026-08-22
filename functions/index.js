const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");

const TELEGRAM_CHANNEL = defineString("TELEGRAM_CHANNEL", {
  default: "@inboxdollarpublicchannel"
});

// IMPORTANT:
// Yahan apne Telegram GROUP ka username/ID set karna hoga.
// Agar group public hai to @username use karo.
// Agar private group hai to numeric chat ID use karo, e.g. -1001234567890
const TELEGRAM_GROUP = defineString("TELEGRAM_GROUP", {
  default: ""
});

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

async function telegramGetChatMember(chatId, userId) {
  const url =
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN.value()}` +
    `/getChatMember?chat_id=${encodeURIComponent(chatId)}` +
    `&user_id=${encodeURIComponent(userId)}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || "Telegram API error");
  }

  return data.result;
}

function isMember(member) {
  if (!member) return false;

  if (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member"
  ) {
    return true;
  }

  if (member.status === "restricted" && member.is_member === true) {
    return true;
  }

  return false;
}

exports.verifyTelegramMembership = onRequest(
  {
    secrets: [TELEGRAM_BOT_TOKEN],
  },
  async (req, res) => {
    cors(res);

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        error: "POST required"
      });
    }

    try {
      const telegramId = String(req.body?.telegramId || "").trim();

      if (!telegramId) {
        return res.status(400).json({
          success: false,
          error: "telegramId is required"
        });
      }

      const channelId = TELEGRAM_CHANNEL.value();
      const groupId = TELEGRAM_GROUP.value();

      if (!channelId) {
        return res.status(500).json({
          success: false,
          error: "Telegram channel is not configured"
        });
      }

      const channelMember =
        await telegramGetChatMember(channelId, telegramId);

      const channelVerified = isMember(channelMember);

      let groupVerified = false;

      if (groupId) {
        const groupMember =
          await telegramGetChatMember(groupId, telegramId);

        groupVerified = isMember(groupMember);
      }

      const userRef = db.collection("users").doc(telegramId);

      await userRef.set(
        {
          telegramChannelVerified: channelVerified,
          telegramGroupVerified: groupVerified,
          telegramMembershipCheckedAt:
            admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return res.status(200).json({
        success: true,
        telegramChannelVerified: channelVerified,
        telegramGroupVerified: groupVerified
      });

    } catch (error) {
      console.error("Telegram membership verification error:", error);

      return res.status(500).json({
        success: false,
        error: "Telegram membership verification failed"
      });
    }
  }
);