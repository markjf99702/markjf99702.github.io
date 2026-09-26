# junkdrawer.works

The only junk drawer where everything works.

This repo is the front of the drawer: the home page at [junkdrawer.works](https://junkdrawer.works/) and the domain for every project here. Each project repo with GitHub Pages turned on shows up under the same domain at `junkdrawer.works/<repo>/`.

- `index.html`: the drawer, one compartment per project. To add a project, copy a compartment (`<a class="slot">…</a>`) and point it at `/<repo>/`.
- `404.html`: shown for any address on the domain that doesn't exist.
- `CNAME`: tells GitHub Pages this site's domain. Leave it alone.
- `og.png`: the picture shown when a link is shared in a message. After adding or reordering projects, redraw it with `node tools/og.mjs` (needs Playwright): the tray gets one compartment per tile, in order.
- `tools/og.mjs`: draws `og.png`.
