# Reflection Study - Local Web App

## Before the study (one-time setup)
1. Open `config.js` and replace the placeholder in `PROMPT_TEXT` with your system prompt.
2. Optionally add questionnaire links under `QUESTIONNAIRE`.
3. Create a Mammouth API key and confirm that your account has access to the `claude-sonnet-5-5` model. OpenAlex searches require no key. Delete the Mammouth key after the final session.

## For each session (researcher)
1. Open the hosted page.
2. Enter the participant ID and Mammouth API key, select "Test key and connection", then select "Start session".
3. Follow the fixed order: Part 1 is the baseline chat without a system prompt. Participants upload their thesis or paste text, then complete the questionnaire. Part 2 starts a new chat with your prompt; the thesis is uploaded or pasted again, so the AI has no knowledge of Part 1. After its questionnaire, participants contact the researcher before continuing to Part 3 (pair discussion). Part 3 has no questionnaire. The timer is a suggested duration; participants end each part using "End part".
4. At the end, the log is automatically downloaded as a JSON file to the Downloads folder. Check it, then select "Delete all local data on this device".

## What is recorded
Chat interactions from Parts 1 and 2; generated questions and their passages; question statuses, dismissal reasons, and notes; changes made during the pair discussion; timestamps; and token usage. All sessions use the same model (`claude-sonnet-5-5`). The API key is never recorded.

Thesis text is included in the exported log only when the option is selected during setup. Otherwise, uploaded attachments include only the filename, character count, and image media type; the text is omitted. Original PDF and image bytes are never included in the export.

Both parts have the same search so that the system prompt is the only difference. Part 1 has no instructions about searching; in Part 2 the prompt restricts searching to Focus 2 (comparable studies). With `WEB_SEARCH.provider: "web"` (default), the app requests Mammouth's standard web search (`web_search_options`); cited URLs returned by the API are included in the exported chat log. With `"openalex"`, Claude instead calls the app's `search_openalex` function, which returns OpenAlex metadata and indexed abstracts (no full papers; at most four searches per response and five works per query).

## Security
The API key is held in memory only and is never stored in the log. It is cleared when the tab is closed or reloaded. After a reload, a session can be resumed by entering the key again; session state is stored in `localStorage`. Uploaded images are stored in browser `IndexedDB` so they can be sent again when resuming; "Delete all local data on this device" clears both stores.

## PDF uploads
An internet connection is required to load pdf.js from cdnjs and OpenAlex search. Only the text of a PDF is extracted in the browser and sent as text; figures and layout are not included, and the PDF file itself is neither stored nor sent. JPEG, PNG, GIF, and WebP images can also be uploaded; image files are sent as image content when supported by the selected model. The total image size is limited to 18 MB per chat.