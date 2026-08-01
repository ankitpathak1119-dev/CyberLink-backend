const express = require("express");
const {
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
  updateGroupDescription,
  updateGroupProfilePic,
  addGroupAdmin,
  removeGroupAdmin,
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
  deleteStatus,
  syncFullOfflineStorage,
  fetchStarredMessages,
  deleteMessageForMe,
  deleteMessageForEveryone,
  addStatusComment,
  updateProfile,
  getProfile,
  updatePrivacySettings,
  getPrivacySettings,
  blockUser,
  unblockUser,
  getBlockedUsers,
  reportUser,
} = require("../controllers/legacyController");

const router = express.Router();

router.get("/contacts/list/:user", getContacts);
router.post("/contacts/request", sendContactRequest);
router.get("/contacts/requests/:user", getContactRequests);
router.post("/contacts/accept", acceptContactRequest);
router.post("/contacts/decline", declineContactRequest);
router.post("/contacts/remove", removeContact);

router.get("/groups/:user", getGroups);
router.post("/groups/create", createGroup);
router.post("/groups/add-member", addGroupMember);
router.post("/groups/remove-member", removeGroupMember);
router.post("/groups/delete", deleteGroup);
router.post("/groups/leave", leaveGroup);
router.post("/groups/update-description", updateGroupDescription);
router.post("/groups/update-pic", updateGroupProfilePic);
router.post("/groups/add-admin", addGroupAdmin);
router.post("/groups/remove-admin", removeGroupAdmin);

router.post("/messages/fcm-token", saveFcmToken);
router.post("/messages/public-key", savePublicKey);
router.get("/messages/public-key/:username", getPublicKey);
router.get("/messages/pending/:username", fetchPendingMessages);
router.delete("/messages/pending", deletePendingMessages);
router.get("/messages/private/:userA/:userB", fetchPrivateHistory);
router.get("/messages/group/:group", fetchGroupHistory);
router.get("/messages/starred/:username", fetchStarredMessages);
router.post("/messages/delete-for-me", deleteMessageForMe);
router.post("/messages/delete-for-everyone", deleteMessageForEveryone);
router.get("/sync/restore/:username", syncFullOfflineStorage);

router.post("/status/create", createStatus);
router.get("/status/feed/:user", getStatusFeed);
router.post("/status/view", markStatusViewed);
router.post("/status/like", toggleStatusLike);
router.post("/status/comment", addStatusComment);
router.delete("/status/:statusId/:owner", deleteStatus);

// Fix 1 — Profile
router.post("/profile/update", updateProfile);
router.get("/profile/:username", getProfile);

// Fix 2 — Privacy Settings
router.post("/profile/privacy/update", updatePrivacySettings);
router.get("/profile/:username/privacy", getPrivacySettings);

// Fix 3 — Block / Unblock / Report
router.post("/contacts/block", blockUser);
router.post("/contacts/unblock", unblockUser);
router.get("/contacts/blocked/:username", getBlockedUsers);
router.post("/contacts/report", reportUser);

module.exports = router;
