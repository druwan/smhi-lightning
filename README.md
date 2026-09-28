# SMHI Lightning History

Check historical lightning strikes within a radius (nautical miles) of any point, using the [SMHI open data lightning archive](https://opendata.smhi.se/lightning/archive/introduction) (2012–today).

Everything runs in your browser: data is fetched directly from SMHI and can be downloaded as CSV. All times are UTC.

**Live:** <https://druwan.github.io/smhi-lightning/>

## Development

```
bun install
bun run dev
```

Pushes to `main` deploy automatically to GitHub Pages.

Built with Vite, React, TypeScript and shadcn/ui.
