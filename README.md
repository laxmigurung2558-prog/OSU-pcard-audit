# OSU P-Card Audit Workspace — Part IV (Safari-compatible)

## Open on your Mac

1. Extract the whole ZIP file.
2. Keep `index.html`, `app.js`, `styles.css`, and the `data` folder together.
3. Double-click `index.html` to open in Safari, Chrome, or Firefox. **No Terminal or local server is required.**
4. Wait for the banner to say real OSU data loaded (2014 has 116,031 transactions).
5. Use **Ask the data** for supported questions, or **Prohibited-purchase dashboard** to search specific Description or Vendor fields.

The annual dataset files are bundled as classic JavaScript scripts rather than JSON fetched over HTTP, so Safari can load them even from `file://` URLs. All computations happen in the browser; no API key is required. Loading a different year may take a few seconds.

## Important limitations

The question input is **rule-based natural-language interpretation**, not a general AI assistant. It supports the examples and common audit queries displayed in the interface but may not recognize arbitrary phrasing. Keyword matches are possible exceptions, not proof of wrongdoing.

The included database is the professor-supplied modified training data exported for OSU, covering 2010–2014. Before putting the full dataset on a *public* GitHub repository/website, confirm your professor permits redistribution. If they do not, request an approved deployment option; do not publicly upload these transaction files.

## GitHub Pages

Upload the complete folder content, including `data/`, to a repository, then enable Pages under Settings → Pages. The home page will be `index.html`. Keep API keys and credentials out of the repository.
