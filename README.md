# Resident Olympics

A live quiz game for cardiac surgery residents: a question with an image and multiple-choice answers on the big screen, a countdown, and an automatic scoreboard.

There are two editions. Both use the same quiz file format, so questions written in one can be imported into the other.

| | Phone edition (this website) | Moderator edition (Claude artifact) |
|---|---|---|
| How residents answer | On their own phones, after scanning a QR code. No account needed. | Cards or voice. A moderator taps each team's answer. |
| Needs | A free Firebase project and GitHub Pages | Nothing beyond the organizer's Claude account |
| Best for | Any number of individuals or teams | Up to about a dozen teams |
| Where | `index.html` (players), `host.html` (organizer) | `artifact/resident-olympics.html`, published at https://claude.ai/artifact/MxUkF5LjoAjY3Noo4tUPsr |

## Phone edition

### Try it now (demo mode)

Until Firebase is connected the site runs in demo mode, which works between tabs of one browser. Serve the folder (`python3 -m http.server`), open `host.html`, load the sample questions, open the lobby, then open the join link in a few more tabs.

### Go live (about 10 minutes, once)

1. **Create a Firebase project.** Go to https://console.firebase.google.com, add a project (Google Analytics is not needed).
2. **Turn on anonymous sign-in.** Build → Authentication → Get started → Sign-in method → Anonymous → Enable.
3. **Create the database.** Build → Firestore Database → Create database → Production mode. Pick a nearby region (for the Gulf, `me-central1` Doha or `me-central2` Dammam).
4. **Set the rules.** Firestore → Rules. Replace everything with the contents of [`firestore.rules`](firestore.rules) and publish.
5. **Connect the site.** Project settings (gear icon) → Your apps → Web (`</>`) → register an app → copy the `firebaseConfig` values into [`config.js`](config.js) as `window.RO_FIREBASE_CONFIG = { ... };`. These values are public identifiers, safe to commit.
6. **Publish the site.** In this GitHub repository: Settings → Pages → Deploy from a branch → choose the branch and `/ (root)`. The site appears at `https://<your-username>.github.io/Resident-Olympics/`.
7. **If the site reports it could not connect,** add `<your-username>.github.io` under Firebase → Authentication → Settings → Authorized domains, and check that `config.js` was saved and pushed.

The organizer opens `…/Resident-Olympics/host.html`. Players get the address from the QR code in the lobby.

### Running a game

1. **Questions tab.** Add questions, each with an optional image, two to five choices, a time limit and a point value. Questions are stored in the browser on that device. Use **Export file** to back them up and **Import file** to load them on the laptop you will present from.
2. **Run a game tab.** Choose the scoring and, if you want teams, list them. Open the lobby.
3. **Lobby.** Put the host screen on the projector. Residents scan the code, enter a name and pick a team.
4. **Each question.** The clock runs and stops by itself; **Stop the clock** ends it early. Then **Reveal answer**, **Scoreboard**, **Next question**.
5. **Final result.** A podium, the full ranking, and **Download results** for a spreadsheet file.

If the host laptop or a phone reloads mid-game, it picks up where it left off.

### Scoring

- **Correct plus speed:** a correct answer earns 1,000 points at the start of the clock, sliding to 500 at the buzzer, times the question's point value.
- **Correct answers only:** a correct answer earns the question's point value. Ties go to whoever spent less time on their correct answers.
- **Teams:** every resident answers on their own phone; a team's score is the average of its members, so team size does not decide the result. For one device per team, leave the team list empty and have each team join under its team name.

### Good to know before the day

- The correct answer is never sent to phones until the host reveals it, and the database rules stop anyone answering twice, late, or for someone else.
- Firebase's free plan is enough for one conference game. Each question image is sent to every phone, so keep images to what the question needs.
- Rehearse once on the venue Wi-Fi with a few phones. Phones on mobile data work too.
- Anyone who has the host address could open their own separate game, but cannot touch yours: a game belongs to the browser that opened it.

## Moderator edition

Open the artifact, go to **Setup**, enter the teams and questions (or import a quiz file), then run it from **Stage**. During each question a keypad under the question lets the moderator tap each team's answer; tapping the same letter again clears it. With "Correct plus speed", tap answers in the order teams lock in: the first correct team earns 1,000 and the last 500.

The game is saved with the artifact, so the organizer can open it on a second device (a tablet at the moderator's desk) and both stay in step. People the artifact is shared with can watch the stage but cannot change anything.

## Quiz file format

```json
{
  "format": "resident-olympics-quiz",
  "version": 1,
  "title": "Resident Olympics",
  "questions": [
    {
      "text": "Which conduit has the best long-term patency when grafted to the LAD?",
      "image": "",
      "options": ["Radial artery", "Left internal thoracic artery", "Great saphenous vein"],
      "correct": 1,
      "seconds": 20,
      "points": 1,
      "explanation": "Shown with the answer."
    }
  ]
}
```

`correct` counts from 0. `image` is a `data:` URL; the editors create it when you choose a picture.

## Files

- `index.html`, `js/player.js` — what residents see
- `host.html`, `js/host.js` — question editor and big-screen stage
- `js/backend.js` — live connection (Firebase) and demo mode
- `js/common.js` — quiz format, image shrinking, scoring
- `firestore.rules` — who may read and write what
- `vendor/` — Firebase SDK 10.14.1 and qrcode-generator 1.4.4, bundled so the site has no other dependencies
- `artifact/resident-olympics.html` — source of the moderator edition
