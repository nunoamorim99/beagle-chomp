# Beagle Chomp

The Beagle Chomp logo is the game's beagle wearing the game's own interface: one ink outline around everything and a hard shelf underneath it, the same "toon board" construction every button and panel in the game uses. A logo built that way looks cut from the same material as the screens it sits on.

## The idea in one line

A happy beagle with the power **bone** in its mouth, next to a title whose **o** is a **biscuit** with a bite taken out and crumbs flying off. The two things you collect in the maze, both in the logo, both already being eaten.

## The parts

- **The face.** The beagle from the original game icon, rebuilt as a flat-colour vector: fur, ears, blaze, eyes, nose, bone, tongue, each one cel colour (`fur`, `ear`, `muzzle`, `coral`, `nose`). No airbrushing, no gradients, which is what lets it scale from 2048px down to a 16px tab icon and go one-colour.
- **The lettering.** "Beagle" over "Chomp" in Baloo 2 ExtraBold, the game's own display face, outlined to paths. "Beagle" is `cream`, "Chomp" is `amber`, each with a hard lower shade band (`biscuit`, `amber-shade`). Letters tilt very slightly in alternation so the word bounces without losing legibility.
- **The biscuit o.** A docked biscuit (`biscuit`, holes in `amber-shade`) with a two-tooth bite out of its upper right. The crumbs fly into the open sky of each layout and are part of the mark: never move them or delete them.
- **Ink and shelf.** One `ink` outline wraps the whole title; the shelf is that outline dropped straight down, never a soft shadow. This is what keeps the logo readable on sky, bark, hedge, amber and white alike.

## Lockups and when to use them

| Version | File | Use it for | Minimum |
| --- | --- | --- | --- |
| Horizontal title | `beagle-chomp-title-horizontal.svg` | Menu header, store and social banners, the README | `min-title-horizontal` (200px wide) |
| Stacked title | `beagle-chomp-title-stacked.svg` | Splash / loading screen, square posts, merch | `min-title-stacked` (140px wide) |
| Face | `beagle-chomp-face.svg` | Avatar, app icon art, stickers, anywhere the name is already on screen | `min-face-colour` (32px) |
| Face, no shelf | `beagle-chomp-face-flat.svg` | Favicon art and tight UI slots where the shelf would read as a smudge | 16px |
| Wordmark only | `beagle-chomp-wordmark.svg` | Where the face already appears nearby (e.g. under the app icon) | 140px wide |
| One-colour, ink | `*-ink.svg` | Single-ink print, engraving, embossing, light grounds | `min-face-onecolour` (48px) for the face |
| One-colour, white | `*-white.svg` | Dark grounds, photo overlays, the notification badge | same |

## Clear space

Measure **x = the height of the biscuit o**. Keep at least **x** clear on every side of a title, measured from the outside of the ink outline (the shelf counts as part of the logo). Around the face alone, keep a quarter of the face's width. Crumbs sit inside the logo's own clear space; do not let other elements cross them.

## Colour

Every colour is either already a game token (`ink`, `cream`, `biscuit`, `amber`, `amber-shade`) or sampled from the face artwork (`fur`, `ear`, `ear-shade`, `muzzle`, `muzzle-shade`, `coral`, `nose`). Nothing new was invented for the logo. Grounds it is tested on: `ground-sky`, `ground-bark`, `ground-hedge`, `amber` and white.

The full-colour logo carries its own `ink` outline, so it never needs a box, a plate or a drop shadow behind it. On a photograph, use it as is or switch to the white one-colour version.

## Icons

The app icon is the face on an `amber` tile with a soft `amber-lit` disc behind it.

- `icon-512.png`, `icon-192.png`: rounded tile (`icon-tile` radius) for the manifest's "any" purpose and the `<link rel="icon">`.
- `icon-512-maskable.png`: full-bleed tile, the face held inside the central 80% safe circle so any OS mask keeps the ears.
- `favicon-180.png`: apple-touch icon, opaque and square (iOS rounds it).
- `favicon.svg`, `favicon-32.png`, `favicon-16.png`, `favicon.ico`: the face alone on transparent; its ink outline keeps it legible on light and dark tab bars.
- `badge-96-face.png` (optional): an Android status-bar badge. Android paints only the alpha channel white, so this is a solid head silhouette with the eyes and nose punched out.

## Do

- Use the supplied files. The lettering is already outlined; no font install needed.
- Put the full-colour logo straight on the ground, with its outline doing the separation.
- Switch to the face alone below the title's minimum width.

## Don't

- Recolour the face or the lettering, or swap "Beagle" and "Chomp" colours.
- Remove, thin or recolour the ink outline or the shelf, or add a soft drop shadow.
- Replace the biscuit o with a plain o, close its bite, or move the crumbs.
- Stretch, skew, rotate or re-space the letters.
- Rebuild the logo from the font; the bounce and the custom o are in the paths.
- Use the old neon-blue maze icon, or put the face in a different frame or badge.

## Using it in the game repo

The icon files are drop-in replacements with the repo's existing names: `public/favicon-32.png`, `public/favicon-180.png`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-512-maskable.png`, `assets/icon-source-2048.png`. Optionally add `public/favicon.svg` with `<link rel="icon" type="image/svg+xml" href="./favicon.svg">` ahead of the PNG. The manifest's `theme_color` and `background_color` can stay as they are.

## Notes

- The face is a faithful trace of the original game icon's artwork, so it carries that art's provenance. Run a professional trademark search before registering the mark.
- Baloo 2 is licensed under the SIL Open Font License, which permits use in a logo.
