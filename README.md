# Reflection Study - Local Web App

## Before the study (one-time setup)
1. Open `config.js` and replace the placeholder in `PROMPT_TEXT` with your system prompt.
2. Optionally add questionnaire links under `QUESTIONNAIRE`.
3. Create a Mammouth API key and confirm that your account has access to the `deepseek-v4.1-flash` model. OpenAlex searches require no key. Delete the Mammouth key after the final session.

## For each session (researcher)
1. Open the hosted page.
2. Enter the participant ID and Mammouth API key, select "Test key and connection", then select "Start session".
3. Follow the fixed order: Part 1 is the baseline chat without a system prompt. Participants upload their thesis or paste text, then complete the questionnaire. Part 2 starts a new chat with your prompt; the thesis is uploaded or pasted again, so the AI has no knowledge of Part 1. After its questionnaire, participants contact the researcher before continuing to Part 3 (pair discussion). Part 3 has no questionnaire. The timer is a suggested duration; participants end each part using "End part".
4. At the end, the log is automatically downloaded as a JSON file to the Downloads folder. Check it, then select "Delete all local data on this device".

## What is recorded
Chat interactions from Parts 1 and 2; generated questions and their passages; question statuses, dismissal reasons, and notes; changes made during the pair discussion; timestamps; model and prompt version; and token usage. The API key is never recorded.

Thesis text is included in the exported log only when the option is selected during setup. Otherwise, uploaded attachments include only the filename, character count, and visual media type; the text is omitted. Original PDF and image bytes are never included in the export.

In Part 2, DeepSeek can call the app's `search_openalex` function to search OpenAlex for published academic works. The app returns publication metadata and indexed abstracts, then sends those results back to DeepSeek for comparison. Full papers are not fetched; responses must distinguish abstract-only information from metadata-only records. Search calls and returned citations are included in the exported chat log. Searches are limited to four per response and five works per query.

## Security
The API key is held in memory only and is never stored in the log. It is cleared when the tab is closed or reloaded. After a reload, a session can be resumed by entering the key again; session state is stored in `localStorage`. Original visual files are stored in browser `IndexedDB` so they can be sent again when resuming; "Delete all local data on this device" clears both stores.

## PDF uploads
An internet connection is required to load pdf.js from cdnjs and OpenAlex search. PDF text is extracted in the browser and sent as text. JPEG, PNG, GIF, and WebP images can also be uploaded; image files are sent as image content when supported by the selected model. The total visual file size is limited to 18 MB per chat.