const Chat = require("../models/Chat");
const User = require("../models/User");
const LegacyMessage = require("../models/LegacyMessage");
const Status = require("../models/Status");
const {
  decryptText,
  privateConversationKey,
  groupConversationKey,
} = require("../utils/messageCrypto");
const { syncUserStorage } = require("../utils/storage");

function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function dedupe(items) {
  return [...new Set((items || []).map((i) => String(i).trim()).filter(Boolean))];
}

async function findUserByUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return null;
  return User.findOne({
    $or: [{ username: u }, { email: `${u}@cyberlink.local` }],
  });
}

function publicGroup(chat, usernamesById) {
  return {
    group: chat.chatName,
    owner: usernamesById[String(chat.groupAdmin)] || "",
    members: chat.users.map((u) => usernamesById[String(u)] || "").filter(Boolean),
    isGroup: true,
    chatId: String(chat._id),
  };
}

async function getContacts(req, res, next) {
  try {
    const user = await findUserByUsername(req.params.user);
    if (!user) return res.status(200).json({ contacts: [] });
    res.status(200).json({ contacts: dedupe(user.contacts) });
  } catch (error) {
    next(error);
  }
}

async function sendContactRequest(req, res, next) {
  try {
    const from = normalizeUsername(req.body.from);
    const to = normalizeUsername(req.body.to);
    if (!from || !to || from === to) {
      return res.status(400).json({ error: "Invalid users" });
    }

    const fromUser = await findUserByUsername(from);
    const toUser = await findUserByUsername(to);

    if (!fromUser || !toUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (toUser.contacts.includes(from)) {
      return res.status(200).json({ success: true, message: "Already contacts" });
    }

    if (!toUser.contactRequests.includes(from)) {
      toUser.contactRequests.push(from);
      await toUser.save();
    }

    res.status(200).json({ success: true, message: "Request sent" });
  } catch (error) {
    next(error);
  }
}

async function getContactRequests(req, res, next) {
  try {
    const user = await findUserByUsername(req.params.user);
    if (!user) return res.status(200).json({ requests: [] });

    const requests = dedupe(user.contactRequests).map((from) => ({ from }));
    res.status(200).json({ requests });
  } catch (error) {
    next(error);
  }
}

async function acceptContactRequest(req, res, next) {
  try {
    const from = normalizeUsername(req.body.from);
    const to = normalizeUsername(req.body.to);

    const fromUser = await findUserByUsername(from);
    const toUser = await findUserByUsername(to);
    if (!fromUser || !toUser) {
      return res.status(404).json({ error: "User not found" });
    }

    toUser.contactRequests = toUser.contactRequests.filter((u) => u !== from);
    if (!toUser.contacts.includes(from)) toUser.contacts.push(from);
    if (!fromUser.contacts.includes(to)) fromUser.contacts.push(to);

    await Promise.all([toUser.save(), fromUser.save()]);

    // Notify the original sender via socket that their request was accepted
    const io = req.app.get("io");
    if (io) {
      io.to(from).emit("contact_accepted", {
        from: to,
        to: from,
        message: `Now you can chat with ${to}`,
      });
      // Also notify both users to refresh their contact lists
      io.to(from).emit("contacts_update", { action: "accepted", user: to });
      io.to(to).emit("contacts_update", { action: "accepted", user: from });
    }

    res.status(200).json({ success: true, message: "Accepted" });
  } catch (error) {
    next(error);
  }
}

async function declineContactRequest(req, res, next) {
  try {
    const from = normalizeUsername(req.body.from);
    const to = normalizeUsername(req.body.to);

    const toUser = await findUserByUsername(to);
    if (!toUser) return res.status(404).json({ error: "User not found" });

    toUser.contactRequests = toUser.contactRequests.filter((u) => u !== from);
    await toUser.save();

    const io = req.app.get("io");
    if (io) {
      io.to(from).emit("contact_declined", {
        from: to,
        to: from,
        message: `${to} declined your contact request`,
      });
    }

    res.status(200).json({ success: true, message: "Declined" });
  } catch (error) {
    next(error);
  }
}

async function removeContact(req, res, next) {
  try {
    const owner = normalizeUsername(req.body.owner);
    const contact = normalizeUsername(req.body.contact);

    const ownerUser = await findUserByUsername(owner);
    const contactUser = await findUserByUsername(contact);
    if (!ownerUser || !contactUser) {
      return res.status(404).json({ error: "User not found" });
    }

    ownerUser.contacts = ownerUser.contacts.filter((u) => u !== contact);
    contactUser.contacts = contactUser.contacts.filter((u) => u !== owner);

    await Promise.all([ownerUser.save(), contactUser.save()]);
    res.status(200).json({ success: true, message: "Removed" });
  } catch (error) {
    next(error);
  }
}

async function getGroups(req, res, next) {
  try {
    const username = normalizeUsername(req.params.user);
    const user = await findUserByUsername(username);
    if (!user) return res.status(200).json({ groups: [] });

    const chats = await Chat.find({
      isGroupChat: true,
      users: { $elemMatch: { $eq: user._id } },
    }).select("chatName users groupAdmin");

    const allIds = [...new Set(chats.flatMap((c) => c.users.map((id) => String(id))))];
    const users = await User.find({ _id: { $in: allIds } }).select("username email");
    const usernamesById = Object.fromEntries(
      users.map((u) => [String(u._id), u.username || String(u.email).split("@")[0]])
    );

    res.status(200).json({ groups: chats.map((c) => publicGroup(c, usernamesById)) });
  } catch (error) {
    next(error);
  }
}

async function createGroup(req, res, next) {
  try {
    const group = String(req.body.group || "").trim();
    const owner = normalizeUsername(req.body.owner);
    const members = dedupe(req.body.members || []);

    if (!group || !owner) return res.status(400).json({ error: "group and owner required" });

    const ownerUser = await findUserByUsername(owner);
    if (!ownerUser) return res.status(404).json({ error: "Owner not found" });

    const memberUsers = await User.find({ username: { $in: members } }).select("_id username email");
    const userIds = dedupe([String(ownerUser._id), ...memberUsers.map((u) => String(u._id))]);

    const existing = await Chat.findOne({ isGroupChat: true, chatName: group });
    if (existing) {
      return res.status(409).json({ error: "Group already exists" });
    }

    const chat = await Chat.create({
      chatName: group,
      isGroupChat: true,
      users: userIds,
      groupAdmin: ownerUser._id,
    });

    const usernamesById = {
      [String(ownerUser._id)]: owner,
      ...Object.fromEntries(
        memberUsers.map((u) => [String(u._id), u.username || String(u.email).split("@")[0]])
      ),
    };

    const io = req.app.get("io");
    if (io) {
      io.emit("group_updated", { group });
    }

    res.status(201).json({ success: true, group: publicGroup(chat, usernamesById) });
  } catch (error) {
    next(error);
  }
}

async function addGroupMember(req, res, next) {
  try {
    const group = String(req.body.group || "").trim();
    const owner = normalizeUsername(req.body.owner);
    const member = normalizeUsername(req.body.member);

    const ownerUser = await findUserByUsername(owner);
    const memberUser = await findUserByUsername(member);
    if (!ownerUser || !memberUser) return res.status(404).json({ error: "User not found" });

    const chat = await Chat.findOne({ isGroupChat: true, chatName: group });
    if (!chat) return res.status(404).json({ error: "Group not found" });
    if (String(chat.groupAdmin) !== String(ownerUser._id)) {
      return res.status(403).json({ error: "Only owner can add member" });
    }

    if (!chat.users.some((id) => String(id) === String(memberUser._id))) {
      chat.users.push(memberUser._id);
      await chat.save();
    }

    res.status(200).json({ success: true, message: "Member added" });
  } catch (error) {
    next(error);
  }
}

async function removeGroupMember(req, res, next) {
  try {
    const group = String(req.body.group || "").trim();
    const owner = normalizeUsername(req.body.owner);
    const member = normalizeUsername(req.body.member);

    const ownerUser = await findUserByUsername(owner);
    const memberUser = await findUserByUsername(member);
    if (!ownerUser || !memberUser) return res.status(404).json({ error: "User not found" });

    const chat = await Chat.findOne({ isGroupChat: true, chatName: group });
    if (!chat) return res.status(404).json({ error: "Group not found" });
    if (String(chat.groupAdmin) !== String(ownerUser._id)) {
      return res.status(403).json({ error: "Only owner can remove member" });
    }

    chat.users = chat.users.filter((id) => String(id) !== String(memberUser._id));
    await chat.save();
    res.status(200).json({ success: true, message: "Member removed" });
  } catch (error) {
    next(error);
  }
}

async function deleteGroup(req, res, next) {
  try {
    const group = String(req.body.group || "").trim();
    const owner = normalizeUsername(req.body.owner);
    const ownerUser = await findUserByUsername(owner);
    if (!ownerUser) return res.status(404).json({ error: "Owner not found" });

    const chat = await Chat.findOne({ isGroupChat: true, chatName: group });
    if (!chat) return res.status(404).json({ error: "Group not found" });
    if (String(chat.groupAdmin) !== String(ownerUser._id)) {
      return res.status(403).json({ error: "Only owner can delete group" });
    }

    await Chat.deleteOne({ _id: chat._id });
    res.status(200).json({ success: true, message: "Group deleted" });
  } catch (error) {
    next(error);
  }
}

async function leaveGroup(req, res, next) {
  try {
    const group = String(req.body.group || "").trim();
    const userName = normalizeUsername(req.body.user);
    const user = await findUserByUsername(userName);
    if (!user) return res.status(404).json({ error: "User not found" });

    const chat = await Chat.findOne({ isGroupChat: true, chatName: group });
    if (!chat) return res.status(404).json({ error: "Group not found" });

    chat.users = chat.users.filter((id) => String(id) !== String(user._id));
    if (String(chat.groupAdmin) === String(user._id) && chat.users.length > 0) {
      chat.groupAdmin = chat.users[0];
    }
    await chat.save();

    res.status(200).json({ success: true, message: "Left group" });
  } catch (error) {
    next(error);
  }
}

async function saveFcmToken(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    const token = String(req.body.fcmToken || "").trim();
    if (!username || !token) return res.status(400).json({ error: "username and fcmToken required" });

    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    await User.updateOne({ _id: user._id }, { $addToSet: { fcmTokens: token } });
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}

async function savePublicKey(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    const publicKey = String(req.body.publicKey || "").trim();
    if (!username || !publicKey) {
      return res.status(400).json({ error: "username and publicKey required" });
    }

    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.publicKey = publicKey;
    await user.save();
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function getPublicKey(req, res, next) {
  try {
    const username = normalizeUsername(req.params.username);
    if (!username) {
      return res.status(400).json({ error: "username required" });
    }
    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.status(200).json({ publicKey: user.publicKey || null });
  } catch (error) {
    return next(error);
  }
}

async function fetchPendingMessages(req, res, next) {
  try {
    const username = normalizeUsername(req.params.username);
    if (!username) {
      return res.status(400).json({ error: "username is required" });
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(200).json({ messages: [] });
    }

    const messages = (user.pendingMessages || [])
      .filter((m) => m && m.type === "private")
      .map((m) => ({
        from: String(m.from || ""),
        to: String(m.to || ""),
        message: String(m.message || ""),
        messageId: String(m.messageId || ""),
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
        type: "private",
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return res.status(200).json({ messages });
  } catch (error) {
    return next(error);
  }
}

async function deletePendingMessages(req, res, next) {
  try {
    const username = normalizeUsername(req.body.username);
    const peer = normalizeUsername(req.body.peer);
    if (!username) {
      return res.status(400).json({ error: "username is required" });
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(200).json({ success: true, deleted: 0 });
    }

    const before = (user.pendingMessages || []).length;
    user.pendingMessages = (user.pendingMessages || []).filter((m) => {
      if (!m || m.type !== "private") return true;
      if (peer) return normalizeUsername(m.from) !== peer;
      return false;
    });
    await user.save();

    const after = (user.pendingMessages || []).length;
    return res.status(200).json({ success: true, deleted: before - after });
  } catch (error) {
    return next(error);
  }
}

async function fetchPrivateHistory(req, res, next) {
  try {
    const userA = normalizeUsername(req.params.userA);
    const userB = normalizeUsername(req.params.userB);
    if (!userA || !userB) {
      return res.status(400).json({ error: "userA and userB required" });
    }

    const limitRaw = Number(req.query.limit || 500);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(limitRaw, 2000))
      : 500;
    const key = privateConversationKey(userA, userB);
    const docs = await LegacyMessage.find({
      kind: "private",
      conversationKey: key,
    })
      .sort({ sentAt: 1 })
      .limit(limit);

    const messages = docs.map((d) => {
      let text = "";
      try {
        text = decryptText({
          cipherText: d.cipherText,
          iv: d.iv,
          authTag: d.authTag,
        });
      } catch (_) {
        text = "";
      }
      return {
        from: d.from,
        to: d.to,
        message: text,
        messageId: d.messageId,
        timestamp: d.sentAt ? new Date(d.sentAt).toISOString() : new Date().toISOString(),
      };
    });
    return res.status(200).json({ messages });
  } catch (error) {
    return next(error);
  }
}

async function syncFullOfflineStorage(req, res, next) {
  try {
    const username = normalizeUsername(req.params.username);
    if (!username) {
      return res.status(400).json({ error: "username required" });
    }
    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Fetch all structured file data from disk
    const data = syncUserStorage(username);
    
    // Also include pending messages that might not be written yet, just in case
    const pending = (user.pendingMessages || [])
      .filter((m) => m && m.type === "private")
      .map((m) => ({
        from: String(m.from || ""),
        to: String(m.to || ""),
        message: String(m.message || ""),
        messageId: String(m.messageId || ""),
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
        type: "private",
      }));

    return res.status(200).json({ 
      success: true, 
      offlineData: data,
      pendingMessages: pending 
    });
  } catch (error) {
    return next(error);
  }
}

async function fetchGroupHistory(req, res, next) {
  try {
    const group = String(req.params.group || "").trim();
    if (!group) {
      return res.status(400).json({ error: "group required" });
    }

    const limitRaw = Number(req.query.limit || 500);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(limitRaw, 2000))
      : 500;
    const key = groupConversationKey(group);
    const docs = await LegacyMessage.find({
      kind: "group",
      conversationKey: key,
    })
      .sort({ sentAt: 1 })
      .limit(limit);

    const messages = docs.map((d) => {
      let text = "";
      try {
        text = decryptText({
          cipherText: d.cipherText,
          iv: d.iv,
          authTag: d.authTag,
        });
      } catch (_) {
        text = "";
      }
      return {
        group: d.group,
        from: d.from,
        message: text,
        messageId: d.messageId,
        timestamp: d.sentAt ? new Date(d.sentAt).toISOString() : new Date().toISOString(),
      };
    });
    return res.status(200).json({ messages });
  } catch (error) {
    return next(error);
  }
}

function statusToPublic(statusDoc) {
  return {
    id: String(statusDoc._id),
    owner: String(statusDoc.owner || ""),
    text: String(statusDoc.text || ""),
    mediaType: String(statusDoc.mediaType || "text"),
    mediaPath: statusDoc.mediaPath ? String(statusDoc.mediaPath) : null,
    mediaTitle: statusDoc.mediaTitle ? String(statusDoc.mediaTitle) : null,
    viewerIds: (statusDoc.viewerIds || []).map((u) => String(u || "")),
    likeUserIds: (statusDoc.likeUserIds || []).map((u) => String(u || "")),
    comments: (statusDoc.comments || []).map((c) => ({
      id: String(c.id || ""),
      userId: String(c.userId || ""),
      text: String(c.text || ""),
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
    })),
    createdAt: statusDoc.createdAt
      ? new Date(statusDoc.createdAt).toISOString()
      : new Date().toISOString(),
    expiresAt: statusDoc.expiresAt
      ? new Date(statusDoc.expiresAt).toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function createStatus(req, res, next) {
  try {
    const owner = normalizeUsername(req.body.owner);
    const text = String(req.body.text || "").trim();
    const mediaType = String(req.body.mediaType || "text").trim().toLowerCase();
    const mediaPath = req.body.mediaPath ? String(req.body.mediaPath) : null;
    const mediaTitle = req.body.mediaTitle ? String(req.body.mediaTitle) : null;

    if (!owner) {
      return res.status(400).json({ error: "owner required" });
    }

    const allowed = new Set(["text", "image", "video", "audio"]);
    const finalMediaType = allowed.has(mediaType) ? mediaType : "text";

    const status = await Status.create({
      owner,
      text,
      mediaType: finalMediaType,
      mediaPath,
      mediaTitle,
      viewerIds: [],
      likeUserIds: [],
      comments: [],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const io = req.app.get("io");
    if (io) {
      io.emit("status_updated", { owner });
    }

    return res.status(201).json({ success: true, status: statusToPublic(status) });
  } catch (error) {
    return next(error);
  }
}

async function getStatusFeed(req, res, next) {
  try {
    const username = normalizeUsername(req.params.user);
    if (!username) {
      return res.status(400).json({ error: "user required" });
    }

    const me = await findUserByUsername(username);
    if (!me) {
      return res.status(200).json({ myStories: [], contactStories: {} });
    }

    // Cleanup expired records opportunistically.
    await Status.deleteMany({ expiresAt: { $lte: new Date() } });

    const peers = new Set([username]);
    for (const c of me.contacts || []) {
      peers.add(normalizeUsername(c));
    }

    const privateEdges = await LegacyMessage.find({
      kind: "private",
      $or: [{ from: username }, { to: username }],
    })
      .select("from to")
      .sort({ sentAt: -1 })
      .limit(2000);

    for (const e of privateEdges) {
      const a = normalizeUsername(e.from);
      const b = normalizeUsername(e.to);
      if (a) peers.add(a);
      if (b) peers.add(b);
    }

    const ownerList = [...peers].filter(Boolean);
    const docs = await Status.find({
      owner: { $in: ownerList },
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    const myStories = [];
    const contactStories = {};
    for (const d of docs) {
      const status = statusToPublic(d);
      if (status.owner === username) {
        myStories.push(status);
      } else {
        if (!contactStories[status.owner]) contactStories[status.owner] = [];
        contactStories[status.owner].push(status);
      }
    }

    return res.status(200).json({ myStories, contactStories });
  } catch (error) {
    return next(error);
  }
}

async function markStatusViewed(req, res, next) {
  try {
    const statusId = String(req.body.statusId || "").trim();
    const viewer = normalizeUsername(req.body.viewer);
    if (!statusId || !viewer) {
      return res.status(400).json({ error: "statusId and viewer required" });
    }

    const status = await Status.findById(statusId);
    if (!status) return res.status(404).json({ error: "Status not found" });
    if (normalizeUsername(status.owner) === viewer) {
      return res.status(200).json({ success: true, status: statusToPublic(status) });
    }

    await Status.updateOne({ _id: status._id }, { $addToSet: { viewerIds: viewer } });
    const updated = await Status.findById(status._id);
    return res.status(200).json({ success: true, status: statusToPublic(updated) });
  } catch (error) {
    return next(error);
  }
}

async function toggleStatusLike(req, res, next) {
  try {
    const statusId = String(req.body.statusId || "").trim();
    const userId = normalizeUsername(req.body.userId);
    if (!statusId || !userId) {
      return res.status(400).json({ error: "statusId and userId required" });
    }

    const status = await Status.findById(statusId);
    if (!status) return res.status(404).json({ error: "Status not found" });

    const liked = (status.likeUserIds || []).includes(userId);
    if (liked) {
      await Status.updateOne({ _id: status._id }, { $pull: { likeUserIds: userId } });
    } else {
      await Status.updateOne({ _id: status._id }, { $addToSet: { likeUserIds: userId } });
    }
    const updated = await Status.findById(status._id);
    return res.status(200).json({
      success: true,
      liked: !liked,
      status: statusToPublic(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function addStatusComment(req, res, next) {
  try {
    const statusId = String(req.body.statusId || "").trim();
    const userId = normalizeUsername(req.body.userId);
    const text = String(req.body.text || "").trim();
    if (!statusId || !userId || !text) {
      return res.status(400).json({ error: "statusId, userId and text required" });
    }

    const status = await Status.findById(statusId);
    if (!status) return res.status(404).json({ error: "Status not found" });

    const comment = {
      id: `${Date.now()}_${userId}`,
      userId,
      text,
      createdAt: new Date(),
    };
    await Status.updateOne({ _id: status._id }, { $push: { comments: comment } });
    const updated = await Status.findById(status._id);
    return res.status(200).json({ success: true, status: statusToPublic(updated) });
  } catch (error) {
    return next(error);
  }
}

async function deleteStatus(req, res, next) {
  try {
    const statusId = String(req.params.statusId || "").trim();
    const owner = normalizeUsername(req.params.owner);
    if (!statusId || !owner) {
      return res.status(400).json({ error: "statusId and owner required" });
    }

    const status = await Status.findById(statusId);
    if (!status) return res.status(404).json({ error: "Status not found" });
    if (normalizeUsername(status.owner) !== owner) {
      return res.status(403).json({ error: "Only owner can delete status" });
    }

    await Status.deleteOne({ _id: status._id });
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getContacts,
  sendContactRequest,
  getContactRequests,
  acceptContactRequest,
  declineContactRequest,
  removeContact,
  getGroups,
  createGroup,
  addGroupMember,
  removeGroupMember,
  deleteGroup,
  leaveGroup,
  saveFcmToken,
  savePublicKey,
  getPublicKey,
  fetchPendingMessages,
  deletePendingMessages,
  fetchPrivateHistory,
  fetchGroupHistory,
  createStatus,
  getStatusFeed,
  markStatusViewed,
  toggleStatusLike,
  addStatusComment,
  deleteStatus,
  syncFullOfflineStorage,
};
