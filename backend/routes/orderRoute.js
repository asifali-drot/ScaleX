const express=require("express");
const {addOrder,getOrderById,getOrders,updateOrder}=require("../controllers/orderController");
const router=express.Router();
const {isVerifiedUser}=require("../middlewares/tokenVerification");

router.route("/").post(isVerifiedUser,addOrder);
router.route("/").get(isVerifiedUser,getOrders);
router.route("/:id").get(isVerifiedUser,getOrderById);
router.route("/:id").put(isVerifiedUser,updateOrder);

module.exports=router;