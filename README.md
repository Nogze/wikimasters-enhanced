# Wikimasters Enhanced

An unofficial browser extension that replaces the interface of [wiki-masters.com](https://www.wiki-masters.com) with a new one: 3D pack openings, a card collection, market (with last-second bids), trades, friends, messages, guild, battles, achievements and leaderboard.

Only pack openings use 3D: everywhere else the cards are flat images that appear instantly, with a lift on hover, a foil shine on shiny cards and a glow on UR and L cards. Screens keep their last content and refresh in the background, so coming back to one never waits on "Chargement…".

You play with your own wiki-masters account, on their servers. The extension talks to no one else: card images come from Wikimedia, and wiki-masters' anti-bot check from Cloudflare, as on their site.

Works in Chrome, Edge, Brave and other Chromium browsers.

## Install

1. Get the extension folder, either:
   - from [Releases](https://github.com/Nogze/wikimasters-enhanced/releases/latest): download the zip and unzip it into a folder you'll keep (the browser loads the extension from there), or
   - by building it (needs [Node.js](https://nodejs.org) 20.19 or later):
     ```
     git clone https://github.com/Nogze/wikimasters-enhanced.git
     cd wikimasters-enhanced
     npm install
     npm run build
     ```
     The extension is then in the `dist` folder.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped release folder, or `dist` if you built it (not `extension`, which only holds part of the sources).
4. Go to [www.wiki-masters.com](https://www.wiki-masters.com) and sign in as usual: the new interface replaces theirs.

To update, replace the folder's contents with the new version (or `git pull && npm run build`), then click the reload icon on the extension's card in `chrome://extensions`.

## Back to the official site

**Réglages → Site officiel wiki-masters → Afficher** switches back to wiki-masters' own interface. A **▶ Wikimasters Enhanced** button on their pages switches the new one on again. Sign-in and legal pages always stay official.
