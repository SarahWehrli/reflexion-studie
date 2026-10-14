// ===== Einstellungen der Studie – hier anpassen, nicht in app.js =====
window.CONFIG = {
  MODEL: "claude-sonnet-5-5",   // Modell-ID (wird im Log festgehalten)
  PHASE_MINUTES: 20,            // Richtzeit pro Chat-Teil (weicher Timer, kein Zwangsende)
  PROMPT_VERSION: "v1",         // bei jeder Prompt-Änderung hochzählen
  MAX_TOKENS_CHAT: 1500,
  MAX_TOKENS_GENERATE: 4000,

  // Links zu den Fragebögen (pro Teil). Leer lassen = kein Button.
  QUESTIONNAIRE: {
    after_baseline: "",
    after_prompt: "",
    after_pair: ""
  },

  // Baseline: realistischer, einfacher Prompt (so würden Studierende ohnehin eine KI nutzen).
  BASELINE_PROMPT:
`Du bist ein hilfreicher Assistent. Die Person möchte mit dir über ihre eigene Arbeit reflektieren (Entscheidungen, Interpretationen, Annahmen im Forschungsprozess). Antworte auf Deutsch, es sei denn, die Person schreibt in einer anderen Sprache.`,

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
