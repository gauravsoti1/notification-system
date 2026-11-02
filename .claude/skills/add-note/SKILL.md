---
name: add-note
description: Add a question-and-answer entry to this project's notes (notes/qa-log.md), under the section for the current git branch. Use when the user asks to add, save or note down a question or answer in their notes.
---

# Add a note

Notes live in `notes/qa-log.md`, grouped by git branch, in question-and-answer form. The layout is described in `notes/README.md`.

## Steps

1. Get the current branch: `git branch --show-current`.
2. Read `notes/qa-log.md`.
3. Find the section `## <branch>: <one-line summary>`.
   - If it exists, insert the new entry directly under that heading, so the newest entry is first.
   - If it doesn't exist, create it directly under the intro line, above the other branch sections. Write a one-line summary of what the branch does. Use the Jira ticket (key = branch name, if it looks like `NS-9`) or the branch's work to write it, and ask the user if it isn't clear.
4. Write the entry in this format:

   ```
   ### Q: <question, in the user's words, tidied lightly>
   A: <short direct answer>

   - <optional supporting bullets>
   ```

5. Tell the user which section the entry went under, in one or two lines.

## Rules

- Answer the question the user asked. If the honest answer is "it depends", say so in the note rather than turning it into a flat statement.
- Only state facts you know. If the answer came from general knowledge and not from docs, say so in the entry. If it's a source-backed answer, list the source URLs.
- If the user asks for a disclaimer, add it as a final `> **Disclaimer:** ...` line in the entry.
- Don't create new files. Don't reorder or rewrite existing entries unless asked.
- If a note is about something that happened in this repo (e.g. why a setting was removed), include the file names involved.
