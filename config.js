// ===== Einstellungen der Studie – hier anpassen, nicht in app.js =====
window.CONFIG = {
  MODEL: "claude-sonnet-5-5",   // Modell-ID (wird im Log festgehalten)
  PHASE_MINUTES: 20,            // Richtzeit pro Chat-Teil (weicher Timer, kein Zwangsende)
  PROMPT_VERSION: "v1",         // bei jeder Prompt-Änderung hochzählen
  EFFORT: "medium",             // low | medium | high – gilt für beide Teile gleich
  THINKING: null,               // null = Standard (adaptives Denken). "between_tools" = ohne Vorab-Denken (schneller)
  // max_tokens zählt Denken + Antwort zusammen. Zu tief = leere Antworten.
  MAX_TOKENS_CHAT: 16000,
  MAX_TOKENS_GENERATE: 32000,

  // Websuche (Server-Tool der API, kostet zusätzlich ca. $10 pro 1000 Suchen)
  WEB_SEARCH: {
    prompt: true,               // Teil 2: dein Prompt nutzt Websuche für Vergleichsstudien
    baseline: false,            // Teil 1: auf true setzen, wenn Studierende auch dort Websuche haben sollen
    type: "web_search_20250305",
    max_uses: 5
  },

  // Links zu den Fragebögen (pro Teil). Leer lassen = kein Button.
  QUESTIONNAIRE: {
    after_baseline: "",
    after_prompt: "",
    after_pair: ""
  },

  // Teil 1 (Baseline): kein System Prompt, eigener Chat. Studierende laden ihre Arbeit selbst hoch oder fügen sie ein.
  // Teil 2 (Prompt): neuer Chat ohne Wissen aus Teil 1. Arbeit wird zu Beginn erneut hochgeladen/eingefügt.

  // >>> HIER DEINEN SYSTEM PROMPT EINFÜGEN <<<
  PROMPT_TEXT:
`PLATZHALTER – ersetze diesen Text durch deinen System Prompt.
Du hilfst Studierenden, über ihre Arbeit zu reflektieren. Stelle Fragen zu Konsequenzen konkreter Entscheidungen und zu unhinterfragten Annahmen. Antworte auf Deutsch.`,

  // Technischer Zusatz, den die App ans Ende deines Prompts hängt, damit die Stellen markiert werden können.
  GENERATE_INSTRUCTION:
`AUSGABEFORMAT (technische Vorgabe der App): Gib ausschliesslich ein JSON-Array zurück, ohne Text davor oder danach und ohne Codeblock. Jedes Element hat die Form:
{"passage": "<wörtliches, unverändertes Zitat aus der Arbeit, maximal 300 Zeichen>", "question": "<deine Reflexionsfrage an die Person>", "type": "<ein Stichwort, worauf die Frage zielt, z. B. consequence, alternative, assumption>"}
Das Zitat muss exakt so im Text der Arbeit vorkommen. Gib 5 bis 8 Elemente zurück, verteilt über verschiedene Stellen der Arbeit.`,

  // Zusatz für den freien Chat im Prompt-Teil (kein JSON).
  CHAT_INSTRUCTION:
`Im Chat antwortest du in normalem Text (kein JSON). Halte dich an die oben beschriebene Rolle. Wenn die Person eine deiner Fragen vertiefen möchte, geh darauf ein, ohne sofort die Antwort vorwegzunehmen.`
};