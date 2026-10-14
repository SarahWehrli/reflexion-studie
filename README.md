# Reflexions-Studie – lokale Web-App

## Vor der Studie (einmalig)
1. `config.js` öffnen und bei `PROMPT_TEXT` deinen System Prompt einfügen (Platzhalter ersetzen).
   `PROMPT_VERSION` hochzählen, wenn du den Prompt änderst.
2. Optional: Fragebogen-Links bei `QUESTIONNAIRE` eintragen.
3. Im Claude Console einen **eigenen Key nur für die Studie** anlegen, mit tiefem Ausgabenlimit. Nach der letzten Session löschen.
4. Pilot: eine komplette Session mit einer echten Arbeit durchspielen, Kosten im Console ablesen.

## Pro Session (Versuchsleitung)
1. `index.html` per Doppelklick im Browser öffnen (Chrome empfohlen).
   Tipp: ID und Reihenfolge per Link vorbelegen: `index.html?id=P03&pair=Paar2&order=BA`
2. ID, Reihenfolge (AB/BA, gegenbalancieren!), API-Key eintippen, Arbeit einfügen oder laden (.txt/.md/.pdf).
   «Key & Verbindung testen», dann «Session starten».
3. Ablauf: Teil 1 → Fragebogen → Teil 2 → Fragebogen → Teil 3 (Paar) → Fragebogen → Ende.
   Der Timer ist eine Richtzeit; Teile werden über «Teil beenden» abgeschlossen.
4. Am Ende **«Log exportieren (JSON)»**, dann **«Alle lokalen Daten löschen»**.

## Was geloggt wird
Chatverläufe beider Teile, alle Fragen mit Textstelle, Status (besprochen / später / verworfen),
Verwerfungsgrund und Notiz, Änderungen im Paar-Teil (mit ursprünglichem Status), «im Gespräch aufgegriffen»,
Zeitstempel, Modell, Prompt-Version, Token-Verbrauch. **Nicht geloggt:** der API-Key.
Die Arbeit selbst nur, wenn im Setup angehakt (sonst nur Länge + Hash).
Das Gespräch im Paar-Teil wird nicht erfasst → separat aufnehmen (Einwilligung!) oder protokollieren.

## Sicherheit
Der Key wird nur im Arbeitsspeicher gehalten (weg beim Schliessen/Neuladen des Tabs) und nie in der ZIP gespeichert.
Bei einem Neuladen kann die Session mit erneuter Key-Eingabe fortgesetzt werden (Zustand liegt im localStorage).

## Falls die API-Anfrage blockiert wird
Manche Browser blockieren Anfragen von `file://`-Seiten. Dann im Ordner einen lokalen Server starten:
`python3 -m http.server 8000` und `http://localhost:8000` öffnen.

## PDF-Upload
Braucht Internet (lädt pdf.js von cdnjs). Text immer kurz auf Vollständigkeit prüfen –
Spalten, Fussnoten und Tabellen werden oft unsauber extrahiert. Im Zweifel Text einfügen.
