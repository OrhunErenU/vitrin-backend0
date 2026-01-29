const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');
const { validationQueue } = require('../services/queue');

const router = express.Router();
const prisma = new PrismaClient();

const DAILY_OUTFIT_LIMIT = 3;

// Get today's date at midnight for date comparison
const getTodayMidnight = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
};

// Create outfit with daily quota check
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { imageUrl, products, style } = req.body;
        const userId = req.user.id;

        if (!imageUrl) {
            return res.status(400).json({ error: 'Image URL is required' });
        }

        // Check daily quota
        const today = getTodayMidnight();
        let quota = await prisma.dailyQuota.findUnique({
            where: {
                userId_date: { userId, date: today }
            }
        });

        if (quota && quota.count >= DAILY_OUTFIT_LIMIT) {
            return res.status(429).json({
                error: 'Daily outfit limit reached. Maximum 3 outfits per day.',
                remainingTime: '24 hours'
            });
        }

        // Create outfit
        const outfit = await prisma.outfit.create({
            data: {
                userId,
                imageUrl,
                products: products || [],
                style: style || null
            }
        });

        // Update or create daily quota
        if (quota) {
            await prisma.dailyQuota.update({
                where: { id: quota.id },
                data: { count: { increment: 1 } }
            });
        } else {
            await prisma.dailyQuota.create({
                data: {
                    userId,
                    date: today,
                    count: 1
                }
            });
        }

        res.status(201).json(outfit);
    } catch (error) {
        console.error('Create outfit error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all outfits (public feed)
router.get('/', async (req, res) => {
    try {
        const outfits = await prisma.outfit.findMany({
            where: { status: 'active' },
            include: {
                user: { select: { id: true, username: true } },
                likes: true,
                productLinks: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(outfits);
    } catch (error) {
        console.error('Get outfits error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user's outfits
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const outfits = await prisma.outfit.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json(outfits);
    } catch (error) {
        console.error('Get my outfits error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user's daily quota status
router.get('/quota', authenticateToken, async (req, res) => {
    try {
        const today = getTodayMidnight();
        const quota = await prisma.dailyQuota.findUnique({
            where: {
                userId_date: { userId: req.user.id, date: today }
            }
        });

        res.json({
            used: quota?.count || 0,
            limit: DAILY_OUTFIT_LIMIT,
            remaining: Math.max(0, DAILY_OUTFIT_LIMIT - (quota?.count || 0))
        });
    } catch (error) {
        console.error('Get quota error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Like/unlike outfit
router.post('/:outfitId/like', authenticateToken, async (req, res) => {
    try {
        const { outfitId } = req.params;
        const userId = req.user.id;

        // Check if already liked
        const existingLike = await prisma.like.findUnique({
            where: {
                userId_outfitId: { userId, outfitId }
            }
        });

        if (existingLike) {
            // Unlike
            await prisma.like.delete({ where: { id: existingLike.id } });
            res.json({ liked: false });
        } else {
            // Like
            await prisma.like.create({
                data: { userId, outfitId }
            });
            res.json({ liked: true });
        }
    } catch (error) {
        console.error('Like error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add product link to outfit
router.post('/:outfitId/products', authenticateToken, async (req, res) => {
    try {
        const { outfitId } = req.params;
        const { url, domain, metadata } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Verify outfit belongs to user
        const outfit = await prisma.outfit.findUnique({
            where: { id: outfitId }
        });

        if (!outfit) {
            return res.status(404).json({ error: 'Outfit not found' });
        }

        if (outfit.userId !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const productLink = await prisma.productLink.create({
            data: {
                outfitId,
                url,
                domain: domain || new URL(url).hostname,
                status: 'pending',
                metadata: metadata || null
            }
        });

        // Queue validation job
        await validationQueue.add('validate_link', {
            linkId: productLink.id,
            url
        });

        res.status(201).json(productLink);
    } catch (error) {
        console.error('Add product link error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Report outfit
router.post('/:id/report', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const validReasons = ['inappropriate', 'spam', 'fake'];
        if (!reason || !validReasons.includes(reason)) {
            return res.status(400).json({ error: 'Reason must be one of: inappropriate, spam, fake' });
        }

        const outfit = await prisma.outfit.findUnique({
            where: { id }
        });

        if (!outfit) {
            return res.status(404).json({ error: 'Outfit not found' });
        }

        // Update outfit with report
        const updatedOutfit = await prisma.outfit.update({
            where: { id },
            data: {
                reportCount: { increment: 1 },
                reportReason: reason,
                status: outfit.reportCount + 1 >= 3 ? 'reported' : 'active'
            }
        });

        res.json({
            success: true,
            hidden: updatedOutfit.status === 'reported',
            reportCount: updatedOutfit.reportCount
        });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete outfit (owner only)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const outfit = await prisma.outfit.findUnique({
            where: { id }
        });

        if (!outfit) {
            return res.status(404).json({ error: 'Outfit not found' });
        }

        if (outfit.userId !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Cascade delete handled by Prisma
        await prisma.outfit.delete({ where: { id } });

        res.json({ success: true });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get outfit details
router.get('/:id/details', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const outfit = await prisma.outfit.findUnique({
            where: { id },
            include: {
                user: { select: { id: true, username: true } },
                likes: true,
                productLinks: true
            }
        });

        if (!outfit) {
            return res.status(404).json({ error: 'Outfit not found' });
        }

        // Check if current user liked this outfit
        const isLiked = await prisma.like.findUnique({
            where: {
                userId_outfitId: { userId: req.user.id, outfitId: id }
            }
        });

        res.json({
            id: outfit.id,
            imageUrl: outfit.imageUrl,
            products: outfit.products,
            style: outfit.style,
            status: outfit.status,
            createdAt: outfit.createdAt,
            user: {
                id: outfit.user.id,
                username: outfit.user.username
            },
            productLinks: outfit.productLinks.map(pl => ({
                id: pl.id,
                url: pl.url,
                domain: pl.domain,
                isValid: pl.isValid,
                metadata: pl.metadata
            })),
            likeCount: outfit.likes.length,
            isLiked: !!isLiked,
            comments: [] // Mock empty array
        });
    } catch (error) {
        console.error('Get outfit details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
