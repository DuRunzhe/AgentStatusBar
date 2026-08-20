'use strict';

/**
 * A session is automatic-confirmation only when the agent's runtime metadata
 * explicitly says that it never asks for approval. Do not infer this from the
 * executable name or from an agent merely supporting an automatic mode.
 */
function isAutomaticConfirmationMode(agentName, sessionAnalysis) {
  return agentName === 'Codex'
    && (sessionAnalysis?.approvalPolicy === 'never'
      || sessionAnalysis?.approvalsReviewer === 'auto_review');
}

function shouldNotifyForInstance(instance, config) {
  if (instance?.state !== 'waiting') return true;
  return config?.showWaitingNotificationsInAutoConfirmMode !== false
    || instance?.automatic_confirmation_mode !== true;
}

module.exports = {
  isAutomaticConfirmationMode,
  shouldNotifyForInstance,
};
