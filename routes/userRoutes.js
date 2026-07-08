const express = require("express");
const {
  getProfile,
  searchUsers,
  updateProfile,
  registerFcmToken,
  removeFcmToken,
} = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/profile", protect, getProfile);
router.put("/profile", protect, updateProfile);
router.get("/search", protect, searchUsers);
router.put("/fcm-token", protect, registerFcmToken);
router.delete("/fcm-token", protect, removeFcmToken);

module.exports = router;
