const express = require("express");
const { addTable, getTables, updateTable } = require("../controllers/tableController");
const router = express.Router();

// Temporarily remove authentication for testing
// Once working, add back: const { isVerifiedUser } = require("../middlewares/tokenVerification");

// GET all tables
router.get("/", getTables);

// POST create new table
router.post("/", addTable);

// PUT update table
router.put("/:id", updateTable);

module.exports = router;