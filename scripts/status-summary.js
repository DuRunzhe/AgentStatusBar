'use strict';

function buildStatusSummary(counts, text) {
  const waiting = counts.waiting || 0;
  const waitingReply = counts.waitingReply || 0;
  const working = counts.working || 0;
  const ready = counts.ready || 0;
  const parts = [];

  if (waiting > 0) parts.push(text.countWaiting(waiting));
  if (waitingReply > 0) parts.push(text.countWaitingReply(waitingReply));
  if (working > 0) parts.push(text.countWorking(working));
  if (ready > 0) parts.push(text.countReady(ready));

  if (parts.length === 0) return { emoji: '⚪', label: text.noActivity };
  if (waiting > 0 || waitingReply > 0) return { emoji: '🟡', label: parts.join(' · ') };
  if (working > 0) return { emoji: '🔵', label: parts.join(' · ') };
  return { emoji: '🟢', label: parts.join(' · ') };
}

module.exports = { buildStatusSummary };
