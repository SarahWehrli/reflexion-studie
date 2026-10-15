# Reflexions-Studie – lokale Web-App

## Vor der Studie (einmalig)
1. `config.js` öffnen und bei `PROMPT_TEXT` deinen System Prompt einfügen (Platzhalter ersetzen).
2. Optional: Fragebogen-Links bei `QUESTIONNAIRE` eintragen.
3. Im Claude Console einen **eigenen Key nur für die Studie** anlegen, mit tiefem Ausgabenlimit. Nach der letzten Session löschen.

## Pro Session (Versuchsleitung)
1. github Seite öffnen
2. ID und API-Key eintippen, «Key & Verbindung testen», dann «Session starten».
3. Ablauf (feste Reihenfolge): Teil 1 = Baseline: eigener Chat ohne System Prompt, Studierende laden ihre Arbeit
   selbst hoch (📎) oder fügen Text ein → Fragebogen → Teil 2 = neuer Chat mit deinem Prompt, Arbeit wird zu Beginn
   erneut hochgeladen/eingefügt (die KI weiss nichts aus Teil 1) → Fragebogen → Teil 3 (Paar) → Fragebogen → Ende.
   Der Timer ist eine Richtzeit; Teile werden über «Teil beenden» abgeschlossen.
4. Am Ende wird das Log **automatisch** als JSON in den Downloads-Ordner gespeichert. Prüfen, dann **«Alle lokalen Daten löschen»**.

## Was geloggt wird
Chatverläufe beider Teile, alle Fragen mit Textstelle, Status (besprochen / später / verworfen),
Verwerfungsgrund und Notiz, Änderungen im Paar-Teil (mit ursprünglichem Status), «im Gespräch aufgegriffen»,
Zeitstempel, Modell, Prompt-Version, Token-Verbrauch. **Nicht geloggt:** der API-Key.
Die Arbeit selbst nur, wenn im Setup angehakt (sonst nur Länge + Hash).

## Sicherheit
Der Key wird nur im Arbeitsspeicher gehalten (weg beim Schliessen/Neuladen des Tabs) und nie in der ZIP gespeichert.
Bei einem Neuladen kann die Session mit erneuter Key-Eingabe fortgesetzt werden (Zustand liegt im localStorage).

## PDF-Upload
Braucht Internet (lädt pdf.js von cdnjs). 