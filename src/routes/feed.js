const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/feed?limit=10&cursor=&style=
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { limit = 10, cursor, style } = req.query;
        const userId = req.user.id;
        const take = Math.min(parseInt(limit) || 10, 50);

        const where = {
            status: 'active',
            userId: { not: userId } // Exclude own outfits
        };

        // Add style filter if provided
        if (style) {
            where.style = style;
        }

        // Add cursor filter
        if (cursor) {
            where.createdAt = { lt: new Date(cursor) };
        }

        const outfits = await prisma.outfit.findMany({
            where,
            take: take + 1, // Fetch one extra to determine if there's a next page
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { id: true, username: true } },
                likes: true,
                productLinks: true
            }
        });

        // Get user's liked outfit IDs for this batch
        const outfitIds = outfits.map(o => o.id);
        const likedOutfits = await prisma.like.findMany({
            where: {
                userId,
                outfitId: { in: outfitIds }
            }
        });
        const likedSet = new Set(likedOutfits.map(l => l.outfitId));

        // Determine next cursor
        let nextCursor = null;
        if (outfits.length > take) {
            const nextItem = outfits.pop();
            nextCursor = nextItem.createdAt.toISOString();
        }

        // Format response
        const formattedOutfits = outfits.map(outfit => ({
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
                isValid: pl.isValid
            })),
            likeCount: outfit.likes.length,
            isLiked: likedSet.has(outfit.id)
        }));

        res.json({ outfits: formattedOutfits, nextCursor });
    } catch (error) {
        console.error('Feed error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
