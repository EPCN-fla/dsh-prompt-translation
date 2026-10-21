import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { completedTurnsReady, hostTurnDiagnostics } from './host-turn-state.mjs'

test('reload waits for the second closed turn, not optimistic composer state or the Send label', () => {
  const dom = new JSDOM(`<div data-conversation-session="fixture">
    <button data-turn-process="1">Completed in 1s</button>
    <div contenteditable="true"></div><button aria-label="Send message"></button>
  </div>`)
  const previous = globalThis.document
  globalThis.document = dom.window.document
  try {
    assert.equal(completedTurnsReady(1), true)
    assert.equal(completedTurnsReady(2), false, 'empty composer and Send label must not permit reload')
    const conversation = document.querySelector('[data-conversation-session]')
    conversation.insertAdjacentHTML('beforeend', '<p>中文:SMOKE_ANSWER</p><p>中文:SMOKE_ANSWER</p>')
    assert.equal(completedTurnsReady(2), false, 'streamed answer does not close the turn')
    conversation.insertAdjacentHTML('beforeend', '<button data-turn-process="2">Completed in 2s</button>')
    assert.equal(completedTurnsReady(2), true)
    document.querySelector('[data-turn-process="1"]').textContent = 'Worked'
    document.querySelector('[data-turn-process="2"]').textContent = 'Took 2s'
    assert.equal(completedTurnsReady(2), true, '0.2.0-rc.1 completion labels are supported')
    conversation.insertAdjacentHTML('beforeend', '<button aria-label="Stop generating"></button>')
    assert.equal(completedTurnsReady(2), false)
    document.querySelector('[aria-label="Stop generating"]').remove()
    document.querySelector('[data-turn-process="2"]').textContent = 'Failed'
    assert.equal(completedTurnsReady(2), false, 'failed turn is not a successful completion')
    assert.deepEqual(hostTurnDiagnostics(), { conversationPresent: true, closedTurns: 2, editorEmpty: true, stopVisible: false })
    conversation.remove()
    assert.equal(completedTurnsReady(2), false)
    assert.deepEqual(hostTurnDiagnostics(), { conversationPresent: false, closedTurns: 0, editorEmpty: false, stopVisible: false })
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
    dom.window.close()
  }
})
