const User = require("../models/User");

async function getProfile(req, res, next) {
  try {
    res.status(200).json({ success: true, user: req.user.toSafeObject() });
  } catch (error) {
    next(error);
  }
}

async function searchUsers(req, res, next) {
  try {
    const keyword = (req.query.search || "").trim();
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    if (!keyword) {
      return res.status(200).json({ success: true, users: [] });
    }

    const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [{ name: regex }, { email: regex }],
    })
      .select("name email avatar bio createdAt updatedAt")
      .limit(limit)
      .sort({ name: 1 });

    res.status(200).json({ success: true, users });
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, avatar, bio } = req.body;

    if (typeof name !== "undefined") {
      req.user.name = String(name).trim();
    }

    if (typeof avatar !== "undefined") {
      req.user.avatar = String(avatar).trim();
    }

    if (typeof bio !== "undefined") {
      req.user.bio = String(bio).trim();
    }

    await req.user.save();

    res.status(200).json({ success: true, user: req.user.toSafeObject() });
  } catch (error) {
    next(error);
  }
}

async function registerFcmToken(req, res, next) {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      const error = new Error("Valid FCM token is required");
      error.statusCode = 400;
      throw error;
    }

    await User.updateOne(
      { _id: req.user._id },
      { $addToSet: { fcmTokens: token.trim() } }
    );

    res.status(200).json({ success: true, message: "FCM token saved" });
  } catch (error) {
    next(error);
  }
}

async function removeFcmToken(req, res, next) {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      const error = new Error("Valid FCM token is required");
      error.statusCode = 400;
      throw error;
    }

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { fcmTokens: token.trim() } }
    );

    res.status(200).json({ success: true, message: "FCM token removed" });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getProfile,
  searchUsers,
  updateProfile,
  registerFcmToken,
  removeFcmToken,
};
