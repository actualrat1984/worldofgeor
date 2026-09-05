/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./public/**/*.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f0e0d",
        ink2: "#1a1a18",
        cream: "#f2e8d0",
        gold: "#d9b77a",
        amberdeep: "#b8924a",
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['20px', { lineHeight: '28px' }],
        xl: ['28px', { lineHeight: '36px' }],
        '2xl': ['38px', { lineHeight: '46px' }],
        '3xl': ['52px', { lineHeight: '60px' }],
        // Wave H H1 zero-drift steps — exact pre-migration px for elements
        // the approved 12/14/16/20/28/38/52 scale cannot represent.
        // Each line-height matches the slot the element was wrongly mapped to
        // (or the Tailwind default it originally used), so only size changes.
        micro: ['9px', { lineHeight: '16px' }], // 9px kickers / badges
        tiny: ['10px', { lineHeight: '16px' }], // 10px kickers / labels / injected rows
        kicker: ['11px', { lineHeight: '16px' }], // 11px kickers / labels
        13: ['13px', { lineHeight: '20px' }], // nav brand
        15: ['15px', { lineHeight: '20px' }], // feature headings
        18: ['18px', { lineHeight: '28px' }], // dashboard section titles (was text-lg)
        22: ['22px', { lineHeight: '28px' }], // age drawer title
        24: ['24px', { lineHeight: '32px' }], // dashboard welcome / quote (was text-2xl)
        26: ['26px', { lineHeight: '32px' }], // private-gate heading (mobile)
        30: ['30px', { lineHeight: '36px' }], // atlas heading / stats / quote mark (was text-3xl)
        32: ['32px', { lineHeight: '40px' }], // quote / private-gate heading (desktop)
        display: ['42px', { lineHeight: '50px' }], // hero H1 (mobile)
        'display-xl': ['64px', { lineHeight: '72px' }], // hero H1 (desktop)
        '4xl': ['36px', { lineHeight: '40px' }], // explicit pin of the Tailwind default (archive counts, section H2 desktop)
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'serif'],
        display: ['"Cinzel"', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      // Wave H H4 — motion discipline: one easing + 150/400ms timings.
      // Mirrors --ease-archive in src/style.css; keep the values in sync.
      transitionTimingFunction: { archive: 'cubic-bezier(.22,1,.36,1)' },
      transitionDuration: { 400: '400ms' },
    },
  },
  plugins: [],
}
