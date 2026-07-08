const express = require("express");
const {
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
} = require("../controllers/chatController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/one-to-one", protect, createOrAccessOneToOneChat);
router.post("/group", protect, createGroupChat);
router.put("/group/add", protect, addToGroup);
router.put("/group/remove", protect, removeFromGroup);
router.get("/", protect, getChatList);
router.get("/:chatId/messages", protect, getChatMessages);
router.post("/:chatId/messages", protect, sendMessage);
router.put("/:chatId/messages/mark-delivered", protect, markMessagesDelivered);
router.put("/:chatId/messages/mark-seen", protect, markMessagesSeen);
router.patch("/messages/:messageId", protect, editMessage);
router.put("/messages/:messageId/reaction", protect, toggleReaction);
router.post("/messages/:messageId/forward", protect, forwardMessage);

module.exports = router;
