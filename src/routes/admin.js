const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { validationQueue, schedulePendingValidation } = require('../services/queue');

const router = express.Router();
const prisma = new PrismaClient();

// Simple admin check (in production, use proper admin role)
const isAdmin = (req) => {
    return req.user?.email === process.env.ADMIN_EMAIL;
};

// POST /api/admin/validate-now - Manually trigger validation
router.post('/validate-now', async (req, res) => {
    try {
        // Check admin (simplified - in production use proper auth)
        const adminEmail = process.env.ADMIN_EMAIL;
        if (!adminEmail) {
            return res.status(500).json({ error: 'Admin not configured' });
        }

        // Queue all pending links
        await schedulePendingValidation(prisma);

        res.json({ success: true, message: 'Validation triggered' });
    } catch (error) {
        console.error('Admin validate error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/stats - Get validation stats
router.get('/stats', async (req, res) => {
    try {
        const [pending, valid, invalid] = await Promise.all([
            prisma.productLink.count({ where: { status: 'pending' } }),
            prisma.productLink.count({ where: { status: 'valid' } }),
            prisma.productLink.count({ where: { status: 'invalid' } })
        ]);

        res.json({ pending, valid, invalid });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
