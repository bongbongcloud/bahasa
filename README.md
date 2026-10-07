# Belajar Bahasa

A 5-minute-a-day Bahasa Indonesia trainer with a Saturday check-in. Plain HTML/JS, hosted on GitHub Pages, works offline, optional Google sign-in via Firebase.

Live: https://bongbongcloud.github.io/bahasa/

## How the weekly loop works

1. **Daily (≈5 min):** open the app → **Mulai**. You get your due reviews plus up to 5 new words. Words you miss come back sooner; words you know fade out (spaced repetition).
2. **Saturday:** **Check-in** tab → about 15 questions, no hints. Score 70% to unlock the next week.
3. **Report:** tap **Copy report** (or Share) and paste it into the Bahasa chat with Claude.
4. **Next week:** Claude replies with `weekNN.json`. Add it to `data/`, list it in `data/index.json`, commit. The app picks it up next time you open it.

## Deploy on GitHub Pages

1. Upload everything in this folder to the root of the `bahasa` repo (keep the folder structure).
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
3. After a minute it's live at `https://bongbongcloud.github.io/bahasa/`.
4. On your phone, open that link in Safari (iPhone) or Chrome (Android) → **Share → Add to Home Screen**. It then opens like an app and works offline.

## Turn on Google sign-in + sync (optional)

Without this, progress is saved on your phone only (use *Settings → Download backup* now and then).

1. Go to https://console.firebase.google.com → **Add project** → name it `belajar-bahasa` (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** → Save.
3. **Authentication → Settings → Authorized domains → Add domain:** `bongbongcloud.github.io`
4. **Build → Firestore Database → Create database** → Production mode → region `asia-southeast1` (Singapore).
5. Firestore → **Rules** tab, replace with this and **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
6. **Project settings (gear) → General → Your apps → Web (`</>`)** → register app → copy the `firebaseConfig` object.
7. Paste it into `js/firebase-config.js` (replace `null`), commit.
8. In the app: **Atur (Settings) → Sign in with Google.**

The Firebase web config is safe to commit publicly — access is controlled by the rules in step 5.

## Audio

Audio uses your phone's built-in text-to-speech. If **Settings → Audio** says no Indonesian voice was found:
- **iPhone:** Settings → Accessibility → Spoken Content → Voices → Indonesian → download *Damayanti*.
- **Android:** Settings → Google → text-to-speech → install Indonesian.

Every word also shows a written pronunciation hint (e.g. *enam → uh-NAHM*; capitals = light stress).

## Week pack format (`data/weekNN.json`)

```json
{
  "week": 2,
  "stage": 1,
  "title": "Short title",
  "focus": "One sentence shown on the home screen.",
  "lesson": {
    "title": "Week 2 · ...",
    "sections": [ { "h": "Heading", "p": ["Paragraph", "..."], "list": ["Bullet", "..."] } ]
  },
  "items": [
    {
      "key": "w2-unique-id",
      "text": "Indonesian word or phrase",
      "en": "English meaning",
      "pron": "English-style pronunciation, CAPS = light stress",
      "tags": ["greetings | politeness | introductions | survival | address | faith | trap | numbers | ..."],
      "register": "neutral | formal | casual",
      "note": "optional tip",
      "malay": "optional — the Malay word to avoid (makes it a Malay-trap item)",
      "accept": ["optional", "extra accepted typed answers"]
    }
  ]
}
```

Then add the file name to `data/index.json`:

```json
{ "packs": ["week01.json", "week02.json"] }
```

Keys must be unique across all weeks and must never change once you've studied them (your progress is stored by key). Aim for 25–40 items a week at 5 new words/day.

## Stages

| Stage | Name | Focus |
|---|---|---|
| 1 | Bertahan · Survival | greetings, numbers, polite address, food, transport, negation |
| 2 | Sehari-hari · Everyday | time, shopping, directions, *ber-* and *me-* verbs, church vocabulary |
| 3 | Bercakap · Conversational | casual speech, particles, *di-* passive, short prayers, testimony |
| 4 | Percaya diri · Confident | storytelling, *ke-an/per-an*, Bible reading, real-speed listening |

## Files

```
index.html               app shell + bottom nav
css/style.css            styles (light + dark)
js/app.js                app logic: sessions, spaced repetition, quizzes, check-in, report
js/sync.js               optional Firebase Google sign-in + Firestore sync
js/firebase-config.js    paste your Firebase config here
data/index.json          list of week packs
data/week01.json         Week 1 content
sw.js                    offline cache
manifest.webmanifest     home-screen app settings
icons/                   app icons
```
