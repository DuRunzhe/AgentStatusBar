'use strict';

function displayedUptimeMinute(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.floor(seconds / 60);
}

function getStatusPublicationSignature(output) {
  const normalized = {
    ...output,
    agents: (output.agents || []).map(agent => ({
      ...agent,
      instances: (agent.instances || []).map(instance => {
        const normalizedInstance = {
          ...instance,
          uptime_sec: displayedUptimeMinute(instance.uptime_sec),
        };
        delete normalizedInstance.last_activity_ms_ago;
        return normalizedInstance;
      }),
    })),
  };
  delete normalized.timestamp;
  delete normalized.detail;
  return JSON.stringify(normalized);
}

function getStatusPublication(output, now = Date.now()) {
  return {
    signature: getStatusPublicationSignature(output),
    minute: Math.floor(now / 60_000),
  };
}

function shouldPublishStatus(previous, next, statusExists = true) {
  return !statusExists
    || previous == null
    || previous.signature !== next.signature
    || previous.minute !== next.minute;
}

module.exports = {
  displayedUptimeMinute,
  getStatusPublication,
  getStatusPublicationSignature,
  shouldPublishStatus,
};
