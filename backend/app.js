const express = require("express");
const connectDB = require("./config/database");
const config = require("./config/config");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const nodemailer = require('nodemailer');
require("dotenv").config();

const app = express();

// CORS Configuration
app.use(cors({
    credentials: true,
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:3000',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:5174',
            'http://127.0.0.1:3000',
            'http://localhost:3007'
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('Origin not allowed by CORS:', origin);
            callback(null, true);
        }
    }
}));

// Middleware
app.use(express.json());
app.use(cookieParser());

// Connect to MongoDB
connectDB();

// Stripe
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
}

const PORT = config.port || process.env.PORT || 8000;

// File upload configuration
const storage = multer.diskStorage({
    destination: './upload/images',
    filename: (req, file, cb) => {
        return cb(null, `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`)
    }
});

const upload = multer({ storage: storage });

app.use('/images', express.static('upload/images'));

app.post("/uploads", upload.single('product'), (req, res) => {
    res.json({
        success: 1,
        image_url: `${req.protocol}://${req.get("host")}/images/${req.file.filename}`
    });
});

// Email Configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false,
    auth: {
        user: process.env.SMTP_GOOGLE_MAIL_ADDRESS,
        pass: process.env.SMTP_GOOGLE_APP_PASSWORD
    }
});

// ============================================
// SCHEMAS - SEPARATED FOR E-COMMERCE AND POS
// ============================================

// E-COMMERCE USER SCHEMA (No phone field)
const EcommerceUser = mongoose.model('EcommerceUser', {
    name: {
        type: String,
    },
    email: {
        type: String,
        unique: true,
        sparse: true // Allows multiple null values
    },
    password: {
        type: String,
    },
    cartData: {
        type: Object,
    },
    date: {
        type: Date,
        default: Date.now,
    }
}, 'ecommerce_users'); // Separate collection name

 
// Newsletter Schema
const Newsletter = mongoose.model('Newsletter', {
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    subscribedAt: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

// Product Schema
const Product = mongoose.model("Product", {
    id: {
        type: Number,
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    image: {
        type: String,
        required: true,
    },
    category: {
        type: String,
        required: true,
    },
    new_price: {
        type: Number,
        required: true,
    },
    old_price: {
        type: Number,
        required: true,
    },
    date: {
        type: Date,
        default: Date.now,
    },
    available: {
        type: Boolean,
        default: true,
    },
    isBestSeller: {
        type: Boolean,
        default: false,
    }
});

// Order Schema 
// Order Schema 
const Order = mongoose.model("Order", {
    orderId: {
        type: String,
        unique: true,
        required: true
    },
    userId: String,
    customerInfo: {
        name: String,
        email: String,
        phone: String,
        address: String,
        city: String,
        postalCode: String
    },
    items: [{
        productId: Number,
        name: String,
        image: String,
        price: Number,
        quantity: Number,
        total: Number
    }],
    subtotal: Number,
    shippingFee: Number,
    totalAmount: Number,
    paymentIntentId: String,
    status: {
        type: String,
        enum: ['Pending', 'Paid', 'Shipped', 'Delivered', 'Cancelled'],
        default: 'Pending'
    },
    orderDate: {
        type: Date,
        default: Date.now
    }
});

// 🔥 ADD THIS CODE TO DROP THE OLD INDEX
(async () => {
    try {
        await Order.collection.dropIndex('payment.paymentId_1');
        console.log('✓ Dropped old payment.paymentId index');
    } catch (error) {
        if (error.code === 27) {
            console.log('✓ Index payment.paymentId_1 does not exist (already dropped)');
        } else {
            console.log('Note: Could not drop index, it may not exist');
        }
    }
})();
// ============================================
// MIDDLEWARE
// ============================================

// Middleware for E-commerce authentication
const fetchEcommerceUser = async (req, res, next) => {
    const token = req.header('auth-token');
    if (!token) {
        return res.status(401).send({ errors: "Please authenticate using valid token" });
    }
    try {
        const data = jwt.verify(token, process.env.JWT_SECRET);
        req.user = data.user;
        next();
    } catch (error) {
        res.status(401).send({ errors: "Please authenticate using valid token" });
    }
};

// ============================================
// E-COMMERCE ROUTES
// ============================================

// E-commerce Signup
app.post('/signup', async (req, res) => {
    try {
        let check = await EcommerceUser.findOne({ email: req.body.email });
        if (check) {
            return res.status(400).json({ 
                success: false, 
                errors: "Existing user found with the same email" 
            });
        }
        
        let cart = {};
        for (let i = 0; i < 300; i++) {
            cart[i] = 0;
        }
        
        const user = new EcommerceUser({
            name: req.body.username,
            email: req.body.email,
            password: req.body.password,
            cartData: cart,
        });

        await user.save();

        const data = {
            user: {
                id: user.id
            }
        };
        const token = jwt.sign(data, process.env.JWT_SECRET);
        res.json({ success: true, token });
    } catch (error) {
        console.error('Error in e-commerce signup:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// E-commerce Login
app.post('/login', async (req, res) => {
    try {
        let user = await EcommerceUser.findOne({ email: req.body.email });
        if (user) {
            const passCompare = req.body.password === user.password;
            if (passCompare) {
                const data = {
                    user: {
                        id: user.id
                    }
                };
                const token = jwt.sign(data, process.env.JWT_SECRET);
                res.json({ success: true, token });
            } else {
                res.json({ success: false, errors: "Wrong password" });
            }
        } else {
            res.json({ success: false, errors: "Wrong email id" });
        }
    } catch (error) {
        console.error('Error in e-commerce login:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cart Routes (E-commerce)
app.post('/addtocart', fetchEcommerceUser, async (req, res) => {
    try {
        console.log("Added", req.body.itemId);
        let userData = await EcommerceUser.findOne({ _id: req.user.id });
        userData.cartData[req.body.itemId] += 1;
        await EcommerceUser.findOneAndUpdate(
            { _id: req.user.id }, 
            { cartData: userData.cartData }
        );
        res.json({ success: true, message: "Added" });
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/removefromcart', fetchEcommerceUser, async (req, res) => {
    try {
        console.log("Removed", req.body.itemId);
        let userData = await EcommerceUser.findOne({ _id: req.user.id });
        if (userData.cartData[req.body.itemId] > 0)
            userData.cartData[req.body.itemId] -= 1;
        await EcommerceUser.findOneAndUpdate(
            { _id: req.user.id }, 
            { cartData: userData.cartData }
        );
        res.json({ success: true, message: "Removed" });
    } catch (error) {
        console.error('Error removing from cart:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/getcart', fetchEcommerceUser, async (req, res) => {
    try {
        console.log("GetCart");
        let userData = await EcommerceUser.findOne({ _id: req.user.id });
        res.json(userData.cartData);
    } catch (error) {
        console.error('Error getting cart:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// PRODUCT ROUTES (Shared)
// ============================================

app.get("/", (req, res) => {
    res.json({ message: "Server is running" });
});

app.post('/addproduct', async (req, res) => {
    try {
        let products = await Product.find({});
        let id;
        if (products.length > 0) {
            let last_product = products[products.length - 1];
            id = last_product.id + 1;
        } else {
            id = 1;
        }
        const product = new Product({
            id: id,
            name: req.body.name,
            image: req.body.image,
            category: req.body.category,
            new_price: req.body.new_price,
            old_price: req.body.old_price,
            isBestSeller: req.body.isBestSeller || false
        });
        await product.save();
        res.json({
            success: true,
            name: req.body.name,
        });
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/removeproduct', async (req, res) => {
    try {
        await Product.findOneAndDelete({ id: req.body.id });
        res.json({
            success: true,
            name: req.body.name
        });
    } catch (error) {
        console.error('Error removing product:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/allproduct', async (req, res) => {
    try {
        let products = await Product.find({});
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/latestproducts', async (req, res) => {
    try {
        let products = await Product.find({}).sort({ date: -1 }).limit(6);
        res.json(products);
    } catch (error) {
        console.error('Error fetching latest products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/newcollections', async (req, res) => {
    try {
        let products = await Product.find({});
        let newcollection = products.slice(1).slice(-8);
        res.json(newcollection);
    } catch (error) {
        console.error('Error fetching new collections:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/popularinwomen', async (req, res) => {
    try {
        let products = await Product.find({ category: "women" });
        let popular_in_women = products.slice(0, 4);
        res.json(popular_in_women);
    } catch (error) {
        console.error('Error fetching popular products:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/bestsellers', async (req, res) => {
    try {
        let bestSellers = await Product.find({ isBestSeller: true });
        res.json(bestSellers);
    } catch (error) {
        console.error('Error fetching best sellers:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/togglebestseller', async (req, res) => {
    try {
        const product = await Product.findOne({ id: req.body.id });
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                error: "Product not found" 
            });
        }
        
        product.isBestSeller = !product.isBestSeller;
        await product.save();
        
        res.json({
            success: true,
            isBestSeller: product.isBestSeller,
            message: product.isBestSeller 
                ? "Added to Best Sellers" 
                : "Removed from Best Sellers"
        });
    } catch (error) {
        console.error('Error toggling best seller:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ============================================
// BUSINESS SETUP SCHEMA & ROUTES
// Add this after your other schemas in server.js
// ============================================

// Business Setup Schema
const BusinessSetup = mongoose.model('BusinessSetup', {
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    businessName: {
        type: String,
        required: true,
        unique: true
    },
    websiteName: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    country: {
        type: String,
        default: 'Pakistan'
    },
    language: {
        type: String,
        default: 'English'
    },
    moduleId: {
        type: String,
        required: true
    },
    moduleName: {
        type: String,
        required: true
    },
    setupDate: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

// ============================================
// BUSINESS SETUP API ROUTES
// ============================================

// Setup new business
app.post('/api/setup-business', async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            businessName,
            websiteName,
            email,
            phone,
            country,
            language,
            moduleId,
            moduleName
        } = req.body;

        // Check if business name already exists
        const existingBusiness = await BusinessSetup.findOne({
            $or: [
                { businessName: businessName },
                { websiteName: websiteName }
            ]
        });

        if (existingBusiness) {
            return res.status(400).json({
                success: false,
                message: 'Business name or website name already exists'
            });
        }

        // Create new business setup
        const business = new BusinessSetup({
            firstName,
            lastName,
            businessName,
            websiteName,
            email,
            phone,
            country,
            language,
            moduleId,
            moduleName
        });

        await business.save();

        // Send welcome email
        await sendBusinessSetupEmail(email, `${firstName} ${lastName}`, businessName, moduleName);

        console.log(`New business setup: ${businessName} (${moduleName})`);

        res.json({
            success: true,
            message: 'Business setup completed successfully',
            business: {
                businessName,
                websiteName,
                moduleId
            }
        });

    } catch (error) {
        console.error('Business setup error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get business by website name
app.get('/api/business/:websiteName', async (req, res) => {
    try {
        const business = await BusinessSetup.findOne({
            websiteName: req.params.websiteName
        });

        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business not found'
            });
        }

        res.json({
            success: true,
            business
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get all businesses (Admin)
app.get('/api/businesses', async (req, res) => {
    try {
        const businesses = await BusinessSetup.find()
            .sort({ setupDate: -1 });

        res.json({
            success: true,
            count: businesses.length,
            businesses
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Update business details
app.patch('/api/business/:id', async (req, res) => {
    try {
        const updates = req.body;
        const business = await BusinessSetup.findByIdAndUpdate(
            req.params.id,
            updates,
            { new: true }
        );

        if (!business) {
            return res.status(404).json({
                success: false,
                message: 'Business not found'
            });
        }

        res.json({
            success: true,
            message: 'Business updated successfully',
            business
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================
// EMAIL FUNCTION FOR BUSINESS SETUP
// ============================================

async function sendBusinessSetupEmail(email, name, businessName, moduleName) {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f4f4;
                    margin: 0;
                    padding: 20px;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    background: white;
                    padding: 40px;
                    border-radius: 10px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .header {
                    text-align: center;
                    padding-bottom: 20px;
                    border-bottom: 2px solid #4facfe;
                }
                .logo {
                    font-size: 32px;
                    font-weight: bold;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .content {
                    padding: 30px 0;
                    color: #454545;
                }
                .business-info {
                    background: #f7f9fc;
                    padding: 20px;
                    border-radius: 10px;
                    margin: 20px 0;
                }
                .button {
                    display: inline-block;
                    padding: 15px 40px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 25px;
                    font-weight: 600;
                    margin: 20px 0;
                }
                .footer {
                    text-align: center;
                    padding-top: 20px;
                    border-top: 1px solid #e3e3e3;
                    color: #888;
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🚀 ERPss Platform</div>
                </div>
                <div class="content">
                    <h2>Welcome to Your New ${moduleName}! 🎉</h2>
                    <p>Hi ${name},</p>
                    <p>Congratulations! Your business platform has been successfully set up.</p>
                    
                    <div class="business-info">
                        <h3 style="margin-top: 0; color: #667eea;">Business Details</h3>
                        <p><strong>Business Name:</strong> ${businessName}</p>
                        <p><strong>Module:</strong> ${moduleName}</p>
                        <p><strong>Email:</strong> ${email}</p>
                    </div>

                    <p>You can now start building your business with our powerful tools!</p>
                    
                    <center>
                        <a href="#" class="button">Access Your Dashboard</a>
                    </center>

                    <p style="margin-top: 30px;">
                        Best regards,<br>
                        <strong>ERPss Team</strong>
                    </p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 ERPss Platform. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"ERPss Platform" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: email,
        subject: `Welcome to ${businessName} - Your ${moduleName} is Ready! 🎉`,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Business setup email sent to: ${email}`);
    } catch (error) {
        console.error(`Failed to send setup email to ${email}:`, error);
    }
}
// ============================================
// NEWSLETTER ROUTES
// ============================================

app.post('/subscribe-newsletter', async (req, res) => {
    try {
        const { email } = req.body;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false, 
                message: "Please enter a valid email address" 
            });
        }

        const existingSubscriber = await Newsletter.findOne({ email });
        if (existingSubscriber) {
            if (existingSubscriber.isActive) {
                return res.status(400).json({ 
                    success: false, 
                    message: "This email is already subscribed to our newsletter" 
                });
            } else {
                existingSubscriber.isActive = true;
                existingSubscriber.subscribedAt = Date.now();
                await existingSubscriber.save();
                
                await sendWelcomeEmail(email, true);
                
                return res.json({ 
                    success: true, 
                    message: "Welcome back! Your subscription has been reactivated." 
                });
            }
        }

        const subscriber = new Newsletter({ email });
        await subscriber.save();
        await sendWelcomeEmail(email, false);

        res.json({ 
            success: true, 
            message: "Thank you for subscribing! Check your email for confirmation." 
        });

    } catch (error) {
        console.error('Newsletter subscription error:', error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to subscribe. Please try again later." 
        });
    }
});

app.post('/unsubscribe-newsletter', async (req, res) => {
    try {
        const { email } = req.body;

        const subscriber = await Newsletter.findOne({ email });
        if (!subscriber) {
            return res.status(404).json({ 
                success: false, 
                message: "Email not found in our newsletter list" 
            });
        }

        subscriber.isActive = false;
        await subscriber.save();

        res.json({ 
            success: true, 
            message: "You have been unsubscribed from our newsletter" 
        });

    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to unsubscribe" 
        });
    }
});

app.get('/newsletter-subscribers', async (req, res) => {
    try {
        const subscribers = await Newsletter.find({ isActive: true })
            .select('email subscribedAt')
            .sort({ subscribedAt: -1 });
        
        res.json({ 
            success: true, 
            count: subscribers.length,
            subscribers 
        });
    } catch (error) {
        console.error('Error fetching subscribers:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

app.post('/send-promotional-email', async (req, res) => {
    try {
        const { subject, message, htmlContent } = req.body;

        const subscribers = await Newsletter.find({ isActive: true });
        
        if (subscribers.length === 0) {
            return res.json({ 
                success: false, 
                message: "No active subscribers found" 
            });
        }

        const emailPromises = subscribers.map(subscriber => 
            sendPromotionalEmail(subscriber.email, subject, message, htmlContent)
        );

        await Promise.all(emailPromises);

        res.json({ 
            success: true, 
            message: `Email sent to ${subscribers.length} subscribers` 
        });

    } catch (error) {
        console.error('Error sending promotional emails:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// EMAIL FUNCTIONS
// ============================================

async function sendWelcomeEmail(email, isReturning = false) {
    const subject = isReturning 
        ? "Welcome Back to SHOPPER!" 
        : "Welcome to SHOPPER Newsletter!";
    
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #e1ffea; }
                .logo { font-size: 32px; font-weight: bold; color: #ff4141; }
                .content { padding: 30px 0; color: #454545; }
                .button { display: inline-block; padding: 12px 30px; background: linear-gradient(180deg, #fde1ff 0%, #e1ffea 60%); color: #454545; text-decoration: none; border-radius: 25px; font-weight: 600; margin: 20px 0; }
                .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e3e3e3; color: #888; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🛍️ SHOPPER</div>
                </div>
                <div class="content">
                    <h2>${isReturning ? 'Welcome Back!' : 'Thank You for Subscribing!'}</h2>
                    <p>Hi there,</p>
                    <p>${isReturning 
                        ? 'We\'re excited to have you back!' 
                        : 'Thank you for subscribing to SHOPPER\'s newsletter!'
                    }</p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 SHOPPER. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"SHOPPER" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: email,
        subject: subject,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Welcome email sent to: ${email}`);
    } catch (error) {
        console.error(`Failed to send welcome email to ${email}:`, error);
    }
}

async function sendPromotionalEmail(email, subject, message, htmlContent) {
    const mailOptions = {
        from: `"SHOPPER" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: email,
        subject: subject,
        text: message,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error(`Failed to send promotional email to ${email}:`, error);
    }
}

// ============================================
// PAYMENT ROUTES
// ============================================

if (stripe) {
    app.post("/create-payment-intent", async (req, res) => {
        const { amount } = req.body;

        try {
            const paymentIntent = await stripe.paymentIntents.create({
                amount,
                currency: "usd",
                automatic_payment_methods: { enabled: true },
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        } catch (err) {
            res.status(500).send({ error: err.message });
        }
    });

 

// Update your payment-success route:
app.post("/payment-success", async (req, res) => {
    try {
        const { userId, customerInfo, items, subtotal, shippingFee, totalAmount, paymentIntentId } = req.body;

        // Generate unique order ID
        const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();

        const order = new Order({
            orderId,
            userId,
            customerInfo,
            items,
            subtotal,
            shippingFee,
            totalAmount,
            status: "Paid",
            paymentIntentId,
        });

        await order.save();

        // Send order confirmation email
        await sendOrderConfirmationEmail(customerInfo.email, customerInfo.name, orderId, items, totalAmount);

        // Send admin notification
        await sendAdminOrderNotification(orderId, customerInfo, items, totalAmount);

        console.log(`Order ${orderId} created successfully for ${customerInfo.email}`);
        
        res.status(200).json({ 
            success: true, 
            message: "Order saved successfully!",
            orderId: orderId 
        });
    } catch (err) {
        console.error('Error saving order:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get all orders (Admin)
app.get("/orders", async (req, res) => {
    try {
        const orders = await Order.find().sort({ orderDate: -1 });
        res.json({ success: true, orders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// Update order status
app.patch("/orders/:orderId/status", async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;

        // Validate status
        const validStatuses = ['Pending', 'Paid', 'Shipped', 'Delivered', 'Cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid status" 
            });
        }

        const order = await Order.findOneAndUpdate(
            { orderId: orderId },
            { status: status },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: "Order not found" 
            });
        }

        // Send status update email to customer
        await sendOrderStatusUpdateEmail(
            order.customerInfo.email,
            order.customerInfo.name,
            orderId,
            status
        );

        console.log(`Order ${orderId} status updated to ${status}`);
        res.json({ 
            success: true, 
            message: `Order status updated to ${status}`,
            order 
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get orders with pagination and filters
app.get("/orders-filtered", async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;
        
        const query = status && status !== 'all' ? { status } : {};
        
        const orders = await Order.find(query)
            .sort({ orderDate: -1 })
            .limit(Number(limit))
            .skip((Number(page) - 1) * Number(limit));
        
        const total = await Order.countDocuments(query);
        
        res.json({ 
            success: true, 
            orders,
            pagination: {
                currentPage: Number(page),
                totalPages: Math.ceil(total / Number(limit)),
                totalOrders: total
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get order statistics
app.get("/orders-stats", async (req, res) => {
    try {
        const totalOrders = await Order.countDocuments();
        const pendingOrders = await Order.countDocuments({ 
            status: { $in: ['Pending', 'Paid'] } 
        });
        const shippedOrders = await Order.countDocuments({ status: 'Shipped' });
        const deliveredOrders = await Order.countDocuments({ status: 'Delivered' });
        const cancelledOrders = await Order.countDocuments({ status: 'Cancelled' });

        const totalRevenue = await Order.aggregate([
            { $match: { status: { $ne: 'Cancelled' } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);

        res.json({
            success: true,
            stats: {
                total: totalOrders,
                pending: pendingOrders,
                shipped: shippedOrders,
                delivered: deliveredOrders,
                cancelled: cancelledOrders,
                revenue: totalRevenue[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get order by ID
app.get("/orders/:orderId", async (req, res) => {
    try {
        const order = await Order.findOne({ orderId: req.params.orderId });
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Add these email functions after your existing email functions:
async function sendOrderConfirmationEmail(email, name, orderId, items, totalAmount) {
    const itemsHtml = items.map(item => `
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #e3e3e3;">
                <img src="${item.image}" alt="${item.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px;">
            </td>
            <td style="padding: 10px; border-bottom: 1px solid #e3e3e3;">${item.name}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e3e3e3; text-align: center;">${item.quantity}</td>
            <td style="padding: 10px; border-bottom: 1px solid #e3e3e3; text-align: right;">$${item.total.toFixed(2)}</td>
        </tr>
    `).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #4facfe; }
                .logo { font-size: 32px; font-weight: bold; color: #4facfe; }
                .content { padding: 30px 0; color: #454545; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .total-row { font-weight: bold; font-size: 18px; }
                .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e3e3e3; color: #888; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🛍️ SHOPPER</div>
                </div>
                <div class="content">
                    <h2>Order Confirmation</h2>
                    <p>Hi ${name},</p>
                    <p>Thank you for your order! Your payment has been received successfully.</p>
                    <p><strong>Order ID:</strong> ${orderId}</p>
                    
                    <table>
                        <thead>
                            <tr style="background: #f7f9fc;">
                                <th style="padding: 10px; text-align: left;">Image</th>
                                <th style="padding: 10px; text-align: left;">Product</th>
                                <th style="padding: 10px; text-align: center;">Quantity</th>
                                <th style="padding: 10px; text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsHtml}
                            <tr class="total-row">
                                <td colspan="3" style="padding: 15px; text-align: right;">Total Amount:</td>
                                <td style="padding: 15px; text-align: right; color: #4facfe;">$${totalAmount.toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <p>We'll send you another email when your order ships.</p>
                    <p>Best regards,<br><strong>SHOPPER Team</strong></p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 SHOPPER. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"SHOPPER" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: email,
        subject: `Order Confirmation - ${orderId}`,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Order confirmation email sent to: ${email}`);
    } catch (error) {
        console.error(`Failed to send order confirmation to ${email}:`, error);
    }
}

async function sendAdminOrderNotification(orderId, customerInfo, items, totalAmount) {
    const itemsHtml = items.map(item => `
        <li>${item.name} - Qty: ${item.quantity} - $${item.total.toFixed(2)}</li>
    `).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 20px; border-radius: 10px 10px 0 0; color: white; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2 style="margin: 0;">🛍️ New Order Received!</h2>
                </div>
                <div style="padding: 30px;">
                    <p><strong>Order ID:</strong> ${orderId}</p>
                    <p><strong>Customer:</strong> ${customerInfo.name}</p>
                    <p><strong>Email:</strong> ${customerInfo.email}</p>
                    <p><strong>Phone:</strong> ${customerInfo.phone}</p>
                    <p><strong>Address:</strong> ${customerInfo.address}, ${customerInfo.city}, ${customerInfo.postalCode}</p>
                    
                    <h3>Order Items:</h3>
                    <ul>${itemsHtml}</ul>
                    
                    <p><strong>Total Amount: $${totalAmount.toFixed(2)}</strong></p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"SHOPPER System" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: process.env.ADMIN_EMAIL || process.env.SMTP_GOOGLE_MAIL_ADDRESS,
        subject: `New Order: ${orderId} - $${totalAmount.toFixed(2)}`,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Admin notification sent for order: ${orderId}`);
    } catch (error) {
        console.error('Failed to send admin notification:', error);
    }
}


async function sendOrderStatusUpdateEmail(email, name, orderId, newStatus) {
    const statusMessages = {
        'Paid': {
            title: '✅ Payment Confirmed',
            message: 'Your payment has been received and confirmed.',
            color: '#4facfe'
        },
        'Shipped': {
            title: '📦 Order Shipped',
            message: 'Your order has been shipped and is on its way!',
            color: '#9d4edd'
        },
        'Delivered': {
            title: '🎉 Order Delivered',
            message: 'Your order has been successfully delivered. Thank you for shopping with us!',
            color: '#52b788'
        },
        'Cancelled': {
            title: '❌ Order Cancelled',
            message: 'Your order has been cancelled. If you have any questions, please contact us.',
            color: '#ef476f'
        }
    };

    const statusInfo = statusMessages[newStatus] || {
        title: 'Order Status Update',
        message: `Your order status has been updated to ${newStatus}.`,
        color: '#4facfe'
    };

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    background-color: #f4f4f4; 
                    margin: 0; 
                    padding: 20px; 
                }
                .container { 
                    max-width: 600px; 
                    margin: 0 auto; 
                    background: white; 
                    padding: 40px; 
                    border-radius: 10px; 
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .header { 
                    text-align: center; 
                    padding-bottom: 20px; 
                    border-bottom: 2px solid ${statusInfo.color}; 
                }
                .logo { 
                    font-size: 32px; 
                    font-weight: bold; 
                    background: linear-gradient(135deg, ${statusInfo.color}, #00f2fe);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .content { 
                    padding: 30px 0; 
                    color: #454545; 
                }
                .status-badge {
                    display: inline-block;
                    padding: 12px 24px;
                    background: ${statusInfo.color};
                    color: white;
                    border-radius: 25px;
                    font-weight: 600;
                    margin: 20px 0;
                }
                .order-id {
                    font-size: 18px;
                    font-weight: bold;
                    color: #333;
                    background: #f7f9fc;
                    padding: 15px;
                    border-radius: 8px;
                    margin: 20px 0;
                }
                .footer { 
                    text-align: center; 
                    padding-top: 20px; 
                    border-top: 1px solid #e3e3e3; 
                    color: #888; 
                    font-size: 12px; 
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🛍️ SHOPPER</div>
                </div>
                <div class="content">
                    <h2 style="color: ${statusInfo.color};">${statusInfo.title}</h2>
                    <p>Hi ${name},</p>
                    <p>${statusInfo.message}</p>
                    
                    <div class="order-id">
                        Order ID: ${orderId}
                    </div>
                    
                    <div class="status-badge">
                        Status: ${newStatus}
                    </div>
                    
                    ${newStatus === 'Shipped' ? `
                        <p style="margin-top: 20px; color: #666;">
                            Your order is now in transit and should arrive within 3-5 business days.
                        </p>
                    ` : ''}
                    
                    ${newStatus === 'Delivered' ? `
                        <p style="margin-top: 20px; color: #666;">
                            We hope you enjoy your purchase! If you have any issues, please don't hesitate to contact us.
                        </p>
                    ` : ''}
                    
                    <p style="margin-top: 30px;">
                        Best regards,<br>
                        <strong>SHOPPER Team</strong>
                    </p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 SHOPPER. All rights reserved.</p>
                    <p>This is an automated email. Please do not reply directly to this message.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"SHOPPER" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: email,
        subject: `${statusInfo.title} - Order ${orderId}`,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Status update email sent to: ${email}`);
    } catch (error) {
        console.error(`Failed to send status update email to ${email}:`, error);
    }
}
}

app.post('/clearcart', fetchEcommerceUser, async (req, res) => {
    try {
        let cart = {};
        for (let i = 0; i < 300; i++) {
            cart[i] = 0;
        }
        await EcommerceUser.findOneAndUpdate(
            { _id: req.user.id }, 
            { cartData: cart }
        );
        res.json({ success: true, message: "Cart cleared" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ADD THIS TO YOUR server.js FILE
// ============================================

// Contact Message Schema (Add after Newsletter schema)
const ContactMessage = mongoose.model('ContactMessage', {
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    message: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['new', 'read', 'replied'],
        default: 'new'
    },
    replied: {
        type: Boolean,
        default: false
    },
    replyMessage: {
        type: String,
        default: null
    },
    repliedAt: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// ============================================
// CONTACT MESSAGE ROUTES
// ============================================

// Submit Contact Form (Frontend)
app.post('/submit-contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;

        // Validate input
        if (!name || !email || !message) {
            return res.status(400).json({ 
                success: false, 
                message: "Please fill in all fields" 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false, 
                message: "Please enter a valid email address" 
            });
        }

        // Create new contact message
        const contactMessage = new ContactMessage({
            name,
            email,
            message
        });

        await contactMessage.save();

        // Send confirmation email to user
        await sendContactConfirmationEmail(email, name);

        // Notify admin (optional)
        await sendAdminNotificationEmail(name, email, message);

        console.log(`New contact message from: ${name} (${email})`);
        
        res.json({ 
            success: true, 
            message: "Thank you for your message! We'll get back to you soon." 
        });

    } catch (error) {
        console.error('Contact form submission error:', error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to send message. Please try again later." 
        });
    }
});

// Get all contact messages (Admin only)
app.get('/contact-messages', async (req, res) => {
    try {
        const messages = await ContactMessage.find()
            .sort({ createdAt: -1 });
        
        res.json({ 
            success: true, 
            count: messages.length,
            messages 
        });
    } catch (error) {
        console.error('Error fetching contact messages:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Get single contact message (Admin only)
app.get('/contact-messages/:id', async (req, res) => {
    try {
        const message = await ContactMessage.findById(req.params.id);
        
        if (!message) {
            return res.status(404).json({ 
                success: false, 
                message: "Message not found" 
            });
        }

        // Mark as read if it's new
        if (message.status === 'new') {
            message.status = 'read';
            await message.save();
        }
        
        res.json({ 
            success: true, 
            message 
        });
    } catch (error) {
        console.error('Error fetching message:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Reply to contact message (Admin only)
app.post('/reply-contact/:id', async (req, res) => {
    try {
        const { replyMessage } = req.body;
        const messageId = req.params.id;

        if (!replyMessage || !replyMessage.trim()) {
            return res.status(400).json({ 
                success: false, 
                message: "Reply message cannot be empty" 
            });
        }

        const contactMessage = await ContactMessage.findById(messageId);
        
        if (!contactMessage) {
            return res.status(404).json({ 
                success: false, 
                message: "Message not found" 
            });
        }

        // Update message
        contactMessage.status = 'replied';
        contactMessage.replied = true;
        contactMessage.replyMessage = replyMessage;
        contactMessage.repliedAt = Date.now();
        await contactMessage.save();

        // Send reply email to user
        await sendReplyEmail(
            contactMessage.email, 
            contactMessage.name, 
            contactMessage.message,
            replyMessage
        );

        console.log(`Reply sent to: ${contactMessage.email}`);
        
        res.json({ 
            success: true, 
            message: "Reply sent successfully!" 
        });

    } catch (error) {
        console.error('Error sending reply:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Delete contact message (Admin only)
app.delete('/contact-messages/:id', async (req, res) => {
    try {
        const message = await ContactMessage.findByIdAndDelete(req.params.id);
        
        if (!message) {
            return res.status(404).json({ 
                success: false, 
                message: "Message not found" 
            });
        }
        
        res.json({ 
            success: true, 
            message: "Message deleted successfully" 
        });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// Update message status (Admin only)
app.patch('/contact-messages/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const message = await ContactMessage.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );
        
        if (!message) {
            return res.status(404).json({ 
                success: false, 
                message: "Message not found" 
            });
        }
        
        res.json({ 
            success: true, 
            message: message 
        });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// ============================================
// EMAIL FUNCTIONS FOR CONTACT SYSTEM
// ============================================

// Send confirmation email to user after contact form submission
async function sendContactConfirmationEmail(email, name) {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #4facfe; }
                .logo { font-size: 32px; font-weight: bold; color: #4facfe; }
                .content { padding: 30px 0; color: #454545; }
                .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e3e3e3; color: #888; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🛍️ SHOPPER</div>
                </div>
                <div class="content">
                    <h2>Thank You for Contacting Us!</h2>
                    <p>Hi ${name},</p>
                    <p>We've received your message and our team will review it shortly.</p>
                    <p>We typically respond within 24-48 hours. If your inquiry is urgent, please feel free to reach out to us directly via WhatsApp.</p>
                    <p>Thank you for your patience!</p>
                    <br>
                    <p>Best regards,<br><strong>SHOPPER Team</strong></p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 SHOPPER. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"SHOPPER" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: email,
        subject: "We've Received Your Message - SHOPPER",
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Confirmation email sent to: ${email}`);
    } catch (error) {
        console.error(`Failed to send confirmation email to ${email}:`, error);
    }
}

// Send notification to admin about new contact message
async function sendAdminNotificationEmail(name, email, message) {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 20px; border-radius: 10px 10px 0 0; color: white; }
                .content { padding: 30px; color: #454545; }
                .message-box { background: #f7f9fc; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .label { font-weight: bold; color: #4facfe; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2 style="margin: 0;">🔔 New Contact Message</h2>
                </div>
                <div class="content">
                    <p><span class="label">From:</span> ${name}</p>
                    <p><span class="label">Email:</span> ${email}</p>
                    <div class="message-box">
                        <p class="label">Message:</p>
                        <p>${message}</p>
                    </div>
                    <p><em>Please log in to your admin panel to reply.</em></p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"SHOPPER System" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: process.env.ADMIN_EMAIL || process.env.SMTP_GOOGLE_MAIL_ADDRESS,
        subject: `🔔 New Contact Message from ${name}`,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Admin notification sent for message from: ${name}`);
    } catch (error) {
        console.error(`Failed to send admin notification:`, error);
    }
}

// Send reply email to user
async function sendReplyEmail(userEmail, userName, originalMessage, replyMessage) {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #4facfe; }
                .logo { font-size: 32px; font-weight: bold; color: #4facfe; }
                .content { padding: 30px 0; color: #454545; }
                .original-message { background: #f7f9fc; padding: 20px; border-left: 4px solid #4facfe; margin: 20px 0; }
                .reply-message { background: #fff; padding: 20px; border: 2px solid #4facfe; border-radius: 10px; margin: 20px 0; }
                .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e3e3e3; color: #888; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🛍️ SHOPPER</div>
                </div>
                <div class="content">
                    <h2>Reply to Your Message</h2>
                    <p>Hi ${userName},</p>
                    <p>Thank you for contacting us. Here's our response to your inquiry:</p>
                    
                    <div class="reply-message">
                        <strong>Our Response:</strong>
                        <p>${replyMessage.replace(/\n/g, '<br>')}</p>
                    </div>

                    <div class="original-message">
                        <strong>Your Original Message:</strong>
                        <p>${originalMessage}</p>
                    </div>

                    <p>If you have any further questions, feel free to reply to this email or contact us again!</p>
                    <br>
                    <p>Best regards,<br><strong>SHOPPER Support Team</strong></p>
                </div>
                <div class="footer">
                    <p>You're receiving this email because you contacted SHOPPER.</p>
                    <p>&copy; 2025 SHOPPER. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"SHOPPER Support" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: userEmail,
        subject: "Re: Your Message to SHOPPER",
        html: htmlContent,
        replyTo: process.env.SMTP_GOOGLE_MAIL_ADDRESS
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Reply email sent to: ${userEmail}`);
    } catch (error) {
        console.error(`Failed to send reply email to ${userEmail}:`, error);
        throw error;
    }
}
  
// ============================================
// POS SYSTEM ROUTES
// ============================================

// ============================================
// POS RESTAURANT SYSTEM - USER SCHEMA
// ============================================
// ============================================
// POS SYSTEM - SCHEMAS WITH UNIQUE NAMES
// ============================================
// Add this code AFTER your E-commerce schemas in server.js

// POS User Schema (already unique)
const PosUser = mongoose.model('PosUser', {
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'waiter', 'cashier'],
        required: true
    },
    phone: {
        type: String
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, 'pos_users');

// POS Menu Item Schema
const PosMenuItem = mongoose.model('PosMenuItem', {
    name: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Main Course', 'Appetizers', 'Beverages', 'Desserts', 'Fast Food']
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    description: {
        type: String,
        default: ''
    },
    image: {
        type: String,
        default: ''
    },
    available: {
        type: Boolean,
        default: true
    },
    preparationTime: {
        type: Number,
        default: 15
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, 'pos_menu_items');

// POS Table Schema
const PosTable = mongoose.model('PosTable', {
    tableNumber: {
        type: Number,
        required: true,
        unique: true
    },
    capacity: {
        type: Number,
        required: true,
        default: 4
    },
    status: {
        type: String,
        enum: ['available', 'occupied', 'reserved'],
        default: 'available'
    },
    currentOrder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PosOrder',
        default: null
    },
    assignedWaiter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PosUser',
        default: null
    },
    reservedBy: {
        name: String,
        phone: String,
        reservedTime: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, 'pos_tables');

// POS Order Schema (Different from E-commerce Order)
const PosOrder = mongoose.model('PosOrder', {
    orderNumber: {
        type: String,
        required: true,
        unique: true
    },
    table: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PosTable',
        required: true
    },
    items: [{
        menuItem: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PosMenuItem',
            required: true
        },
        name: String,
        price: Number,
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        subtotal: Number
    }],
    waiter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PosUser',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'],
        default: 'pending'
    },
    totalAmount: {
        type: Number,
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ['unpaid', 'paid'],
        default: 'unpaid'
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'online'],
        default: null
    },
    notes: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date,
        default: null
    }
}, 'pos_orders');

// ============================================
// POS MIDDLEWARE
// ============================================

const fetchPosUser = async (req, res, next) => {
    const token = req.header('pos-auth-token');
    if (!token) {
        return res.status(401).send({ errors: "Please authenticate using valid POS token" });
    }
    try {
        const data = jwt.verify(token, process.env.JWT_SECRET);
        req.posUser = data.user;
        next();
    } catch (error) {
        res.status(401).send({ errors: "Please authenticate using valid POS token" });
    }
};

// ============================================
// POS AUTH ROUTES
// ============================================

app.post('/pos/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ 
                success: false, 
                error: "Please provide email, password, and role" 
            });
        }

        let user = await PosUser.findOne({ email, role, isActive: true });
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: "Invalid credentials or role" 
            });
        }

        const passCompare = password === user.password;
        
        if (!passCompare) {
            return res.status(401).json({ 
                success: false, 
                error: "Invalid credentials" 
            });
        }

        const data = {
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                name: user.name
            }
        };
        
        const token = jwt.sign(data, process.env.JWT_SECRET, { expiresIn: '24h' });
        
        res.json({ 
            success: true, 
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('Error in POS login:', error);
        res.status(500).json({ 
            success: false, 
            error: "Server error during login" 
        });
    }
});

app.post('/pos/signup', async (req, res) => {
    try {
        const { name, email, password, role, phone } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ 
                success: false, 
                error: "Please provide all required fields" 
            });
        }

        let existingUser = await PosUser.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: "User with this email already exists" 
            });
        }

        if (!['admin', 'waiter', 'cashier'].includes(role)) {
            return res.status(400).json({ 
                success: false, 
                error: "Invalid role" 
            });
        }

        const user = new PosUser({
            name,
            email,
            password,
            role,
            phone: phone || ''
        });

        await user.save();

        const data = {
            user: {
                id: user._id,
                email: user.email,
                role: user.role,
                name: user.name
            }
        };
        
        const token = jwt.sign(data, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.json({ 
            success: true, 
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('Error in POS signup:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/pos/me', fetchPosUser, async (req, res) => {
    try {
        const user = await PosUser.findById(req.posUser.id).select('-password');
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: "User not found" 
            });
        }
        res.json({ success: true, user });
    } catch (error) {
        console.error('Error fetching POS user:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================
// POS MENU MANAGEMENT ROUTES
// ============================================

app.get('/pos/menu', async (req, res) => {
    try {
        const menuItems = await PosMenuItem.find().sort({ createdAt: -1 });
        res.json({ success: true, menuItems });
    } catch (error) {
        console.error('Error fetching menu items:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/pos/menu/category/:category', async (req, res) => {
    try {
        const menuItems = await PosMenuItem.find({ category: req.params.category });
        res.json({ success: true, menuItems });
    } catch (error) {
        console.error('Error fetching menu items by category:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/pos/menu/:id', async (req, res) => {
    try {
        const menuItem = await PosMenuItem.findById(req.params.id);
        if (!menuItem) {
            return res.status(404).json({ success: false, error: 'Menu item not found' });
        }
        res.json({ success: true, menuItem });
    } catch (error) {
        console.error('Error fetching menu item:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/pos/menu', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const { name, category, price, description, image, preparationTime } = req.body;

        if (!name || !category || !price) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide name, category, and price' 
            });
        }

        const existingItem = await PosMenuItem.findOne({ name, category });
        if (existingItem) {
            return res.status(400).json({ 
                success: false, 
                error: 'Menu item with this name already exists in this category' 
            });
        }

        const menuItem = new PosMenuItem({
            name,
            category,
            price,
            description: description || '',
            image: image || '',
            preparationTime: preparationTime || 15
        });

        await menuItem.save();
        
        res.json({ 
            success: true, 
            message: 'Menu item added successfully',
            menuItem 
        });
    } catch (error) {
        console.error('Error adding menu item:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/pos/menu/:id', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const { name, category, price, description, image, available, preparationTime } = req.body;

        const menuItem = await PosMenuItem.findByIdAndUpdate(
            req.params.id,
            { name, category, price, description, image, available, preparationTime },
            { new: true, runValidators: true }
        );

        if (!menuItem) {
            return res.status(404).json({ 
                success: false, 
                error: 'Menu item not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Menu item updated successfully',
            menuItem 
        });
    } catch (error) {
        console.error('Error updating menu item:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/pos/menu/:id/toggle-availability', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const menuItem = await PosMenuItem.findById(req.params.id);
        if (!menuItem) {
            return res.status(404).json({ 
                success: false, 
                error: 'Menu item not found' 
            });
        }

        menuItem.available = !menuItem.available;
        await menuItem.save();

        res.json({ 
            success: true, 
            message: `Menu item ${menuItem.available ? 'enabled' : 'disabled'}`,
            menuItem 
        });
    } catch (error) {
        console.error('Error toggling availability:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/pos/menu/:id', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const menuItem = await PosMenuItem.findByIdAndDelete(req.params.id);
        if (!menuItem) {
            return res.status(404).json({ 
                success: false, 
                error: 'Menu item not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Menu item deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting menu item:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// POS STAFF MANAGEMENT ROUTES
// ============================================

app.get('/pos/staff', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const staff = await PosUser.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, staff });
    } catch (error) {
        console.error('Error fetching staff:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/pos/staff/:id', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const staff = await PosUser.findById(req.params.id).select('-password');
        if (!staff) {
            return res.status(404).json({ 
                success: false, 
                error: 'Staff member not found' 
            });
        }

        res.json({ success: true, staff });
    } catch (error) {
        console.error('Error fetching staff member:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/pos/staff', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const { name, email, password, role, phone } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide all required fields' 
            });
        }

        const existingUser = await PosUser.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: 'User with this email already exists' 
            });
        }

        if (!['admin', 'waiter', 'cashier'].includes(role)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid role. Must be admin, waiter, or cashier' 
            });
        }

        const newStaff = new PosUser({
            name,
            email,
            password,
            role,
            phone: phone || ''
        });

        await newStaff.save();

        const staffData = await PosUser.findById(newStaff._id).select('-password');

        res.json({ 
            success: true, 
            message: 'Staff member added successfully',
            staff: staffData 
        });
    } catch (error) {
        console.error('Error adding staff member:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/pos/staff/:id', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const { name, email, password, role, phone, isActive } = req.body;

        const updateData = { name, email, role, phone, isActive };
        
        if (password) {
            updateData.password = password;
        }

        const staff = await PosUser.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        if (!staff) {
            return res.status(404).json({ 
                success: false, 
                error: 'Staff member not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Staff member updated successfully',
            staff 
        });
    } catch (error) {
        console.error('Error updating staff member:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/pos/staff/:id/toggle-status', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const staff = await PosUser.findById(req.params.id);
        if (!staff) {
            return res.status(404).json({ 
                success: false, 
                error: 'Staff member not found' 
            });
        }

        staff.isActive = !staff.isActive;
        await staff.save();

        const staffData = await PosUser.findById(staff._id).select('-password');

        res.json({ 
            success: true, 
            message: `Staff member ${staff.isActive ? 'activated' : 'deactivated'}`,
            staff: staffData 
        });
    } catch (error) {
        console.error('Error toggling staff status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/pos/staff/:id', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        if (req.params.id === req.posUser.id) {
            return res.status(400).json({ 
                success: false, 
                error: 'You cannot delete your own account' 
            });
        }

        const staff = await PosUser.findByIdAndDelete(req.params.id);
        if (!staff) {
            return res.status(404).json({ 
                success: false, 
                error: 'Staff member not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Staff member deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting staff member:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// POS TABLE MANAGEMENT ROUTES
// ============================================

app.get('/pos/tables', fetchPosUser, async (req, res) => {
    try {
        const tables = await PosTable.find()
            .populate('assignedWaiter', 'name')
            .populate('currentOrder')
            .sort({ tableNumber: 1 });
        
        res.json({ success: true, tables });
    } catch (error) {
        console.error('Error fetching tables:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/pos/tables/:id', fetchPosUser, async (req, res) => {
    try {
        const table = await PosTable.findById(req.params.id)
            .populate('assignedWaiter', 'name email')
            .populate('currentOrder');
        
        if (!table) {
            return res.status(404).json({ success: false, error: 'Table not found' });
        }
        
        res.json({ success: true, table });
    } catch (error) {
        console.error('Error fetching table:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/pos/tables', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const { tableNumber, capacity } = req.body;

        if (!tableNumber) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide table number' 
            });
        }

        const existingTable = await PosTable.findOne({ tableNumber });
        if (existingTable) {
            return res.status(400).json({ 
                success: false, 
                error: 'Table number already exists' 
            });
        }

        const table = new PosTable({
            tableNumber,
            capacity: capacity || 4
        });

        await table.save();
        
        res.json({ 
            success: true, 
            message: 'Table added successfully',
            table 
        });
    } catch (error) {
        console.error('Error adding table:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/pos/tables/:id/status', fetchPosUser, async (req, res) => {
    try {
        const { status } = req.body;

        if (!['available', 'occupied', 'reserved'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid status' 
            });
        }

        const table = await PosTable.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        ).populate('assignedWaiter', 'name');

        if (!table) {
            return res.status(404).json({ 
                success: false, 
                error: 'Table not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Table status updated',
            table 
        });
    } catch (error) {
        console.error('Error updating table status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/pos/tables/:id/reserve', fetchPosUser, async (req, res) => {
    try {
        const { name, phone, reservedTime } = req.body;

        if (!name || !phone || !reservedTime) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide name, phone, and reserved time' 
            });
        }

        const table = await PosTable.findById(req.params.id);
        if (!table) {
            return res.status(404).json({ 
                success: false, 
                error: 'Table not found' 
            });
        }

        if (table.status !== 'available') {
            return res.status(400).json({ 
                success: false, 
                error: 'Table is not available for reservation' 
            });
        }

        table.status = 'reserved';
        table.reservedBy = {
            name,
            phone,
            reservedTime: new Date(reservedTime)
        };
        
        await table.save();

        res.json({ 
            success: true, 
            message: 'Table reserved successfully',
            table 
        });
    } catch (error) {
        console.error('Error reserving table:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/pos/tables/:id/reservation', fetchPosUser, async (req, res) => {
    try {
        const table = await PosTable.findById(req.params.id);
        if (!table) {
            return res.status(404).json({ 
                success: false, 
                error: 'Table not found' 
            });
        }

        table.status = 'available';
        table.reservedBy = undefined;
        
        await table.save();

        res.json({ 
            success: true, 
            message: 'Reservation cancelled',
            table 
        });
    } catch (error) {
        console.error('Error cancelling reservation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/pos/tables/:id', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const table = await PosTable.findById(req.params.id);
        if (!table) {
            return res.status(404).json({ 
                success: false, 
                error: 'Table not found' 
            });
        }

        if (table.status === 'occupied') {
            return res.status(400).json({ 
                success: false, 
                error: 'Cannot delete occupied table' 
            });
        }

        await PosTable.findByIdAndDelete(req.params.id);

        res.json({ 
            success: true, 
            message: 'Table deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting table:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// POS ORDER MANAGEMENT ROUTES
// ============================================

const generatePosOrderNumber = async () => {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
    const count = await PosOrder.countDocuments({
        createdAt: {
            $gte: new Date(today.setHours(0, 0, 0, 0)),
            $lt: new Date(today.setHours(23, 59, 59, 999))
        }
    });
    return `POS-${dateStr}-${String(count + 1).padStart(4, '0')}`;
};

app.get('/pos/orders', fetchPosUser, async (req, res) => {
    try {
        const { status, waiter } = req.query;
        let query = {};

        if (status) query.status = status;
        
        if (req.posUser.role === 'waiter') {
            query.waiter = req.posUser.id;
        } else if (waiter) {
            query.waiter = waiter;
        }

        const orders = await PosOrder.find(query)
            .populate('table', 'tableNumber')
            .populate('waiter', 'name')
            .populate('items.menuItem', 'name')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, orders });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get served orders with unpaid status (for Checkout page)
app.get('/pos/orders/served-unpaid', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'cashier' && req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Cashier or Admin only.' 
            });
        }

        const orders = await PosOrder.find({ 
            status: 'served',
            paymentStatus: 'unpaid'
        })
            .populate('table', 'tableNumber')
            .populate('waiter', 'name')
            .populate('items.menuItem', 'name')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, orders });
    } catch (error) {
        console.error('Error fetching unpaid orders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/pos/orders/:id', fetchPosUser, async (req, res) => {
    try {
        const order = await PosOrder.findById(req.params.id)
            .populate('table', 'tableNumber capacity')
            .populate('waiter', 'name email')
            .populate('items.menuItem');
        
        if (!order) {
            return res.status(404).json({ success: false, error: 'Order not found' });
        }
        
        res.json({ success: true, order });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/pos/orders', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'waiter' && req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Waiter only.' 
            });
        }

        const { tableId, items, notes } = req.body;

        if (!tableId || !items || items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide table and items' 
            });
        }

        const table = await PosTable.findById(tableId);
        if (!table) {
            return res.status(404).json({ 
                success: false, 
                error: 'Table not found' 
            });
        }

        if (table.status === 'occupied' && table.currentOrder) {
            return res.status(400).json({ 
                success: false, 
                error: 'Table already has an active order' 
            });
        }

        let orderItems = [];
        let totalAmount = 0;

        for (let item of items) {
            const menuItem = await PosMenuItem.findById(item.menuItem);
            if (!menuItem) {
                return res.status(404).json({ 
                    success: false, 
                    error: `Menu item ${item.menuItem} not found` 
                });
            }

            if (!menuItem.available) {
                return res.status(400).json({ 
                    success: false, 
                    error: `${menuItem.name} is currently unavailable` 
                });
            }

            const subtotal = menuItem.price * item.quantity;
            orderItems.push({
                menuItem: menuItem._id,
                name: menuItem.name,
                price: menuItem.price,
                quantity: item.quantity,
                subtotal
            });
            totalAmount += subtotal;
        }

        const orderNumber = await generatePosOrderNumber();

        const order = new PosOrder({
            orderNumber,
            table: tableId,
            items: orderItems,
            waiter: req.posUser.id,
            totalAmount,
            notes: notes || '',
            status: 'pending'
        });

        await order.save();

        table.status = 'occupied';
        table.currentOrder = order._id;
        table.assignedWaiter = req.posUser.id;
        await table.save();

        const populatedOrder = await PosOrder.findById(order._id)
            .populate('table', 'tableNumber')
            .populate('waiter', 'name')
            .populate('items.menuItem');

        res.json({ 
            success: true, 
            message: 'Order created successfully',
            order: populatedOrder 
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.patch('/pos/orders/:id/status', fetchPosUser, async (req, res) => {
    try {
        const { status } = req.body;

        const validStatuses = ['pending', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid status' 
            });
        }

        const order = await PosOrder.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        order.status = status;
        
        if (status === 'completed' || status === 'cancelled') {
            order.completedAt = new Date();
            
            const table = await PosTable.findById(order.table);
            if (table) {
                table.status = 'available';
                table.currentOrder = null;
                table.assignedWaiter = null;
                await table.save();
            }
        }

        await order.save();

        const updatedOrder = await PosOrder.findById(order._id)
            .populate('table', 'tableNumber')
            .populate('waiter', 'name');

        res.json({ 
            success: true, 
            message: 'Order status updated',
            order: updatedOrder 
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/pos/orders/:id/items', fetchPosUser, async (req, res) => {
    try {
        const { items } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide items to add' 
            });
        }

        const order = await PosOrder.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        if (order.status === 'completed' || order.status === 'cancelled') {
            return res.status(400).json({ 
                success: false, 
                error: 'Cannot add items to completed or cancelled order' 
            });
        }

        for (let item of items) {
            const menuItem = await PosMenuItem.findById(item.menuItem);
            if (!menuItem || !menuItem.available) continue;

            const subtotal = menuItem.price * item.quantity;
            order.items.push({
                menuItem: menuItem._id,
                name: menuItem.name,
                price: menuItem.price,
                quantity: item.quantity,
                subtotal
            });
            order.totalAmount += subtotal;
        }

        await order.save();

        const updatedOrder = await PosOrder.findById(order._id)
            .populate('table', 'tableNumber')
            .populate('items.menuItem');

        res.json({ 
            success: true, 
            message: 'Items added to order',
            order: updatedOrder 
        });
    } catch (error) {
        console.error('Error adding items to order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/pos/orders/:id', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Admin only.' 
            });
        }

        const order = await PosOrder.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        const table = await PosTable.findById(order.table);
        if (table && table.currentOrder?.toString() === order._id.toString()) {
            table.status = 'available';
            table.currentOrder = null;
            table.assignedWaiter = null;
            await table.save();
        }

        await PosOrder.findByIdAndDelete(req.params.id);

        res.json({ 
            success: true, 
            message: 'Order deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ADD THIS NEW ROUTE TO YOUR server.js
// Place it after the existing order routes
// ============================================

// Process payment for an order (Cashier)
app.patch('/pos/orders/:id/payment', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'cashier' && req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Cashier or Admin only.' 
            });
        }

        const { paymentStatus, paymentMethod, status } = req.body;

        // Validate payment status
        if (paymentStatus && !['unpaid', 'paid'].includes(paymentStatus)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid payment status' 
            });
        }

        // Validate payment method
        if (paymentMethod && !['cash', 'card', 'online'].includes(paymentMethod)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid payment method' 
            });
        }

        const order = await PosOrder.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        // Check if order is in a valid state for payment
        if (order.status !== 'served' && order.status !== 'completed') {
            return res.status(400).json({ 
                success: false, 
                error: 'Order must be served before payment can be processed' 
            });
        }

        // Update payment information
        if (paymentStatus) order.paymentStatus = paymentStatus;
        if (paymentMethod) order.paymentMethod = paymentMethod;
        
        // If payment is completed, mark order as completed
        if (paymentStatus === 'paid') {
            order.status = status || 'completed';
            order.completedAt = new Date();
            
            // Update table status to available
            const table = await PosTable.findById(order.table);
            if (table) {
                table.status = 'available';
                table.currentOrder = null;
                table.assignedWaiter = null;
                await table.save();
            }
        }

        await order.save();

        const updatedOrder = await PosOrder.findById(order._id)
            .populate('table', 'tableNumber')
            .populate('waiter', 'name');

        res.json({ 
            success: true, 
            message: 'Payment processed successfully',
            order: updatedOrder 
        });
    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================
// OPTIONAL: Add these helper routes for better cashier experience
// ============================================

// Get only unpaid orders (for cashier)
app.get('/pos/orders/unpaid', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'cashier' && req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Cashier or Admin only.' 
            });
        }

        const orders = await PosOrder.find({ 
            status: 'served',
            paymentStatus: 'unpaid'
        })
            .populate('table', 'tableNumber')
            .populate('waiter', 'name')
            .populate('items.menuItem', 'name')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, orders });
    } catch (error) {
        console.error('Error fetching unpaid orders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get payment history with filters
app.get('/pos/payments', fetchPosUser, async (req, res) => {
    try {
        if (req.posUser.role !== 'cashier' && req.posUser.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied. Cashier or Admin only.' 
            });
        }

        const { startDate, endDate, paymentMethod } = req.query;
        
        let query = { 
            status: 'completed',
            paymentStatus: 'paid'
        };

        // Date filter
        if (startDate || endDate) {
            query.completedAt = {};
            if (startDate) query.completedAt.$gte = new Date(startDate);
            if (endDate) query.completedAt.$lte = new Date(endDate);
        }

        // Payment method filter
        if (paymentMethod) {
            query.paymentMethod = paymentMethod;
        }

        const payments = await PosOrder.find(query)
            .populate('table', 'tableNumber')
            .populate('waiter', 'name')
            .populate('items.menuItem', 'name')
            .sort({ completedAt: -1 });
        
        // Calculate totals
        const totalCash = payments
            .filter(p => p.paymentMethod === 'cash')
            .reduce((sum, p) => sum + p.totalAmount, 0);
        
        const totalCard = payments
            .filter(p => p.paymentMethod === 'card')
            .reduce((sum, p) => sum + p.totalAmount, 0);
        
        const totalOnline = payments
            .filter(p => p.paymentMethod === 'online')
            .reduce((sum, p) => sum + p.totalAmount, 0);

        res.json({ 
            success: true, 
            payments,
            summary: {
                totalRevenue: totalCash + totalCard + totalOnline,
                totalCash,
                totalCard,
                totalOnline,
                totalTransactions: payments.length
            }
        });
    } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// ADD THESE STRIPE SUBSCRIPTION ROUTES TO YOUR server.js
// Place after your existing Stripe payment routes
// ============================================

// Subscription Schema
const Subscription = mongoose.model('Subscription', {
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PosUser',
        required: true
    },
    stripeCustomerId: {
        type: String,
        required: true
    },
    stripeSubscriptionId: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'canceled', 'past_due', 'trialing'],
        default: 'active'
    },
    priceId: {
        type: String,
        required: true
    },
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: Boolean,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create Stripe Checkout Session for Subscription
app.post("/create-subscription-checkout", async (req, res) => {
    try {
        const { email, name } = req.body;

        if (!email || !name) {
            return res.status(400).json({ 
                success: false, 
                error: "Email and name are required" 
            });
        }

        // Create or retrieve Stripe customer
        let customer;
        const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1
        });

        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
        } else {
            customer = await stripe.customers.create({
                email: email,
                name: name
            });
        }

        // Create checkout session for subscription
        const session = await stripe.checkout.sessions.create({
            customer: customer.id,
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Restaurant Management System - Monthly Subscription',
                            description: 'Full access to POS, orders, staff management, reports & dashboard'
                        },
                        unit_amount: 1200, // $12.00 in cents
                        recurring: {
                            interval: 'month'
                        }
                    },
                    quantity: 1
                }
            ],
            mode: 'subscription',
            success_url: `${req.headers.origin}/login?session_id={CHECKOUT_SESSION_ID}&subscription=success`,
            cancel_url: `${req.headers.origin}/?subscription=cancelled`,
            metadata: {
                customerEmail: email,
                customerName: name
            }
        });

        res.json({ 
            success: true, 
            sessionId: session.id,
            url: session.url 
        });

    } catch (error) {
        console.error('Error creating subscription checkout:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Verify subscription after checkout
app.post("/verify-subscription", async (req, res) => {
    try {
      const { sessionId } = req.body;
  
      if (!sessionId) {
        return res.status(400).json({ success: false, error: "Session ID is required" });
      }
  
      // ✅ 1. Get checkout session
      const session = await stripe.checkout.sessions.retrieve(sessionId);
  
      if (!session || !session.subscription) {
        return res.status(404).json({ success: false, error: "Invalid session" });
      }
  
      // ✅ 2. Get subscription
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
  
      console.log("Stripe Subscription Full Object:", subscription);
  
      // ✅ 3. SAFE DATE ACCESS (REAL FIX)
      const periodStart =
        subscription.items?.data[0]?.current_period_start;
  
      const periodEnd =
        subscription.items?.data[0]?.current_period_end;
  
      if (!periodStart || !periodEnd) {
        return res.status(400).json({
          success: false,
          error: "Stripe did not return subscription period dates"
        });
      }
  
      const currentPeriodStart = new Date(periodStart * 1000);
      const currentPeriodEnd = new Date(periodEnd * 1000);
  
      // ✅ 4. Find or Create User
      let user = await PosUser.findOne({ email: session.customer_details.email });
  
      if (!user) {
        const temporaryPassword = Math.random().toString(36).slice(-8);
  
        user = new PosUser({
          name: session.customer_details.name || "Admin",
          email: session.customer_details.email,
          password: temporaryPassword,
          role: "admin",
          phone: ""
        });
  
        await user.save();
  
        await sendSubscriptionWelcomeEmail(
          user.email,
          user.name,
          temporaryPassword
        );
      }
  
      // ✅ 5. Save Subscription
      const newSubscription = new Subscription({
        userId: user._id,
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
        status: subscription.status,
        priceId: subscription.items.data[0].price.id,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      });
  
      await newSubscription.save();
  
      console.log("✅ Subscription created for:", user.email);
  
      res.json({
        success: true,
        message: "Subscription verified successfully",
        user: {
          email: user.email,
          name: user.name,
          role: user.role
        },
        subscription: {
          status: subscription.status,
          currentPeriodEnd: currentPeriodEnd.toISOString()
        }
      });
  
    } catch (error) {
      console.error("❌ Subscription verification error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  

// Get subscription status for a user
app.get("/subscription-status/:email", async (req, res) => {
    try {
        const user = await PosUser.findOne({ email: req.params.email });
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: "User not found" 
            });
        }

        const subscription = await Subscription.findOne({ userId: user._id })
            .sort({ createdAt: -1 });

        if (!subscription) {
            return res.json({ 
                success: true, 
                hasSubscription: false 
            });
        }

        res.json({ 
            success: true, 
            hasSubscription: true,
            subscription: {
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
            }
        });

    } catch (error) {
        console.error('Error checking subscription:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Cancel subscription
app.post("/cancel-subscription", async (req, res) => {
    try {
        const { email } = req.body;

        const user = await PosUser.findOne({ email });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: "User not found" 
            });
        }

        const subscription = await Subscription.findOne({ userId: user._id })
            .sort({ createdAt: -1 });

        if (!subscription) {
            return res.status(404).json({ 
                success: false, 
                error: "No active subscription found" 
            });
        }

        // Cancel at period end (don't cancel immediately)
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        subscription.cancelAtPeriodEnd = true;
        await subscription.save();

        res.json({ 
            success: true, 
            message: "Subscription will be cancelled at period end" 
        });

    } catch (error) {
        console.error('Error cancelling subscription:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Stripe webhook to handle subscription events
// Stripe webhook to handle subscription events
app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig, 
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.log(`⚠️ Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`📨 Webhook received: ${event.type}`);

    // Handle the event
    switch (event.type) {
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
            const subscription = event.data.object;
            
            // ✅ FIX: Convert Unix timestamp to Date
            const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
            
            await Subscription.findOneAndUpdate(
                { stripeSubscriptionId: subscription.id },
                { 
                    status: subscription.status,
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    currentPeriodEnd: currentPeriodEnd
                }
            );
            console.log(`✅ Subscription ${subscription.id} updated`);
            break;
            
        default:
            console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({received: true});
});

// Email function for subscription welcome
async function sendSubscriptionWelcomeEmail(email, name, temporaryPassword) {
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
                .header { text-align: center; padding-bottom: 20px; border-bottom: 2px solid #10b981; }
                .logo { font-size: 32px; font-weight: bold; color: #10b981; }
                .content { padding: 30px 0; color: #454545; }
                .credentials { background: #f0fdf4; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .button { display: inline-block; padding: 15px 40px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
                .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e3e3e3; color: #888; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="logo">🍽️ Restaurant POS System</div>
                </div>
                <div class="content">
                    <h2>Welcome to Your Restaurant Management System!</h2>
                    <p>Hi ${name},</p>
                    <p>Thank you for subscribing! Your payment has been processed successfully.</p>
                    
                    <div class="credentials">
                        <h3 style="margin-top: 0; color: #10b981;">Your Login Credentials</h3>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
                        <p style="color: #ef4444; font-size: 14px;">⚠️ Please change your password after first login</p>
                    </div>

                    <p>You now have full access to:</p>
                    <ul>
                        <li>✅ POS Order Management</li>
                        <li>✅ Staff Management</li>
                        <li>✅ Menu Management</li>
                        <li>✅ Table Management</li>
                        <li>✅ Reports & Analytics</li>
                        <li>✅ Payment Processing</li>
                    </ul>
                    
                    <center>
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" class="button">Login to Dashboard</a>
                    </center>

                    <p style="margin-top: 30px;">
                        Best regards,<br>
                        <strong>Restaurant POS Team</strong>
                    </p>
                </div>
                <div class="footer">
                    <p>&copy; 2025 Restaurant POS System. All rights reserved.</p>
                    <p>Your subscription: $12/month • Cancel anytime</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const mailOptions = {
        from: `"Restaurant POS" <${process.env.SMTP_GOOGLE_MAIL_ADDRESS}>`,
        to: email,
        subject: '🎉 Welcome to Restaurant POS - Your Account is Ready!',
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Subscription welcome email sent to: ${email}`);
    } catch (error) {
        console.error(`Failed to send welcome email to ${email}:`, error);
    }
}


app.get("/check-subscription/:email", async (req, res) => {
    try {
        const user = await PosUser.findOne({ email: req.params.email });
        
        if (!user) {
            return res.json({ 
                success: true,
                hasActiveSubscription: false,
                message: "No user found with this email"
            });
        }

        const subscription = await Subscription.findOne({ 
            userId: user._id,
            status: 'active'
        }).sort({ createdAt: -1 });

        if (!subscription) {
            return res.json({ 
                success: true,
                hasActiveSubscription: false,
                message: "No active subscription found"
            });
        }

        // Check if subscription is still valid
        const now = new Date();
        const isValid = now < subscription.currentPeriodEnd;

        res.json({ 
            success: true,
            hasActiveSubscription: isValid,
            subscription: {
                status: subscription.status,
                currentPeriodEnd: subscription.currentPeriodEnd,
                daysRemaining: Math.ceil((subscription.currentPeriodEnd - now) / (1000 * 60 * 60 * 24))
            }
        });

    } catch (error) {
        console.error('Error checking subscription:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});
// Global error handler
app.use(globalErrorHandler);

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`E-commerce routes: /signup, /login, /addtocart, etc.`);
    console.log(`POS System routes: /api/user/*, /api/order/*, /api/table/*`);
});