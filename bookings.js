const express = require('express');
const Redis = require('ioredis');
const router = express.Router();

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const HOLD_TTL_SECONDS = 600; // 10 minutes

// POST /api/shows/:showId/hold
router.post('/shows/:showId/hold', async (req, res) => {
  const { showId } = req.params;
  const { seatIds, userId } = req.body;
  const io = req.app.get('io');

  if (!seatIds || seatIds.length === 0) {
    return res.status(400).json({ message: 'No seats selected.' });
  }

  // Multi-key Redis lock strategy using pipeline for atomicity
  const pipeline = redis.pipeline();
  seatIds.forEach((seatId) => {
    const lockKey = `hold:${showId}:${seatId}`;
    // SET key value NX (only set if not exists) EX (expire in seconds)
    pipeline.set(lockKey, userId, 'NX', 'EX', HOLD_TTL_SECONDS);
  });

  const results = await pipeline.exec();
  
  // Check if ALL requested seats were successfully locked
  const failedSeats = [];
  results.forEach(([err, result], index) => {
    if (result !== 'OK') {
      failedSeats.push(seatIds[index]);
    }
  });

  // If any lock failed, rollback acquired locks to keep operation atomic
  if (failedSeats.length > 0) {
    const rollbackPipeline = redis.pipeline();
    seatIds.forEach((seatId, index) => {
      if (results[index][1] === 'OK') {
        rollbackPipeline.del(`hold:${showId}:${seatId}`);
      }
    });
    await rollbackPipeline.exec();

    return res.status(409).json({
      message: 'One or more selected seats were already taken by another customer.',
      failedSeats
    });
  }

  // Update DB status to HELD and broadcast to connected socket clients
  await req.db.query(
    `UPDATE show_seats SET status = 'HELD', held_by = $1 WHERE id = ANY($2)`,
    [userId, seatIds]
  );

  seatIds.forEach((seatId) => {
    io.to(`show_${showId}`).emit('seat_status_changed', {
      seatId,
      status: 'HELD',
      heldBy: userId
    });
  });

  return res.json({
    message: 'Seats held successfully',
    expiresIn: HOLD_TTL_SECONDS
  });
});

module.exports = router;
