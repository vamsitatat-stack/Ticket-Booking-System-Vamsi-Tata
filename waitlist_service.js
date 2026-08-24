const Redis = require('ioredis');
const crypto = require('crypto');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const OFFER_TTL_SECONDS = 900; // 15-minute offer window

/**
 * Adds a user to the category-specific waitlist queue (FIFO via timestamp score)
 */
async function joinWaitlist(showId, category, userId) {
  const queueKey = `waitlist:${showId}:${category}`;
  const timestamp = Date.now();
  await redis.zadd(queueKey, timestamp, userId);
  return { message: 'Successfully joined waitlist queue' };
}

/**
 * Triggers automatically when a booking is cancelled.
 * Offers freed seat to the next user in line.
 */
async function processCancellation(db, io, showId, seatId, category) {
  const queueKey = `waitlist:${showId}:${category}`;

  // 1. Pop the top user from FIFO waitlist queue
  const [nextUserId] = await redis.zpopmin(queueKey);

  if (!nextUserId) {
    // Queue is empty: Mark seat as AVAILABLE for public booking
    await db.query(
      `UPDATE show_seats SET status = 'AVAILABLE', held_by = NULL WHERE id = $1`,
      [seatId]
    );
    io.to(`show_${showId}`).emit('seat_status_changed', { seatId, status: 'AVAILABLE', heldBy: null });
    return;
  }

  // 2. Generate a unique, time-limited offer token
  const offerToken = crypto.randomBytes(24).toString('hex');
  const offerKey = `offer:${offerToken}`;

  const offerData = {
    showId,
    seatId,
    userId: nextUserId,
    category
  };

  // Store offer payload in Redis with 15-min TTL
  await redis.set(offerKey, JSON.stringify(offerData), 'EX', OFFER_TTL_SECONDS);

  // 3. Mark seat status as HELD in DB for the waitlisted user
  await db.query(
    `UPDATE show_seats SET status = 'HELD', held_by = $1 WHERE id = $2`,
    [nextUserId, seatId]
  );

  io.to(`show_${showId}`).emit('seat_status_changed', {
    seatId,
    status: 'HELD',
    heldBy: nextUserId
  });

  // 4. Send email notification (Simulated trigger for time-limited claim link)
  console.log(`[Waitlist Offer] Token generated for User ${nextUserId}: /claim-ticket?token=${offerToken}`);
  
  return { offerToken, assignedUserId: nextUserId };
}

/**
 * Allows waitlisted user to claim their ticket before the 15-minute token expires
 */
async function claimWaitlistOffer(db, offerToken, userId) {
  const offerKey = `offer:${offerToken}`;
  const rawData = await redis.get(offerKey);

  if (!rawData) {
    throw new Error('Offer token has expired or is invalid.');
  }

  const { showId, seatId, userId: targetUserId } = JSON.parse(rawData);

  if (parseInt(userId, 10) !== parseInt(targetUserId, 10)) {
    throw new Error('This ticket offer belongs to another user.');
  }

  // Delete token to prevent double-claiming
  await redis.del(offerKey);

  return { showId, seatId };
}

module.exports = {
  joinWaitlist,
  processCancellation,
  claimWaitlistOffer
};
