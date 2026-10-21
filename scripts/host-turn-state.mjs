/** Runs in the browser. Composer clearing and the Send label are optimistic,
 * not completion signals. DSH renders data-turn-process only for closed turns. */
export function completedTurnsReady(expected) {
  const conversation = document.querySelector('[data-conversation-session]')
  if (!conversation) return false
  const closed = [...conversation.querySelectorAll('[data-turn-process]')]
  const editor = conversation.querySelector('[contenteditable="true"]')
  return closed.length === expected
    // 0.2.0-rc.1 labels successful turns Worked/Took; newer hosts use Completed.
    && closed.every(turn => /^(?:Completed|Worked|Took)(?:\s|$)/.test(turn.textContent.trim()))
    && editor !== null && editor.textContent === ''
    && conversation.querySelector('[aria-label="Stop generating"]') === null
}

export async function waitForCompletedTurns(page, expected) {
  await page.waitForFunction(completedTurnsReady, expected, { timeout: 25000 })
}

/** Safe CI diagnostics: never expose the URL token, message text or Profile. */
export function hostTurnDiagnostics() {
  const conversation = document.querySelector('[data-conversation-session]')
  return {
    conversationPresent: conversation !== null,
    closedTurns: conversation?.querySelectorAll('[data-turn-process]').length ?? 0,
    editorEmpty: conversation?.querySelector('[contenteditable="true"]')?.textContent === '',
    stopVisible: conversation?.querySelector('[aria-label="Stop generating"]') !== null && conversation !== null,
  }
}
