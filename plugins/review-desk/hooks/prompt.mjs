import { readFileSync } from 'node:fs'
import { workflow } from '../workflow.mjs'

const event = JSON.parse(readFileSync(0, 'utf8'))
const prompt = event.prompt?.trim() || ''
if (event.hook_event_name === 'UserPromptSubmit' && !event.agent_id &&
    /^(?:(?:hey[, ]+)?codex[, ]+)?(?:(?:let['’]s|please|can you|could you|will you)\s+)*(?:start (?:a |the )?(?:code )?review (?:of |on )?|review\s+)/i.test(prompt) &&
    /(?:\bPR\b|pull request|#\d+|github\.com\/[^\s]+\/pull\/\d+)/i.test(prompt)) {
  console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext:workflow}}))
}
