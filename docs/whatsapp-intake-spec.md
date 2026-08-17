# WhatsApp Intake — Deep Spec (approved by Moshe 2026-08-18)

No WhatsApp Business API, no Meta, ever (explicitly rejected). Everything
flows through Lin pasting/forwarding content herself; the system NEVER sends
anything — every outgoing message leaves only from Lin's own finger.

## A. Inputs
Single message, a WHOLE pasted conversation (with mid-thread corrections),
a screenshot of the chat (vision), a voice note (transcription infra exists
in server/telegram/transcribe-voice.js), or any mix. Any language.

## B. Understanding
Reads the conversation as a sequence: later corrections override earlier
statements ("actually no salads"). Extracts dishes, quantities, date, time,
hotel. Iron rule: never invents — prices only from the catalog, dishes only
from the menu; anything uncertain is surfaced, not guessed.

## C. Lin's review screen
The built order shown in three confidence colors: green (certain), yellow
(interpreted, worth checking — "wrote 'fish', I picked Moroccan fillet"),
red (missing — no time, no hotel). Approve-all in one tap or fix per item.
(The existing AI manager-review panel in the order editor is the seed.)

## D. Drafted reply
After approval the system drafts a reply in the CUSTOMER's language: order
summary, price, and the missing details phrased as polite questions. Lin
copies and sends from her own WhatsApp. Tone is defined once with Lin and
stored (voice/style file) so replies sound like her.

## E. Follow-up changes — the heart
Tourist writes two days later: "add 2 challahs and change to 15:00". Lin
pastes the follow-up ONTO THE EXISTING ORDER; the system proposes only the
delta ("add 2 challahs (+$20), time → 15:00") for one-tap approval; the
price updates.

## F. Phone-only via Mey
Lin forwards the message to Mey in Telegram. Mey runs the same pipeline and
returns: summary + ready-to-copy reply + a link to the order. No computer.

## G. Groups
"We are 4 families at the same hotel" → detected, offers to open 4 linked
orders under one group.

## H. Memory
The original conversation is stored attached to the order (audit/reference).
A known phone number auto-fills name and hotel from the previous visit.

## I. Boundaries
The system never sends anything by itself. Prices/dishes only from catalog.
Uncertainty is always surfaced to Lin, never silently resolved.
