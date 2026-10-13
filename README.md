# junkdrawer.works

The only junk drawer where everything works.

This repo is the front of the drawer: the home page at [junkdrawer.works](https://junkdrawer.works/) and the domain for every project here. Each project repo with GitHub Pages turned on shows up under the same domain at `junkdrawer.works/<repo>/`, unless it has an address of its own, `<repo>.junkdrawer.works` (set by a `CNAME` file in its repo), as the games and the tools people install do. Its old path then forwards there.

- `index.html`: the drawer, in three trays: Tools (get something done), Games (play something) and Explore (find something out), each with a label-maker tape in its own colour. To add a project, copy a compartment (`<a class="slot">…</a>`) to the end of its tray and point it at the project's address. Leave the layout alone: a small script at the end of the page mixes each tray's rows of one, two and three tiles, the same way on every visit.
- `404.html`: shown for any address on the domain that doesn't exist.
- `privacy.html`: the privacy page for every project, and the one Google's sign-in screen links to. The projects that save to Google Drive share one Google Cloud project and OAuth client, branded junkdrawer.works; when a project starts or stops using Drive, or changes what it keeps there, update its entry.
- `carry.html`: when a project moves from `junkdrawer.works/<repo>/` to its own address, this hands it the saves it left behind here.
- `CNAME`: tells GitHub Pages this site's domain. Leave it alone.
- `og.png`: the picture shown when a link is shared in a message. After adding or reordering projects, redraw it with `node tools/og.mjs` (needs Playwright): the tray gets one compartment per tile, in order.
- `tools/og.mjs`: draws `og.png`.
- `test/e2e.mjs`: opens the pages in Chromium on phones, a tablet and a desktop, in light and dark, and checks how they look and read. `npm test` runs it (needs Playwright).
