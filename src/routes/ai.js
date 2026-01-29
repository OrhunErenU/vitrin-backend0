const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// In-memory rate limiting
const rateLimitStore = new Map();

// Helper: check rate limit
const checkRateLimit = (userId, limit, windowMs) => {
    const now = Date.now();
    const userTimestamps = rateLimitStore.get(userId) || [];
    const windowStart = now - windowMs;

    // Filter to only recent timestamps
    const recent = userTimestamps.filter(t => t > windowStart);

    if (recent.length >= limit) {
        return { allowed: false, remaining: 0, resetAt: new Date(Math.min(...recent) + windowMs) };
    }

    recent.push(now);
    rateLimitStore.set(userId, recent);

    return { allowed: true, remaining: limit - recent.length };
};

// POST /api/ai/try-on - Virtual try-on (2s delay)
router.post('/try-on', authenticateToken, async (req, res) => {
    try {
        const { outfitId, userPhotoBase64 } = req.body;
        const userId = req.user.id;

        if (!outfitId || !userPhotoBase64) {
            return res.status(400).json({ error: 'outfitId and userPhotoBase64 required' });
        }

        // Rate limit: 10/hour
        const limit = checkRateLimit(userId, 10, 60 * 60 * 1000);
        if (!limit.allowed) {
            return res.status(429).json({ error: 'Rate limit exceeded', remaining: 0, resetAt: limit.resetAt });
        }

        // Mock 2s processing
        await new Promise(resolve => setTimeout(resolve, 2000));

        res.json({
            success: true,
            resultImageUrl: `https://mock.vitrin.ai/tryon_${Date.now()}.jpg`,
            processingTime: 2
        });
    } catch (error) {
        console.error('Try-on error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/wardrobe/analyze - AI vision analysis (1s delay)
router.post('/wardrobe/analyze', authenticateToken, async (req, res) => {
    try {
        const { photoBase64 } = req.body;
        const userId = req.user.id;

        if (!photoBase64) {
            return res.status(400).json({ error: 'photoBase64 required' });
        }

        // Rate limit: 20/hour
        const limit = checkRateLimit(userId, 20, 60 * 60 * 1000);
        if (!limit.allowed) {
            return res.status(429).json({ error: 'Rate limit exceeded', remaining: 0, resetAt: limit.resetAt });
        }

        // Mock 1s processing
        await new Promise(resolve => setTimeout(resolve, 1000));

        res.json({
            items: [
                { type: 'top', color: 'black', style: 'casual', confidence: 0.92 },
                { type: 'bottom', color: 'blue', style: 'denim', confidence: 0.87 }
            ],
            detectedCount: 2
        });
    } catch (error) {
        console.error('Wardrobe analyze error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/ai/outfit/generate - AI outfit suggestion (1.5s delay)
router.post('/outfit/generate', authenticateToken, async (req, res) => {
    try {
        const { likedOutfitIds = [], fromWardrobe = false } = req.body;

        // Mock 1.5s processing
        await new Promise(resolve => setTimeout(resolve, 1500));

        res.json({
            suggestedProducts: [
                { name: 'Basic White Tee', category: 'top', color: 'white', mockUrl: 'https://mock.vitrin.ai/product_1.jpg' },
                { name: 'Slim Fit Jeans', category: 'bottom', color: 'blue', mockUrl: 'https://mock.vitrin.ai/product_2.jpg' },
                { name: 'White Sneakers', category: 'shoes', color: 'white', mockUrl: 'https://mock.vitrin.ai/product_3.jpg' }
            ],
            aiImageUrl: `https://mock.vitrin.ai/generated_${Date.now()}.jpg`,
            style: 'minimal'
        });
    } catch (error) {
        console.error('Outfit generate error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/ai/limits - Current usage
router.get('/limits', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const now = Date.now();
        const hourMs = 60 * 60 * 1000;

        // Try-on usage
        const tryOnTimestamps = rateLimitStore.get(userId) || [];
        const recentTryOn = tryOnTimestamps.filter(t => t > now - hourMs);
        const tryOnRemaining = Math.max(0, 10 - recentTryOn.length);

        // Wardrobe usage (reuse same store for simplicity)
        const wardrobeTimestamps = rateLimitStore.get(`${userId}_wardrobe`) || [];
        const recentWardrobe = wardrobeTimestamps.filter(t => t > now - hourMs);
        const wardrobeRemaining = Math.max(0, 20 - recentWardrobe.length);

        res.json({
            tryOnRemaining,
            wardrobeRemaining,
            lastReset: new Date(now - (now % hourMs)).toISOString()
        });
    } catch (error) {
        console.error('Get limits error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
