'use strict';

function getInstanceTrackerKey(agentName, instance = {}) {
  const pids = Array.isArray(instance.pids)
    ? instance.pids
      .filter(pid => Number.isInteger(pid) && pid > 0)
      .sort((a, b) => a - b)
    : [];

  if (pids.length > 0) return `${agentName}:pid:${pids.join(',')}`;
  return `${agentName}:label:${String(instance.label || '')}`;
}

module.exports = { getInstanceTrackerKey };
