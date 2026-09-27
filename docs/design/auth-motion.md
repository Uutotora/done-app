# Authentication and motion

The welcome, sign-in, workspace setup, invitation and password recovery screens share one centered shell. Email is the first step. On a fresh instance it leads to owner registration; after setup it leads to sign-in. New teammates follow an email-bound invitation and never create another workspace. The demo opens directly into sample data, without another onboarding form.

Invitations are previewed via POST /api/auth/invitation with the token in the body. The server supplies the email, team, inviter, role and expiry. Query-string email is not trusted. Expired, consumed and revoked links share a recovery screen. Existing SMTP delivery and manual invitation links are preserved; automatic mail requires SMTP and a public URL configured by the administrator.

## Visual direction

Original editorial ink illustration inspired by the visual language in the user's references: [motion illustrations](https://dribbble.com/shots/23181554-Motion-illustrations-for-Notion), [Notion illustrations](https://dribbble.com/shots/23620415-Notion-illustrations), and a water treatment initially inspired by [21st.dev](https://21st.dev/). No third-party illustration was copied or imported. Done is the product name; the interface does not claim official affiliation.

Final asset: `public/illustrations/team-wave-24.png`. Created with the built-in imagegen tool from the initial four-drawing concept. The final sheet contains 24 original drawings in a 6×4 grid, played continuously with CSS step-end over 2 seconds (12 drawings per second). All 24 cells are observed in the browser playback test. There are no pause buttons or material selectors: the heading always uses the water treatment, as requested. System reduced-motion preferences still disable decorative movement. The welcome scene is 320px on a desktop, 240px on a short laptop, and 260px on mobile. Registration, login, invitations and recovery use a separate composition without people: four floating stationery illustrations on the sides, or a compact notebook and paper plane above the form on narrow screens. The corner wordmark is replaced by the existing D logo. Dark mode inverts the ink scene.

The greeting now follows the user's supplied `VerticalCutReveal` reference: uppercase blue type, full-color emoji inside three left-aligned lines, and staggered vertical spring reveals in alternating directions. `src/components/ui/vertical-cut-reveal.tsx` uses the existing `motion/react` dependency, keeps emoji graphemes intact, and immediately reveals text when reduced motion is enabled. DONE retains the water effect. The accessible heading remains one readable phrase; decorative letter splits are hidden from assistive technology.

Only email, name and workspace drafts persist in sessionStorage; passwords and invitation tokens do not. Clear drafts on successful account entry. Account data and membership continue using the existing server/session model.

## Stationery illustrations

Asset: `public/illustrations/floating-stationery.png`, generated with the built-in imagegen tool. Four isolated ink objects in a 2×2 atlas. The notebook, plane, notes and binder clip float independently using 9–12-second transform animations; the form remains unobstructed. At widths up to 980px the notebook and plane move above the form. No people appear on the account forms.

```text
Use case: illustration-story. Production asset atlas for the sides of an elegant productivity app's registration form.
Draw four ORIGINAL editorial ink illustrations in a strict 2 by 2 square sprite atlas. Each object occupies its own identical square quadrant, centered with generous 18 percent white margins, fully isolated from the other objects. No grid, no borders, no words, no labels. Pure white background.
Top left quadrant: an open notebook floating in the air, three-quarter view, elegant curving white pages, substantial black hard cover, a loose curved page lifting upward, a tiny muted yellow bookmark ribbon. Few abstract handwritten black lines, NO legible text.
Top right quadrant: a delightful folded white paper airplane pointing upward-right, a curling flight-path ink flourish behind it, two tiny four-point stars one yellow, black expressive uneven outlines, substantial folded wing contrast.
Bottom left quadrant: three scattered paper note cards, offset at slightly different angles, a bold black pencil hovering diagonally across them, one simple ink doodle circle and abstract lines, one muted pale-blue tab.
Bottom right quadrant: a large elegant black binder clip holding a curling loop of white paper, playful impossible gravity, one tiny yellow spark.
Style: confident thick-and-thin black ink drawing, refined whimsical Notion-inspired editorial illustration, large clean black fills and white paper, tiny restrained yellow and pale-blue accents. No people, no faces, no hands, no 3D render, no gray shadows, no gradients, no scenery. Vector-like crisp craft but organic hand-drawn curves. This is a clean asset sheet, NOT an interface mockup. Exactly four distinct centered objects in four equal square cells.
```

## Initial concept prompt

```text
Use case: illustration-story.
Asset: production animation sprite sheet for a refined productivity app's welcome and account screens.
Create an ORIGINAL black-and-white editorial ink illustration, the friendly hand-drawn visual language of Notion-style illustrations, not a reproduction of any existing illustration.
Format: EXACT 2 by 2 grid of FOUR equal square animation cells on a square white canvas. No borders, no gutters, no text, no lettering. Every cell contains the SAME entire small scene centered at the EXACT SAME scale and position, generous empty margins 12 percent on every side, all objects fully inside each cell.
Scene: two friendly creative teammates, waist-up behind a small table. Left person with round glasses and solid black short hair wearing a white shirt. Right person with black bob hair wearing a solid black sweater. On the table a little folded paper structure made of cubes, a small notebook. A tiny paper airplane and a four-point yellow star above their hands. Expressive simple human faces and elegantly drawn hands, black substantial organic pen outlines, large solid black shapes, pure white fills. Sparse warm yellow only on the star. No gray shading, no gradients, no background scenery, no logo.
Frame sequence reading left to right:
1 top-left: both looking at the paper construction, left person's raised hand open.
2 top-right: same scene; left hand slightly higher waving, right person glances upward, paper airplane slightly tilted up.
3 bottom-left: same scene; left hand tilted the other way, right person smiling with eyes briefly closed, star slightly rotated, airplane slightly farther up.
4 bottom-right: same scene; hand returns near initial pose and both smile at viewer, airplane returns near start.
The four cells MUST have matching composition, identical table placement and body sizes, suitable for a looping hand-drawn flipbook. Clean confident playful ink drawing, sophisticated editorial craft, warm collaboration, crisp white background. Deliver just the sprite sheet.
```

## Final 24-frame edit prompt

```text
Use case: identity-preserve. Edit the attached illustration sprite sheet into a smooth 24-frame animation sprite sheet.
Output EXACTLY SIX columns and FOUR rows (24 cells), landscape aspect 3:2, ideally 3072x2048 pixels so each cell is 512x512. Every cell is square with no gutter, no borders, no captions, no numbers. Pure white background, no transparency.
Preserve the exact original two friendly teammates, black ink linework, solid black hair/sweater, glasses, desk, folded paper cubes and notebook. Keep the yellow tiny star and paper airplane. SAME composition, line weight, body size and camera in ALL 24 cells. Scene centered with 12% empty margins in every cell. The table baseline MUST be exactly at 77% of each cell's height in all 24 frames. No camera or body displacement. No new subjects.
The 24 frames, read left to right and top to bottom, make ONE seamless small greeting wave. Use the upper-right reference pose as the starting composition: man's forearm raised, palm open near head; woman rests her chin on hands. His palm smoothly tilts only by 15 degrees each direction, never drops. Incremental between-frame differences only, no jump cuts, no radically different poses. Frame1 hand centered, frames2-6 tilt gradually to right, frames7-12 gradually to left, frames13-18 gradually to right, frames19-24 gradually back to centered. Left forearm and body remain anchored. Woman remains in identical pose, blinking softly only around frames10-12; no head turns. Tiny airplane drifts only a little in a smooth closed ellipse, starting and ending same position. Star remains fixed. Keep facial identities, objects and layout perfectly registered across every cell. First and last frame nearly identical to close the loop. Crisp black-and-white editorial drawing with just the one yellow star. Deliver only the 6x4 animation sheet.
```
