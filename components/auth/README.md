# Auth UI

Shared frame for the signed-out screens: `/admin/login`, `/admin/recovery`,
`/auth/reset`. `AuthShell` centers one card over the decorative `Starfield` galaxy: a slowly
rotating Milky Way band with a glowing core, star dust, twinkling and glinting
stars, and an occasional shooting star. The screen is always dark (a scoped
`dark` class), whatever the site theme, so the galaxy reads as space. The
canvas is `aria-hidden`, shows a single still frame under
`prefers-reduced-motion`, pauses when the tab is hidden, and never carries
content. The card fades in once.

`LoginMascot` is "Volt", a small engineer robot (three.js, loaded lazily) who sits
on the card's top edge: safety-yellow hard hat with beacon and badge, visor
with glowing eyes and a smile, headphone cups, chest panel with blinking LEDs,
tool pouch, jointed arms with orange mittens, and swinging legs with bending
knees. He waves once on load, follows the pointer with his eyes, looks down and
smiles while the email field has focus, and covers his eyes (blushing, with the
odd peek) while a password field has focus. The arms are two-bone rigs solved
onto their targets, so the hands land on his eyes. Decorative only:
`aria-hidden`, no pointer events, a still frame under `prefers-reduced-motion`,
and absent (with a console warning) without three.js or WebGL.
