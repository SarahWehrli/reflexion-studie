# Reflection Study - Local Web App

## Before the study (one-time setup)
1. Open `config.js` and replace the placeholder in `PROMPT_TEXT` with your system prompt.
2. Optionally add questionnaire links under `QUESTIONNAIRE`.
3. In the Anthropic Console, create a dedicated API key for the study with a low spending limit. Delete it after the final session.

## For each session (researcher)
1. Open the hosted page.
2. Enter the participant ID and API key, select "Test key and connection", then select "Start session".
3. Follow the fixed order: Part 1 is the baseline chat without a system prompt. Participants upload their thesis or paste text, then complete the questionnaire. Part 2 starts a new chat with your prompt; the thesis is uploaded or pasted again, so the AI has no knowledge of Part 1. After its questionnaire, participants contact the researcher before continuing to Part 3 (pair discussion), followed by the final questionnaire. The timer is a suggested duration; participants end each part using "End part".
4. At the end, the log is automatically downloaded as a JSON file to the Downloads folder. Check it, then select "Delete all local data on this device".

## What is recorded
Chat interactions from Parts 1 and 2; generated questions and their passages; question statuses, dismissal reasons, and notes; changes made during the pair discussion; timestamps; model and prompt version; and token usage. The API key is never recorded.

Thesis text is included in the exported log only when the option is selected during setup. Otherwise, uploaded attachments include only the filename and character count; the text is omitted.

## Security
The API key is held in memory only and is never stored in the log. It is cleared when the tab is closed or reloaded. After a reload, a session can be resumed by entering the key again; session state is stored in `localStorage`.

## PDF uploads
An internet connection is required to load pdf.js from cdnjs.