const express = require("express");
const { register, login, me, checkUser, resetPassword, verifyRecovery } = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/check-user", checkUser);
router.post("/verify-recovery", verifyRecovery);
router.post("/reset-password", resetPassword);
router.get("/me", protect, me);

module.exports = router;
