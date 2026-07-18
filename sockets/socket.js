const User = require("../models/User");
const Chat = require("../models/Chat");
const LegacyMessage = require("../models/LegacyMessage");
const admin = require("firebase-admin");
const {
  encryptText,
  privateConversationKey,
  groupConversationKey,
} = require("../utils/messageCrypto");
const { saveMessageToFile } = require("../utils/storage");

function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function setupSocket(io) {
  function getOnlineUsers() {
    const users = new Set();
    for (const s of io.sockets.sockets.values()) {
      const u = normalizeUsername(s.data && s.data.username);
      if (u) users.add(u);
    }
    return [...users];
  }

  function emitPresenceSnapshot(targetSocket) {
    targetSocket.emit("presence:snapshot", {
      onlineUsers: getOnlineUsers(),
    });
  }

  async function sendFcmToUsernames(usernames, { title, body, data }) {
    if (!admin.apps.length) return;

    const normalized = [...new Set((usernames || []).map(normalizeUsername).filter(Boolean))];
    if (!normalized.length) return;

    const users = await User.find({
      $or: [
        { username: { $in: normalized } },
        { email: { $in: normalized.map((u) => `${u}@cyberlink.local`) } },
      ],
    }).select("fcmTokens username email");

    const tokens = [...new Set(users.flatMap((u) => u.fcmTokens || []).filter(Boolean))];
    if (!tokens.length) return;

    const stringData = Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, String(v ?? "")])
    );

    try {
      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: { title: String(title || "Cyberlink"), body: String(body || "") },
        data: stringData,
      });
    } catch (error) {
      console.warn(`FCM send error: ${error.message}`);
    }
  }

  io.on("connection", (socket) => {
    emitPresenceSnapshot(socket);

    // Legacy join (username based)
    socket.on("join", (payload) => {
      const username = payload && payload.username;
      if (!username) return;
      const normalizedUser = normalizeUsername(username);
      if (!normalizedUser) return;

      socket.join(normalizedUser);
      socket.data.username = normalizedUser;
      io.emit("presence:update", {
        userId: normalizedUser,
        status: "online",
      });
      emitPresenceSnapshot(socket);
    });

    socket.on("setup", (userData) => {
      const userId = userData && userData.userId;
      if (!userId) {
        return;
      }

      socket.join(String(userId));
      socket.data.userId = String(userId);
      socket.emit("connected");
    });

    socket.on("chat_open", (payload) => {
      const room = payload && payload.chatId;
      if (!room || !socket.data.username) return;
      socket.data.activeChat = String(room);
      io.emit("presence:chat_status", { userId: socket.data.username, inChat: true });
      io.to(String(room)).emit("presence:active", { userId: socket.data.username });
    });

    socket.on("chat_close", () => {
      if (!socket.data.username) return;
      socket.data.activeChat = null;
      io.emit("presence:chat_status", { userId: socket.data.username, inChat: false });
    });

    socket.on("join chat", (chatId) => {
      if (!chatId) {
        return;
      }
      socket.join(String(chatId));
    });

    socket.on("typing", (payload) => {
      // Legacy private typing payload from Flutter app.
      if (payload && typeof payload === "object" && payload.to && payload.from) {
        socket.to(normalizeUsername(payload.to)).emit("typing", {
          from: normalizeUsername(payload.from),
          to: normalizeUsername(payload.to),
          isTyping: payload.isTyping === true,
        });
        return;
      }

      // Existing chatId-based typing flow.
      const chatId = payload;
      if (!chatId || !socket.data.userId) {
        return;
      }
      socket.to(String(chatId)).emit("typing", {
        chatId: String(chatId),
        userId: socket.data.userId,
      });
    });

    socket.on("stop typing", (chatId) => {
      if (!chatId || !socket.data.userId) {
        return;
      }
      socket.to(String(chatId)).emit("stop typing", {
        chatId: String(chatId),
        userId: socket.data.userId,
      });
    });

    socket.on("new message", (message) => {
      if (!message || !message.chat || !Array.isArray(message.chat.users)) {
        return;
      }

      message.chat.users.forEach((user) => {
        const userId = user && user._id ? String(user._id) : null;
        if (!userId || userId === String(message.sender?._id || "")) {
          return;
        }
        io.to(userId).emit("message received", message);
      });
    });

    // Legacy private messaging
    socket.on("private_message", async (payload) => {
      if (!payload || !payload.to || !payload.from) return;

      const to = normalizeUsername(payload.to);
      const from = normalizeUsername(payload.from);
      if (!to || !from) return;

      const outgoing = {
        ...payload,
        to,
        from,
        messageId:
          String(payload.messageId || "").trim() ||
          `${Date.now()}_${from}`,
        timestamp: payload.timestamp || new Date().toISOString(),
      };

      try {
        const enc = encryptText(String(outgoing.message || ""));
        const msgDoc = {
          kind: "private",
          conversationKey: privateConversationKey(from, to),
          from,
          to,
          messageId: outgoing.messageId,
          cipherText: enc.cipherText,
          iv: enc.iv,
          authTag: enc.authTag,
          sentAt: new Date(outgoing.timestamp),
          isForwarded: !!payload.isForwarded,
          replyTo: payload.replyTo || null,
        };
        await LegacyMessage.create(msgDoc);
        
        // Save to file system folders for both users
        saveMessageToFile(from, to, false, msgDoc);
        saveMessageToFile(to, from, false, msgDoc);
      } catch (error) {
        console.warn(`Legacy private message store error: ${error.message}`);
      }

      const room = io.sockets.adapter.rooms.get(to);
      const isRecipientOnline = !!room && room.size > 0;

      if (isRecipientOnline) {
        io.to(to).emit("private_message", outgoing);
        io.to(from).emit("chat:delivered", {
          messageId: outgoing.messageId,
        });
        return;
      }

      try {
        await User.updateOne(
          {
            $or: [{ username: to }, { email: `${to}@cyberlink.local` }],
          },
          {
            $push: {
              pendingMessages: {
                from: outgoing.from,
                to: outgoing.to,
                message: String(outgoing.message || ""),
                messageId: outgoing.messageId,
                timestamp: new Date(outgoing.timestamp),
                type: "private",
              },
            },
          }
        );
      } catch (error) {
        // Keep socket handler resilient; pending sync can recover.
        console.warn(`Pending store error: ${error.message}`);
      }

      sendFcmToUsernames([to], {
        title: from,
        body: String(outgoing.notificationBody || "New encrypted message"),
        data: {
          type: "private",
          chatId: from,
          sender: from,
          messageId: outgoing.messageId,
        },
      });
    });

    socket.on("private_message_seen", (payload) => {
      if (!payload || !payload.to || !payload.messageId) return;
      const to = normalizeUsername(payload.to);
      const from = socket.data.username;
      io.to(to).emit("chat:seen", { messageId: payload.messageId });
    });

    socket.on("message_reaction", async (payload) => {
      if (!payload || !payload.messageId || payload.emoji === undefined) return;
      const username = socket.data.username;
      if (!username) return;

      const { messageId, emoji, to, group } = payload;
      
      try {
        const msg = await LegacyMessage.findOne({ messageId });
        if (msg) {
          let reactions = msg.reactions || [];
          if (!emoji) { // Remove reaction
            reactions = reactions.filter(r => r.user !== username);
          } else {
            const existing = reactions.find(r => r.user === username);
            if (existing) {
              existing.emoji = emoji;
              existing.createdAt = new Date();
            } else {
              reactions.push({ user: username, emoji, createdAt: new Date() });
            }
          }
          msg.reactions = reactions;
          await msg.save();
        }
      } catch (e) {
        console.warn("Reaction store error", e);
      }

      if (to) {
        io.to(normalizeUsername(to)).emit("message_reaction", { messageId, emoji, user: username });
        io.to(username).emit("message_reaction", { messageId, emoji, user: username });
      } else if (group) {
        io.to(String(group)).emit("message_reaction", { messageId, emoji, user: username });
      }
    });

    socket.on("delete_message", async (payload) => {
      if (!payload || !payload.messageId) return;
      const username = socket.data.username;
      if (!username) return;
      
      const { messageId, to, group } = payload;

      try {
        const msg = await LegacyMessage.findOne({ messageId });
        if (msg && msg.from === username) {
          msg.deletedForEveryone = true;
          await msg.save();
        }
      } catch (e) {
        console.warn("Delete message error", e);
      }

      if (to) {
        io.to(normalizeUsername(to)).emit("delete_message", { messageId });
        io.to(username).emit("delete_message", { messageId });
      } else if (group) {
        io.to(String(group)).emit("delete_message", { messageId });
      }
    });

    socket.on("star_message", async (payload) => {
      if (!payload || !payload.messageId || payload.star === undefined) return;
      const username = socket.data.username;
      if (!username) return;

      const { messageId, star, to, group } = payload;
      
      try {
        const msg = await LegacyMessage.findOne({ messageId });
        if (msg) {
          let starredBy = msg.starredBy || [];
          if (star) {
            if (!starredBy.includes(username)) starredBy.push(username);
          } else {
            starredBy = starredBy.filter(u => u !== username);
          }
          msg.starredBy = starredBy;
          await msg.save();
        }
      } catch (e) {
        console.warn("Star message store error", e);
      }

      if (to) {
        io.to(normalizeUsername(to)).emit("star_message", { messageId, star, user: username });
        io.to(username).emit("star_message", { messageId, star, user: username });
      } else if (group) {
        io.to(String(group)).emit("star_message", { messageId, star, user: username });
      }
    });

    socket.on("join_group", (payload) => {
      const group = payload && payload.group;
      if (!group) return;
      socket.join(`group:${group}`);
    });

    socket.on("leave_group", (payload) => {
      const group = payload && payload.group;
      if (!group) return;
      socket.leave(`group:${group}`);
    });

    socket.on("group_message", async (payload) => {
      if (!payload || !payload.group) return;
      const normalizedGroup = String(payload.group).trim();
      const outgoing = {
        ...payload,
        group: normalizedGroup,
        from: normalizeUsername(payload.from),
        messageId:
          String(payload.messageId || "").trim() ||
          `${Date.now()}_${normalizeUsername(payload.from)}`,
        timestamp: payload.timestamp || new Date().toISOString(),
      };

      (async () => {
        try {
          const enc = encryptText(String(outgoing.message || ""));
          const msgDoc = {
            kind: "group",
            conversationKey: groupConversationKey(normalizedGroup),
            from: outgoing.from,
            group: normalizedGroup,
            messageId: outgoing.messageId,
            cipherText: enc.cipherText,
            iv: enc.iv,
            authTag: enc.authTag,
            sentAt: new Date(outgoing.timestamp),
            isForwarded: !!payload.isForwarded,
            replyTo: payload.replyTo || null,
          };
          await LegacyMessage.create(msgDoc);
          
          // Save to file system folder for the group sender
          saveMessageToFile(outgoing.from, normalizedGroup, true, msgDoc);
          
          // Note: In a real group setup, you'd also save this to every member's folder.
          // Since we might not have the full member list synchronously here, we can rely 
          // on the offline fetch to populate other members' local DBs, or just fetch from 
          // the central group DB. For now, saving to the sender's folder.
          
        } catch (error) {
          console.warn(`Legacy group message store error: ${error.message}`);
        }
      })();
      socket.to(`group:${normalizedGroup}`).emit("group_message", outgoing);

      try {
        const chat = await Chat.findOne({
          isGroupChat: true,
          chatName: normalizedGroup,
        }).populate("users", "username email");
        if (!chat) return;

        const sender = normalizeUsername(outgoing.from);
        const offlineMembers = chat.users
          .map((u) => normalizeUsername(u.username || String(u.email || "").split("@")[0]))
          .filter((u) => u && u !== sender)
          .filter((u) => {
            const room = io.sockets.adapter.rooms.get(u);
            return !room || room.size === 0;
          });

        if (!offlineMembers.length) return;
        await sendFcmToUsernames(offlineMembers, {
          title: normalizedGroup,
          body: `${sender}: ${String(outgoing.message || "")}`,
          data: {
            type: "group",
            chatId: normalizedGroup,
            group: normalizedGroup,
            sender,
            messageId: outgoing.messageId,
          },
        });
      } catch (error) {
        console.warn(`Group FCM error: ${error.message}`);
      }
    });

    socket.on("group_typing", (payload) => {
      if (!payload || !payload.group) return;
      socket.to(`group:${payload.group}`).emit("group_typing", payload);
    });

    socket.on("message updated", (message) => {
      if (!message || !message.chat || !Array.isArray(message.chat.users)) {
        return;
      }

      message.chat.users.forEach((user) => {
        const userId = user && user._id ? String(user._id) : null;
        if (!userId) {
          return;
        }
        io.to(userId).emit("message updated", message);
      });
    });

    socket.on("message delivered", (payload) => {
      if (!payload || !payload.chatId) {
        return;
      }
      socket.to(String(payload.chatId)).emit("messages delivered", payload);
    });

    socket.on("message seen", (payload) => {
      if (!payload || !payload.chatId) {
        return;
      }
      socket.to(String(payload.chatId)).emit("messages seen", payload);
    });

    socket.on("webrtc_offer", (payload) => {
      if (!payload || !payload.to || !payload.offer) return;
      io.to(normalizeUsername(payload.to)).emit("webrtc_offer", {
        from: socket.data.username,
        offer: payload.offer,
      });
    });

    socket.on("webrtc_answer", (payload) => {
      if (!payload || !payload.to || !payload.answer) return;
      io.to(normalizeUsername(payload.to)).emit("webrtc_answer", {
        from: socket.data.username,
        answer: payload.answer,
      });
    });

    socket.on("webrtc_ice_candidate", (payload) => {
      if (!payload || !payload.to || !payload.candidate) return;
      io.to(normalizeUsername(payload.to)).emit("webrtc_ice_candidate", {
        from: socket.data.username,
        candidate: payload.candidate,
      });
    });

    socket.on("webrtc_end_call", (payload) => {
      if (!payload || !payload.to) return;
      io.to(normalizeUsername(payload.to)).emit("webrtc_end_call", {
        from: socket.data.username,
      });
    });

    socket.on("disconnect", () => {
      if (socket.data.username) {
        io.emit("presence:update", { userId: socket.data.username, status: "offline" });
        socket.leave(socket.data.username);
      }
      if (socket.data.userId) {
        socket.leave(socket.data.userId);
      }
      io.emit("presence:snapshot", { onlineUsers: getOnlineUsers() });
    });
  });
}

module.exports = setupSocket;
