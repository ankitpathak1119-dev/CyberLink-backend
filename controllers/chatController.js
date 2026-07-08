const admin = require("firebase-admin");
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const User = require("../models/User");

const EDIT_WINDOW_MINUTES = 15;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function emitToChatUsers(io, users, senderId, eventName, payload) {
  if (!io || !Array.isArray(users)) {
    return;
  }

  users.forEach((user) => {
    const userId = String(user._id || user);
    if (senderId && userId === String(senderId)) {
      return;
    }
    io.to(userId).emit(eventName, payload);
  });
}

async function populateMessage(messageId) {
  return Message.findById(messageId)
    .populate("sender", "name email avatar")
    .populate({
      path: "chat",
      populate: [
        { path: "users", select: "name email avatar" },
        { path: "groupAdmin", select: "name email avatar" },
      ],
    })
    .populate({
      path: "replyTo",
      select: "content sender createdAt",
      populate: { path: "sender", select: "name email avatar" },
    })
    .populate({
      path: "forwardedFrom",
      select: "content sender createdAt",
      populate: { path: "sender", select: "name email avatar" },
    })
    .populate("reactions.user", "name email avatar")
    .populate("deliveredTo.user", "name email avatar")
    .populate("seenBy.user", "name email avatar");
}

async function populateChat(chatId) {
  return Chat.findById(chatId)
    .populate("users", "name email avatar")
    .populate("groupAdmin", "name email avatar")
    .populate({
      path: "latestMessage",
      populate: { path: "sender", select: "name email avatar" },
    });
}

async function createOrAccessOneToOneChat(req, res, next) {
  try {
    const { userId } = req.body;

    if (!userId) {
      throw createHttpError(400, "userId is required");
    }

    if (String(userId) === String(req.user._id)) {
      throw createHttpError(400, "Cannot create chat with self");
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      throw createHttpError(404, "Target user not found");
    }

    let chat = await Chat.findOne({
      isGroupChat: false,
      users: { $all: [req.user._id, userId] },
    })
      .populate("users", "name email avatar")
      .populate({
        path: "latestMessage",
        populate: { path: "sender", select: "name email avatar" },
      });

    if (!chat) {
      chat = await Chat.create({
        chatName: "direct",
        isGroupChat: false,
        users: [req.user._id, userId],
      });

      chat = await populateChat(chat._id);
    }

    res.status(200).json({ success: true, chat });
  } catch (error) {
    next(error);
  }
}

async function createGroupChat(req, res, next) {
  try {
    const { chatName, users } = req.body;

    if (!chatName || !Array.isArray(users) || users.length < 2) {
      throw createHttpError(400, "chatName and at least 2 users are required for group chat");
    }

    const uniqueUsers = [...new Set(users.map((id) => String(id)))].filter(
      (id) => id !== String(req.user._id)
    );

    if (uniqueUsers.length < 2) {
      throw createHttpError(400, "Group chat needs at least 3 members including you");
    }

    const chat = await Chat.create({
      chatName: String(chatName).trim(),
      isGroupChat: true,
      users: [req.user._id, ...uniqueUsers],
      groupAdmin: req.user._id,
    });

    const fullChat = await populateChat(chat._id);
    res.status(201).json({ success: true, chat: fullChat });
  } catch (error) {
    next(error);
  }
}

async function addToGroup(req, res, next) {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      throw createHttpError(400, "chatId and userId are required");
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      throw createHttpError(404, "Chat not found");
    }

    if (!chat.isGroupChat) {
      throw createHttpError(400, "Cannot add users to non-group chat");
    }

    if (String(chat.groupAdmin) !== String(req.user._id)) {
      throw createHttpError(403, "Only group admin can add users");
    }

    if (chat.users.some((id) => String(id) === String(userId))) {
      const fullChat = await populateChat(chat._id);
      return res.status(200).json({ success: true, chat: fullChat });
    }

    chat.users.push(userId);
    await chat.save();

    const fullChat = await populateChat(chat._id);
    res.status(200).json({ success: true, chat: fullChat });
  } catch (error) {
    next(error);
  }
}

async function removeFromGroup(req, res, next) {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      throw createHttpError(400, "chatId and userId are required");
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      throw createHttpError(404, "Chat not found");
    }

    if (!chat.isGroupChat) {
      throw createHttpError(400, "Cannot remove users from non-group chat");
    }

    const isAdmin = String(chat.groupAdmin) === String(req.user._id);
    const isSelfRemoval = String(userId) === String(req.user._id);

    if (!isAdmin && !isSelfRemoval) {
      throw createHttpError(403, "Only admin can remove other users");
    }

    chat.users = chat.users.filter((id) => String(id) !== String(userId));

    if (chat.users.length < 2) {
      await Message.deleteMany({ chat: chat._id });
      await Chat.deleteOne({ _id: chat._id });
      return res.status(200).json({ success: true, message: "Group deleted due to low members" });
    }

    if (String(chat.groupAdmin) === String(userId)) {
      chat.groupAdmin = chat.users[0];
    }

    await chat.save();

    const fullChat = await populateChat(chat._id);
    res.status(200).json({ success: true, chat: fullChat });
  } catch (error) {
    next(error);
  }
}

async function getChatList(req, res, next) {
  try {
    const chats = await Chat.find({ users: { $elemMatch: { $eq: req.user._id } } })
      .populate("users", "name email avatar")
      .populate("groupAdmin", "name email avatar")
      .populate({
        path: "latestMessage",
        populate: { path: "sender", select: "name email avatar" },
      })
      .sort({ updatedAt: -1 });

    res.status(200).json({ success: true, chats });
  } catch (error) {
    next(error);
  }
}

async function getChatMessages(req, res, next) {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } },
    });

    if (!chat) {
      throw createHttpError(404, "Chat not found or access denied");
    }

    const messages = await Message.find({ chat: chatId })
      .populate("sender", "name email avatar")
      .populate({
        path: "replyTo",
        select: "content sender createdAt",
        populate: { path: "sender", select: "name email avatar" },
      })
      .populate({
        path: "forwardedFrom",
        select: "content sender createdAt",
        populate: { path: "sender", select: "name email avatar" },
      })
      .populate("reactions.user", "name email avatar")
      .populate("deliveredTo.user", "name email avatar")
      .populate("seenBy.user", "name email avatar")
      .sort({ createdAt: 1 });

    res.status(200).json({ success: true, messages });
  } catch (error) {
    next(error);
  }
}

async function notifyRecipientsWithFcm(messageDoc, chatDoc, senderDoc) {
  if (!admin.apps.length) {
    return;
  }

  const recipientIds = chatDoc.users
    .map((id) => String(id._id || id))
    .filter((id) => id !== String(senderDoc._id));

  if (!recipientIds.length) {
    return;
  }

  const recipients = await User.find({ _id: { $in: recipientIds } }).select("fcmTokens");
  const tokens = recipients.flatMap((u) => u.fcmTokens || []).filter(Boolean);

  if (!tokens.length) {
    return;
  }

  try {
    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: senderDoc.name,
        body: messageDoc.content,
      },
      data: {
        chatId: String(chatDoc._id),
        messageId: String(messageDoc._id),
        senderId: String(senderDoc._id),
        type: "chat_message",
      },
    });
  } catch (error) {
    console.warn(`FCM send error: ${error.message}`);
  }
}

async function sendMessage(req, res, next) {
  try {
    const { chatId } = req.params;
    const { content, replyToMessageId } = req.body;

    if (!content || !String(content).trim()) {
      throw createHttpError(400, "Message content is required");
    }

    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } },
    }).populate("users", "name email avatar");

    if (!chat) {
      throw createHttpError(404, "Chat not found or access denied");
    }

    let replyTo = null;
    if (replyToMessageId) {
      replyTo = await Message.findOne({ _id: replyToMessageId, chat: chatId }).select("_id");
      if (!replyTo) {
        throw createHttpError(400, "Reply target message not found in this chat");
      }
    }

    let message = await Message.create({
      sender: req.user._id,
      content: String(content).trim(),
      chat: chat._id,
      replyTo: replyTo ? replyTo._id : null,
      deliveredTo: [{ user: req.user._id, at: new Date() }],
      seenBy: [{ user: req.user._id, at: new Date() }],
    });

    await Chat.findByIdAndUpdate(chat._id, { latestMessage: message._id }, { new: true });
    message = await populateMessage(message._id);

    const io = req.app.get("io");
    if (io) {
      emitToChatUsers(io, chat.users, req.user._id, "message received", message);
    }

    await notifyRecipientsWithFcm(message, chat, req.user);

    res.status(201).json({ success: true, message });
  } catch (error) {
    next(error);
  }
}

async function editMessage(req, res, next) {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || !String(content).trim()) {
      throw createHttpError(400, "Updated content is required");
    }

    const message = await Message.findById(messageId).populate({
      path: "chat",
      select: "users",
    });

    if (!message || !message.chat) {
      throw createHttpError(404, "Message not found");
    }

    const isMember = message.chat.users.some((id) => String(id) === String(req.user._id));
    if (!isMember) {
      throw createHttpError(403, "Access denied for this chat");
    }

    if (String(message.sender) !== String(req.user._id)) {
      throw createHttpError(403, "You can only edit your own message");
    }

    const cutoff = new Date(Date.now() - EDIT_WINDOW_MINUTES * 60 * 1000);
    if (message.createdAt < cutoff) {
      throw createHttpError(403, `Edit window exceeded (${EDIT_WINDOW_MINUTES} minutes)`);
    }

    message.content = String(content).trim();
    message.edited = true;
    message.editedAt = new Date();
    await message.save();

    const hydrated = await populateMessage(message._id);

    const io = req.app.get("io");
    if (io && hydrated && hydrated.chat && hydrated.chat.users) {
      emitToChatUsers(io, hydrated.chat.users, null, "message updated", hydrated);
    }

    res.status(200).json({ success: true, message: hydrated });
  } catch (error) {
    next(error);
  }
}

async function toggleReaction(req, res, next) {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji || !String(emoji).trim()) {
      throw createHttpError(400, "emoji is required");
    }

    const message = await Message.findById(messageId).populate({
      path: "chat",
      select: "users",
    });

    if (!message || !message.chat) {
      throw createHttpError(404, "Message not found");
    }

    const isMember = message.chat.users.some((id) => String(id) === String(req.user._id));
    if (!isMember) {
      throw createHttpError(403, "Access denied for this chat");
    }

    const cleanedEmoji = String(emoji).trim();
    const existingReactionIndex = message.reactions.findIndex(
      (reaction) => String(reaction.user) === String(req.user._id)
    );

    if (existingReactionIndex >= 0) {
      if (message.reactions[existingReactionIndex].emoji === cleanedEmoji) {
        message.reactions.splice(existingReactionIndex, 1);
      } else {
        message.reactions[existingReactionIndex].emoji = cleanedEmoji;
        message.reactions[existingReactionIndex].createdAt = new Date();
      }
    } else {
      message.reactions.push({
        user: req.user._id,
        emoji: cleanedEmoji,
        createdAt: new Date(),
      });
    }

    await message.save();
    const hydrated = await populateMessage(message._id);

    const io = req.app.get("io");
    if (io && hydrated && hydrated.chat && hydrated.chat.users) {
      emitToChatUsers(io, hydrated.chat.users, null, "message updated", hydrated);
    }

    res.status(200).json({ success: true, message: hydrated });
  } catch (error) {
    next(error);
  }
}

async function forwardMessage(req, res, next) {
  try {
    const { messageId } = req.params;
    const { targetChatIds } = req.body;

    if (!Array.isArray(targetChatIds) || targetChatIds.length === 0) {
      throw createHttpError(400, "targetChatIds array is required");
    }

    const original = await Message.findById(messageId).populate({ path: "chat", select: "users" });
    if (!original || !original.chat) {
      throw createHttpError(404, "Source message not found");
    }

    const isSourceMember = original.chat.users.some((id) => String(id) === String(req.user._id));
    if (!isSourceMember) {
      throw createHttpError(403, "Cannot forward from a chat you are not part of");
    }

    const uniqueTargetIds = [...new Set(targetChatIds.map((id) => String(id)))];
    const targetChats = await Chat.find({
      _id: { $in: uniqueTargetIds },
      users: { $elemMatch: { $eq: req.user._id } },
    }).populate("users", "name email avatar");

    if (!targetChats.length) {
      throw createHttpError(404, "No valid target chats found");
    }

    const createdMessages = [];
    const io = req.app.get("io");

    for (const chat of targetChats) {
      let forwarded = await Message.create({
        sender: req.user._id,
        content: original.content,
        chat: chat._id,
        forwardedFrom: original._id,
        deliveredTo: [{ user: req.user._id, at: new Date() }],
        seenBy: [{ user: req.user._id, at: new Date() }],
      });

      await Chat.findByIdAndUpdate(chat._id, { latestMessage: forwarded._id }, { new: true });
      forwarded = await populateMessage(forwarded._id);
      createdMessages.push(forwarded);

      if (io) {
        emitToChatUsers(io, chat.users, req.user._id, "message received", forwarded);
      }

      await notifyRecipientsWithFcm(forwarded, chat, req.user);
    }

    res.status(201).json({ success: true, messages: createdMessages });
  } catch (error) {
    next(error);
  }
}

async function markMessagesDelivered(req, res, next) {
  try {
    const { chatId } = req.params;
    const { messageIds = [] } = req.body || {};

    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } },
    }).populate("users", "_id");

    if (!chat) {
      throw createHttpError(404, "Chat not found or access denied");
    }

    const query = {
      chat: chatId,
      sender: { $ne: req.user._id },
      "deliveredTo.user": { $ne: req.user._id },
    };

    if (Array.isArray(messageIds) && messageIds.length > 0) {
      query._id = { $in: messageIds };
    }

    const pending = await Message.find(query).select("_id deliveredTo");
    if (!pending.length) {
      return res.status(200).json({ success: true, updatedCount: 0, messageIds: [] });
    }

    const timestamp = new Date();
    const ops = pending.map((msg) => ({
      updateOne: {
        filter: { _id: msg._id },
        update: { $push: { deliveredTo: { user: req.user._id, at: timestamp } } },
      },
    }));

    await Message.bulkWrite(ops);

    const updatedIds = pending.map((msg) => String(msg._id));
    const payload = {
      chatId: String(chatId),
      messageIds: updatedIds,
      userId: String(req.user._id),
      at: timestamp,
    };

    const io = req.app.get("io");
    if (io) {
      emitToChatUsers(io, chat.users, req.user._id, "messages delivered", payload);
    }

    res.status(200).json({ success: true, updatedCount: updatedIds.length, messageIds: updatedIds });
  } catch (error) {
    next(error);
  }
}

async function markMessagesSeen(req, res, next) {
  try {
    const { chatId } = req.params;
    const { messageIds = [] } = req.body || {};

    const chat = await Chat.findOne({
      _id: chatId,
      users: { $elemMatch: { $eq: req.user._id } },
    }).populate("users", "_id");

    if (!chat) {
      throw createHttpError(404, "Chat not found or access denied");
    }

    const query = {
      chat: chatId,
      sender: { $ne: req.user._id },
      "seenBy.user": { $ne: req.user._id },
    };

    if (Array.isArray(messageIds) && messageIds.length > 0) {
      query._id = { $in: messageIds };
    }

    const pending = await Message.find(query).select("_id deliveredTo seenBy");
    if (!pending.length) {
      return res.status(200).json({ success: true, updatedCount: 0, messageIds: [] });
    }

    const timestamp = new Date();
    const ops = pending.map((msg) => {
      const hasDelivered = msg.deliveredTo.some(
        (entry) => String(entry.user) === String(req.user._id)
      );

      const update = hasDelivered
        ? { $push: { seenBy: { user: req.user._id, at: timestamp } } }
        : {
            $push: {
              deliveredTo: { user: req.user._id, at: timestamp },
              seenBy: { user: req.user._id, at: timestamp },
            },
          };

      return {
        updateOne: {
          filter: { _id: msg._id },
          update,
        },
      };
    });

    await Message.bulkWrite(ops);

    const updatedIds = pending.map((msg) => String(msg._id));
    const payload = {
      chatId: String(chatId),
      messageIds: updatedIds,
      userId: String(req.user._id),
      at: timestamp,
    };

    const io = req.app.get("io");
    if (io) {
      emitToChatUsers(io, chat.users, req.user._id, "messages seen", payload);
    }

    res.status(200).json({ success: true, updatedCount: updatedIds.length, messageIds: updatedIds });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createOrAccessOneToOneChat,
  createGroupChat,
  addToGroup,
  removeFromGroup,
  getChatList,
  getChatMessages,
  sendMessage,
  editMessage,
  toggleReaction,
  forwardMessage,
  markMessagesDelivered,
  markMessagesSeen,
};
